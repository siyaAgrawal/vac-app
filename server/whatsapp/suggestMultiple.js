/**
 * VAC Multi-Suggestion Engine — v2
 *
 * Generates 4 contextual reply options (Natural / Thoughtful / Smart / Warm)
 * that sound indistinguishable from the user at their best.
 *
 * Used by the VAC Keyboard layer for tap-to-send suggestions.
 */
import { claudeComplete, getActiveProvider } from '../claudeClient.js'
import { buildStyleProfile, getRecentAISentPhrases, loadMemory, getSuggestionPreferences } from './memory.js'
import { buildRecipientProfile } from './recipientProfile.js'
import { analyzeConversation, detectClosureSignals, detectConflictSignals } from './conversationIntelligence.js'
import { preCheckShouldReply } from './analyzer.js'
import { logger } from '../logger.js'

const HINGLISH_RE = /\b(haan|nahi|kya|hai|yaar|bhai|theek|accha|kal|aaj|abhi|toh|matlab|arre|bolna|kar|raha|kyun|kaisa)\b/i

// ── Situation Detection ───────────────────────────────────────────────────────

/**
 * Detect the broad situation type based on recent message content.
 * @param {Array} messages - Recent conversation messages
 * @param {object} conflictState - Result from detectConflictSignals
 * @returns {'romantic'|'professional'|'personal'|'conflict'}
 */
function detectSituationType(messages, conflictState) {
  if (conflictState?.hasConflict) return 'conflict'

  const recentText = messages
    .slice(-12)
    .map((m) => (m.body || '').toLowerCase())
    .join(' ')

  const romanticRe = /\b(love|miss|babe|baby|feelings|together|relationship|boyfriend|girlfriend|partner|crush|date|kiss|hug|heart|romantic|romance|darling|sweetheart|affection|attachment)\b/i
  const professionalRe = /\b(meeting|deadline|project|client|office|work|report|presentation|email|schedule|conference|proposal|budget|invoice|contract|manager|colleague|team|deliverable|milestone|kpi)\b/i

  const romanticScore    = (recentText.match(romanticRe) || []).length
  const professionalScore = (recentText.match(professionalRe) || []).length

  if (romanticScore >= 2) return 'romantic'
  if (professionalScore >= 2) return 'professional'
  return 'personal'
}

// ── Situation Instructions ────────────────────────────────────────────────────

/**
 * Build a situation-specific instruction block for the prompt.
 * @param {'romantic'|'professional'|'personal'|'conflict'} type
 * @param {object} conflictState
 * @returns {string}
 */
function buildSituationInstructions(type, conflictState) {
  switch (type) {
    case 'romantic':
      return 'Softer tone, emotionally present, warmth without being dramatic. Avoid shortcuts. This person matters — let that show without overplaying it.'

    case 'professional':
      return 'Clear and competent. Smart-casual — not stiff, not too casual. Position the user as on top of things. No filler words. Every word earns its place.'

    case 'conflict':
      return `De-escalate. Acknowledge before responding. Calm, no defensiveness, no counter-attacking. Conflict level: ${conflictState?.level || 'moderate'}. The goal is resolution, not winning.`

    case 'personal':
    default:
      return 'Natural friend energy. Match their vibe exactly — if they\'re breezy, be breezy. If they\'re serious, meet them there.'
  }
}

// ── Preference Hint ───────────────────────────────────────────────────────────

/**
 * Build a preference hint based on which suggestion tones the user has previously picked.
 * @param {string} chatId
 * @returns {string}
 */
function buildPreferenceHint(chatId) {
  try {
    const prefs = getSuggestionPreferences(chatId)
    if (!prefs.preferredTone || prefs.totalUsed < 3) return ''

    const { preferredTone, toneDistribution, totalUsed } = prefs
    const topPct = Math.round((toneDistribution[preferredTone] / totalUsed) * 100)

    if (topPct >= 50) {
      return `This user tends to pick '${preferredTone}' replies (${topPct}% of the time) — lean slightly toward that style, but still vary the options.`
    } else if (topPct >= 35) {
      return `This user has a mild preference for '${preferredTone}' replies — keep that in mind when calibrating tone.`
    }
    return ''
  } catch {
    return ''
  }
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * Build a 4-suggestion response for the given chat and message.
 * @returns {{ noReplyNeeded: boolean, reason?: string, suggestions: Suggestion[], conflict: boolean }}
 */
export async function generateSuggestions({ chatId, message, sender }) {
  const mem         = loadMemory(chatId)
  const allMessages = mem.messages || []

  // ── Pre-check: is a reply even needed? ───────────────────────────────────
  const preCheck = preCheckShouldReply(message, allMessages)
  if (!preCheck.should) {
    logger.info('SuggestMultiple', 'No reply needed (pre-check)', { chatId, reason: preCheck.reason })
    return { noReplyNeeded: true, reason: preCheck.reason, suggestions: [], conflict: false }
  }

  // ── Build intelligence modules ────────────────────────────────────────────
  let styleProfile     = null
  let recipientProfile = null
  let convIntel        = null

  try { styleProfile     = buildStyleProfile(chatId)      } catch (_) {}
  try { recipientProfile = buildRecipientProfile(chatId)  } catch (_) {}
  try { convIntel        = analyzeConversation(allMessages) } catch (_) {}

  const recentAIPhrases = getRecentAISentPhrases(chatId, 6)
  const conflictState   = detectConflictSignals(allMessages)

  const convLang = styleProfile?.language ||
    (HINGLISH_RE.test(message) ? 'hinglish' : 'english')

  // Situation detection
  const situationType    = detectSituationType(allMessages, conflictState)
  const situationBlock   = buildSituationInstructions(situationType, conflictState)
  const preferenceHint   = buildPreferenceHint(chatId)

  // Recent conversation context (last 16 messages)
  const contextLines = allMessages.slice(-16).map((m) => {
    const who = (m.direction === 'out' || m.sender === 'You') ? 'You' : (m.sender || 'Them')
    return `${who}: ${(m.body || '').replace(/\n/g, ' ').slice(0, 120)}`
  }).join('\n')

  // ── Rules fallback if no AI ───────────────────────────────────────────────
  const provider = await getActiveProvider()
  if (!provider) {
    return { noReplyNeeded: false, suggestions: buildRulesSuggestions(message, convLang), conflict: conflictState.hasConflict }
  }

  // ── Style summary for prompt ──────────────────────────────────────────────
  const styleLines = styleProfile ? [
    `Language: ${convLang === 'hinglish' ? 'Hinglish (Hindi in Roman script)' : 'English'}`,
    `Avg message: ${styleProfile.avgLength} chars, ${styleProfile.avgWords} words`,
    `Style: ${styleProfile.style} / ${styleProfile.formality}`,
    styleProfile.startsLowercase ? 'Starts messages in lowercase' : '',
    styleProfile.emojiRate > 40 ? `Uses emojis (${styleProfile.emojiRate}% of messages)` : 'Rarely uses emojis',
    styleProfile.topWords?.length ? `Their common words: ${styleProfile.topWords.slice(0, 5).join(', ')}` : '',
    styleProfile.recentSamples?.length
      ? `Their actual recent messages:\n${styleProfile.recentSamples.slice(-4).map((s) => `  "${s}"`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n') : `Reply in ${convLang === 'hinglish' ? 'Hinglish' : 'English'}, casual tone.`

  const avoidBlock = recentAIPhrases.length
    ? `\nDO NOT use these phrases (already sent recently):\n${recentAIPhrases.map((p) => `  "${p}"`).join('\n')}`
    : ''

  const avoidRepeatBlock = recentAIPhrases.length
    ? `Avoid repeating: ${recentAIPhrases.map((p) => `"${p}"`).join(', ')}`
    : ''

  const conflictBlock = conflictState.hasConflict
    ? `\n⚠️ CONFLICT ACTIVE (level: ${conflictState.level}) — All replies must de-escalate. Acknowledge first, never defend, keep completely calm.`
    : ''

  const recipientBlock = recipientProfile?.summary
    ? `About ${sender}: ${recipientProfile.summary}`
    : ''

  const langInstruction = convLang === 'hinglish'
    ? 'Reply in Hinglish (Hindi written in Roman script), matching the user\'s natural code-switching style.'
    : ''

  // ── AI prompt ─────────────────────────────────────────────────────────────
  const prompt = `You are this person's inner voice — how they communicate when they're at their best.
Not an AI. Not a tool. The version of them that always says the right thing.

━━━ UNDERSTAND THE MOMENT FIRST ━━━
Message from ${sender}: "${message}"
${contextLines ? `Recent conversation:\n${contextLines}` : ''}
${recipientBlock}

Before writing anything — read the situation:
• What does ${sender} actually want or need from this reply?
• What is the emotional temperature right now?
• What would make the user look/feel their best here?
• How would they phrase this on a really good day?

━━━ THIS USER'S EXACT VOICE ━━━
${styleLines}
${avoidBlock}

━━━ 4 REPLIES — DIFFERENT INTENTS, SAME VOICE ━━━

Natural  — What they'd type in 2 seconds. Instinctive. Sounds exactly like them, zero effort.
Thoughtful — Shows they actually read it. A beat more considered. Makes them look attentive without trying.
Smart — Positions them well. Slightly sharper than their default. Good social outcome.
Warm — Reads the emotional energy of the message and meets it directly.

━━━ QUALITY BAR — every reply must pass ━━━
✓ Sounds like a real human (not AI generated)
✓ Specific to THIS message — no reply could work in any other conversation
✓ Slightly better than what they'd normally type — not worse, not AI-perfect
✓ Makes them look thoughtful, clear, socially present
✓ Matches their natural length — don't pad, don't compress

BANNED PHRASES (instant fail): "Of course!", "Absolutely!", "Sure thing!", "I understand!",
"That makes sense!", "No worries!", "Sounds great!", "Happy to help!", "Great question!"

BANNED PATTERNS:
✗ Starting every reply with "I"
✗ Generic acknowledgments ("I hear you", "I understand where you're coming from")
✗ Overly structured sentences when they write casually
✗ Perfect formal English if they text casually
✗ Any phrase that sounds like customer service

MICRO-POLISH — what makes replies feel human:
• Natural pauses: "yeah, that makes sense" / "honestly" / "idk"
• Softeners when appropriate: "i think", "maybe", "probably"
• Trailing energy when they'd trail off: "so..." / "anyway"
• NOT in every reply — only where it fits naturally

━━━ SITUATION ━━━
${situationBlock}
${conflictBlock}
${preferenceHint}

${avoidRepeatBlock}
${langInstruction}

Return ONLY valid JSON:
{
  "noReplyNeeded": false,
  "situationRead": "<1 sentence: what this moment actually is>",
  "suggestions": [
    { "tone": "Natural",    "label": "Natural",    "text": "...", "reasoning": "why this fits" },
    { "tone": "Thoughtful", "label": "Thoughtful", "text": "...", "reasoning": "why this fits" },
    { "tone": "Smart",      "label": "Smart",      "text": "...", "reasoning": "why this fits" },
    { "tone": "Warm",       "label": "Warm",       "text": "...", "reasoning": "why this fits" }
  ]
}`

  try {
    const raw    = await claudeComplete({ messages: [{ role: 'user', content: prompt }], maxTokens: 900, smart: false })
    const clean  = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))

    if (parsed.noReplyNeeded) {
      return { noReplyNeeded: true, reason: 'AI: no reply needed', suggestions: [], conflict: conflictState.hasConflict }
    }

    const suggestions = (parsed.suggestions || []).filter((s) => s?.text?.trim())
    if (suggestions.length === 0) throw new Error('AI returned empty suggestions')

    logger.info('SuggestMultiple', `Generated ${suggestions.length} suggestions`, { chatId, sender, situationType })
    return {
      noReplyNeeded:  false,
      situationRead:  parsed.situationRead || null,
      suggestions,
      conflict:       conflictState.hasConflict,
    }
  } catch (err) {
    logger.error('SuggestMultiple', 'AI error — using rules fallback', { error: err.message })
    return { noReplyNeeded: false, suggestions: buildRulesSuggestions(message, convLang), conflict: conflictState.hasConflict }
  }
}

// ── Improve Draft ─────────────────────────────────────────────────────────────

/**
 * Improve a user's draft message while preserving their voice.
 */
export async function improveDraft({ chatId, draft }) {
  const mem         = loadMemory(chatId)
  const allMessages = mem.messages || []
  const styleProfile = buildStyleProfile(chatId)
  const provider     = await getActiveProvider()

  if (!provider || !draft?.trim()) return { improved: draft, changes: [] }

  const styleLines = styleProfile ? [
    styleProfile.language === 'hinglish' ? 'User writes in Hinglish' : 'User writes in English',
    `Style: ${styleProfile.style} / ${styleProfile.formality}`,
    styleProfile.startsLowercase ? 'starts lowercase' : '',
    styleProfile.emojiRate > 30 ? 'uses emojis' : 'rarely uses emojis',
    styleProfile.recentSamples?.length
      ? `Their examples: ${styleProfile.recentSamples.slice(-2).map((s) => `"${s}"`).join(', ')}`
      : '',
  ].filter(Boolean).join(', ') : 'casual, natural tone'

  // Brief context of the conversation for the improve prompt
  const contextLine = allMessages.length > 0
    ? `Conversation context: ${allMessages.slice(-4).map((m) => {
        const who = (m.direction === 'out' || m.sender === 'You') ? 'You' : (m.sender || 'Them')
        return `${who}: ${(m.body || '').slice(0, 80)}`
      }).join(' | ')}`
    : ''

  try {
    const raw = await claudeComplete({
      messages: [{
        role: 'user',
        content: `You are fixing this WhatsApp message — not rewriting it.

Original: "${draft}"
${contextLine}
User's style: ${styleLines}

Step 1 — Identify what (if anything) needs fixing:
- Awkward phrasing that could flow better?
- Unclear wording that could confuse?
- Tone that doesn't match the moment?
- Grammar issues that stand out?

Step 2 — Fix ONLY those things. Keep everything else identical.

Rules:
• If nothing is wrong → return the original unchanged
• Never expand a short message into a long one
• Never make casual writing formal
• Never change the meaning or intent
• The result must sound like the same person, just on a slightly better day
• Max 1-2 things changed — this is polish, not editing

Return ONLY JSON: { "improved": "...", "changes": ["one brief note on what changed, or 'No changes needed'"] }`,
      }],
      maxTokens: 300,
      smart: false,
    })
    const clean  = raw.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
    return { improved: parsed.improved || draft, changes: parsed.changes || [] }
  } catch {
    return { improved: draft, changes: [] }
  }
}

// ── Rules-based fallback ──────────────────────────────────────────────────────

function buildRulesSuggestions(message, lang = 'english') {
  const t          = message.toLowerCase()
  const isHinglish = lang === 'hinglish' || HINGLISH_RE.test(t)
  const hasQ       = /\?/.test(message)

  if (isHinglish) {
    if (hasQ) return [
      { tone: 'Natural',    label: 'Natural',    text: 'haan batata hoon',                    reasoning: 'Quick natural acknowledgment' },
      { tone: 'Thoughtful', label: 'Thoughtful', text: 'haan yaar, dekh ke batata hoon',       reasoning: 'Warm and engaged' },
      { tone: 'Smart',      label: 'Smart',      text: 'abhi check karta hoon aur batata hoon', reasoning: 'Commits to follow up' },
      { tone: 'Warm',       label: 'Warm',       text: 'haan bilkul, dekh raha hoon',          reasoning: 'Warm and reassuring' },
    ]
    return [
      { tone: 'Natural',    label: 'Natural',    text: 'haan',                                reasoning: 'Simple acknowledgment' },
      { tone: 'Thoughtful', label: 'Thoughtful', text: 'haan yaar, theek hai',                reasoning: 'Warm agreement' },
      { tone: 'Smart',      label: 'Smart',      text: 'accha samajh gaya, kar deta hoon',    reasoning: 'Understood and committed' },
      { tone: 'Warm',       label: 'Warm',       text: 'haan bilkul, fikr mat karo',          reasoning: 'Reassuring and warm' },
    ]
  }

  if (hasQ) return [
    { tone: 'Natural',    label: 'Natural',    text: 'let me check',                           reasoning: 'Immediate acknowledgment' },
    { tone: 'Thoughtful', label: 'Thoughtful', text: "i'll look into it and let you know",     reasoning: 'Warm and committed' },
    { tone: 'Smart',      label: 'Smart',      text: "give me a sec, i'll find out",           reasoning: 'Efficient and competent' },
    { tone: 'Warm',       label: 'Warm',       text: "on it — i'll get back to you soon",      reasoning: 'Warm and action-oriented' },
  ]

  return [
    { tone: 'Natural',    label: 'Natural',    text: 'ok!',                                    reasoning: 'Minimal acknowledgment' },
    { tone: 'Thoughtful', label: 'Thoughtful', text: "yeah that tracks",                       reasoning: 'Considered agreement' },
    { tone: 'Smart',      label: 'Smart',      text: "yeah let's do it",                       reasoning: 'Decisive and engaged' },
    { tone: 'Warm',       label: 'Warm',       text: "sounds good, i'm in",                    reasoning: 'Enthusiastic and warm' },
  ]
}
