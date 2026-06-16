/**
 * VAC Analyzer — Advanced Conversational Intelligence Engine
 *
 * Pipeline (per message):
 *   1. Rule-based instant analysis  (intent, tone, emotion, commitment)
 *   2. Full conversation analysis   (topics, emotional arc, open loops)
 *   3. Recipient behavioral profile (how they write, respond, feel)
 *   4. User style mastery           (vocabulary, length, punctuation, tone)
 *   5. Feedback learning context    (avoid/prefer patterns from past ratings)
 *   6. AI reply generation          (strategic, outcome-oriented, sounds like the user)
 *      → Anthropic path: deep reasoning prompt with all context
 *      → Ollama path:    fast focused prompt (under 15s)
 *      → Rules fallback: contextual, varied, never generic
 */
import { getActiveProvider, claudeComplete } from '../claudeClient.js'
import { buildStyleProfile, getRecentAISentPhrases, loadMemory } from './memory.js'
import { buildRecipientProfile } from './recipientProfile.js'
import { analyzeConversation, detectClosureSignals, detectConflictSignals } from './conversationIntelligence.js'
import { getLearningContext } from './feedbackStore.js'
import { logger } from '../logger.js'

// ── Rule-based helpers ────────────────────────────────────────────────────────

function quickToneScore(text) {
  const lower = text.toLowerCase()
  const scores = { stress: 0, anger: 0, politeness: 0, enthusiasm: 0, urgency: 0 }

  if (/urgent|asap|immediately|right now|!!+/i.test(text))                  scores.urgency    += 60
  if (/jaldi|abhi|turant|zaruri|important\s*hai/i.test(lower))              scores.urgency    += 50  // Hinglish urgency
  if (/please|thank|appreciate|kind|hope/i.test(lower))                     scores.politeness += 50
  if (/please\s*kar|shukriya|dhanyawad|meherbani/i.test(lower))             scores.politeness += 40  // Hinglish politeness
  if (/!!!|wtf|hate|angry|furious|disgusted/i.test(text))                   scores.anger      += 70
  if (/gussa|naraaz|bura laga|galat|chillao/i.test(lower))                  scores.anger      += 60  // Hinglish anger
  if (/stressed|overwhelmed|pressure|deadline|panick/i.test(lower))         scores.stress     += 60
  if (/tension|pareshan|chinta|sar dard|thak|mushkil/i.test(lower))         scores.stress     += 55  // Hinglish stress
  if (/!{2,}|great|awesome|love|amazing|excited|yes!!/i.test(text))         scores.enthusiasm += 55
  if (/wah|zabardast|mast|shandar|bahut accha|bahut acha|ekdum/i.test(lower)) scores.enthusiasm += 50 // Hinglish enthusiasm
  if (/\?{2,}|where|why haven|still waiting|any update/i.test(text))        scores.urgency    += 40
  if (/sorry|apologize|my bad|forgive/i.test(lower))                        scores.politeness += 35
  if (/maafi|sorry yaar|galti|bhool gaya|bhool gayi/i.test(lower))          scores.politeness += 30  // Hinglish apology

  const capRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1)
  if (capRatio > 0.4 && text.split(/\s+/).length > 2) { scores.anger += 30; scores.urgency += 20 }

  for (const k of Object.keys(scores)) scores[k] = Math.min(100, scores[k])
  const dominant = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
  return { scores, dominant }
}

function detectEmotion(text) {
  const t = text.toLowerCase()
  if (/love|miss you|❤|😍|happy|joy|excited|pyaar|yaad aa|dil|❤️/.test(t))          return 'warm'
  if (/miss (you|u)\b|miss kar|yaad aayi|yaad aaya/.test(t))                         return 'warm'
  if (/sad|upset|hurt|crying|😢|💔|dukh|rona|ro raha|udaas|bura lag/.test(t))        return 'distressed'
  if (/angry|mad|wtf|!!+|hate|gussa|naraaz|ganda|galat hai/.test(t))                 return 'angry'
  if (/worried|anxious|nervous|scared|chinta|dar|pareshan|tension/.test(t))           return 'anxious'
  if (/lol|haha|😂|funny|joke|hehe|hahaha|mazak|hasi/.test(t))                       return 'playful'
  return 'neutral'
}

function detectCommitment(text) {
  const found = [
    /I('ll| will)\s+\w/i,
    /we('ll| will)\s+\w/i,
    /let me\s+\w/i,
    /I'll (send|call|check|follow|get back|do|fix|handle)/i,
    /by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|EOD|tonight)/i,
    /will be done|I promise|count on me|I'll make sure/i,
  ].some((p) => p.test(text))
  return { detected: found, score: found ? 75 : 10, text: found ? text.slice(0, 120) : null }
}

function inferPsychState(dominant, emotion) {
  if (dominant === 'anger' || emotion === 'angry')  return 'frustrated or overwhelmed'
  if (dominant === 'stress')                        return 'under pressure, needs reassurance'
  if (dominant === 'urgency')                       return 'time-pressured, wants quick response'
  if (dominant === 'politeness')                    return 'composed, relationship-conscious'
  if (emotion === 'warm')                           return 'emotionally open, feeling connected'
  if (emotion === 'anxious')                        return 'uncertain, seeking confirmation'
  return 'neutral, informational intent'
}

function detectIntent(text) {
  const t = text.toLowerCase()
  if (/\?/.test(t))                                                                            return 'question'
  if (/^(hi|hey|hello|good morning|morning|sup|yo|hiya|haan|kya haal|kaise|kya kar|namaste|kem cho)/i.test(t)) return 'greeting'
  if (/sad|upset|hurt|worried|scared|miss|love|udaas|pareshan|dukh|yaad|bura/i.test(t))      return 'emotional'
  if (/please|can you|could you|would you|need you|help|karo|karna|bata|bolo|de do|bhej/i.test(t)) return 'request'
  if (/thanks|thank you|appreciate|great job|shukriya|dhanyawad|bahut accha|wah|zabardast/i.test(t)) return 'appreciation'
  if (/ok|okay|sure|got it|sounds good|yep|yes|theek|accha|haan|bilkul|sahi/i.test(t))       return 'acknowledgement'
  return 'statement'
}

// ── Pre-check: should we even reply? ─────────────────────────────────────────
//
// Fast rule-based gate that runs BEFORE the AI call.
// If this returns false, we skip the AI entirely — no wasted tokens.

export function preCheckShouldReply(message, messages) {
  const closure = detectClosureSignals(message, messages)
  if (closure.isClosed) {
    return { should: false, reason: closure.signal }
  }
  return { should: true, reason: 'message warrants a reply' }
}

// ── Style profile → instruction string ───────────────────────────────────────

function styleProfileToInstructions(profile) {
  if (!profile || profile.msgCount < 3) {
    return [
      "Closely match the user's natural tone, length, and vocabulary from the conversation history.",
      "Be genuine and specific — never generic.",
      "Correct grammar, casual delivery.",
    ].join(' ')
  }

  const parts = []

  // Identity — the most important instruction
  parts.push(
    `You are embodying this user's voice exactly. Do NOT make them sound smarter, more articulate, or more polished than they are.` +
    ` Replicate their natural style — including typical length, sentence flow, and vocabulary choices.`
  )

  // Language
  if (profile.language === 'hinglish') {
    parts.push(
      'This user writes in Hinglish (Roman-script Hindi). Reply in Hinglish naturally —' +
      ' use words like "haan", "theek hai", "dekh", "kal", "yaar", "bhai", "arre" as they do.' +
      ' Never switch to full English unless they do.'
    )
  }

  // Length and depth
  if (profile.avgWords >= 30) {
    parts.push(`This user writes detailed messages (avg ${profile.avgWords} words). Match that depth — do NOT truncate or over-simplify their replies.`)
  } else if (profile.avgWords <= 5) {
    parts.push(`This user texts very briefly (avg ${profile.avgWords} words). Keep replies equally short — 1 to 3 words is normal for them.`)
  } else {
    parts.push(`Write in a ${profile.style} style (avg ${profile.avgLength} chars, ${profile.avgWords} words).`)
  }

  // Formality
  if (profile.formality === 'casual/informal') {
    parts.push('Casual, relaxed tone. No corporate or AI-sounding phrases.')
  } else if (profile.formality === 'professional/formal') {
    parts.push('Professional, composed tone.')
  } else {
    parts.push('Natural conversational tone.')
  }

  // Specific habits
  const habits = []
  if (profile.startsLowercase)         habits.push('starts messages in lowercase')
  if (!profile.usesPunctuation)        habits.push('skips ending punctuation')
  if (profile.emojiRate > 50)          habits.push('uses 1–2 emojis regularly')
  else if (profile.emojiRate > 20)     habits.push('occasionally uses an emoji')
  else                                 habits.push('rarely or never uses emojis')
  if (profile.slangRate > 30)          habits.push('uses casual slang (yaar, bro, haha, etc.)')
  if (profile.multiLine)               habits.push('sometimes uses line breaks in longer messages')
  if (profile.shortMessages > 70)      habits.push('most messages are under 20 chars')
  if (habits.length > 0) parts.push(`Their texting habits: ${habits.join(', ')}.`)

  // Vocabulary
  if (profile.topWords?.length > 0) {
    parts.push(`Words they commonly use: ${profile.topWords.slice(0, 6).join(', ')}.`)
  }

  // Recent samples — strongest style signal
  if (profile.recentSamples?.length > 0) {
    parts.push(
      `Their actual recent messages (copy this exact tone and register):\n` +
      profile.recentSamples.map((s) => `  "${s}"`).join('\n')
    )
  }

  // Response pacing
  if (profile.avgResponseHours !== null) {
    if (profile.avgResponseHours < 0.05)  parts.push('They text rapidly — keep replies snappy.')
    else if (profile.avgResponseHours > 6) parts.push('They take their time — a thoughtful reply is fine.')
  }

  // Non-negotiable grammar note
  parts.push(
    'GRAMMAR: Write casually but CORRECTLY — do NOT introduce grammatical errors to mimic a casual style. Casual ≠ broken.'
  )

  return parts.join('\n')
}

// ── Rules-based contextual reply builder ─────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function buildRulesReply(intent, emotion, dominant, message, sender, lang = 'english') {
  const t = (message || '').toLowerCase()
  const hasQuestion = /\?/.test(message)
  const isHinglish  = lang === 'hinglish' || /\b(haan|nahi|kya|hai|yaar|bhai|theek|accha|kal|aaj|abhi|toh|matlab|arre)\b/i.test(t)

  // Content-specific (most specific first)
  if (/miss (you|u)\b|yaad aa/i.test(t)) {
    return isHinglish
      ? pick(['miss kar raha/rahi hoon 💙', 'yaad aa rahe ho', 'haan yaar, same'])
      : pick(['miss you too!', 'same 💙', 'miss you too ❤️'])
  }
  if (/love you|luv u|pyaar/i.test(t)) {
    return isHinglish
      ? pick(['❤️', 'love you too', 'haha ❤️'])
      : pick(['love you too ❤️', '❤️', 'love you!'])
  }
  if (/good night|gn\b|goodnight|shubh ratri|so ja/i.test(t)) {
    return isHinglish
      ? pick(['gn!', 'so ja 🌙', 'good night'])
      : pick(['good night!', 'gn! 🌙', 'sleep well!'])
  }
  if (/good morning|gm\b|morning|subah/i.test(t)) {
    return isHinglish
      ? pick(['good morning!', 'gm! 😊', 'subah achi ho'])
      : pick(['good morning! 😊', 'morning!', 'gm!'])
  }
  if (/happy birthday|hbd\b|janam din|birthday/i.test(t)) {
    return isHinglish
      ? pick(['thank you!! 🎉', 'shukriya!! 😊', 'thanks yaar!'])
      : pick(['thank you!! 🎉', 'thank you so much!', 'thanks!! 😊'])
  }
  if (/how are you|how r u|hru\b|kya haal|kaise ho|kaisa/i.test(t)) {
    return isHinglish
      ? pick(['theek hoon, tum batao', 'sab theek! tum?', 'haan theek hoon, kya chal raha?'])
      : pick(["good, you?", 'doing well! you?', 'all good! you?'])
  }
  if (/done|finished|completed|sent|ho gaya|kar diya|bhej diya/i.test(t)) {
    return isHinglish
      ? pick(['accha theek hai!', 'haan dekh liya', 'thanks!'])
      : pick(['great, thanks!', 'perfect, got it!', 'nice!'])
  }
  if (/wait|waiting|still there|ruk|ruko|abhi aata/i.test(t)) {
    return isHinglish
      ? pick(['haan hoon yahan', 'sorry, abhi dekha', 'haan bolo'])
      : pick(['yeah, here!', 'sorry, just saw this!', 'yes here!'])
  }
  if (/sick|fever|ill|unwell|beemar|tabiyat|dard/i.test(t)) {
    return isHinglish
      ? pick(['arre, jaldi theek ho!', 'kya hua? rest karo', 'get well soon yaar'])
      : pick(['oh no, hope you feel better soon!', 'get well soon!', 'take rest!'])
  }
  if (/urgent|asap|right now|jaldi|abhi|turant/i.test(t)) {
    return isHinglish
      ? pick(['haan kar raha hoon', 'abhi karta hoon', 'ok jaldi karta hoon'])
      : pick(['on it!', 'doing it now', 'right on it'])
  }

  // Intent-based
  if (intent === 'greeting') {
    return isHinglish
      ? pick(['haan bolo!', 'hey! kya chal raha?', 'haan kya hua?', 'bol bol'])
      : pick(["hey! what's up", 'hey!', 'hi!'])
  }
  if (intent === 'appreciation') {
    return isHinglish
      ? pick(['arre kuch nahi yaar', 'haha no problem', 'theek hai!'])
      : pick(['thanks!', 'appreciate it!', 'aww thanks'])
  }
  if (intent === 'acknowledgement') {
    if (dominant === 'enthusiasm') {
      return isHinglish
        ? pick(['haan bilkul!', 'yes yaar!', 'bilkul!'])
        : pick(['yes!', 'definitely!', 'for sure!'])
    }
    return isHinglish
      ? pick(['theek hai', 'accha', 'haan okay', 'samajh gaya/gayi'])
      : pick(['sounds good', 'okay!', 'got it', 'alright!'])
  }
  if (intent === 'question' || hasQuestion) {
    if (dominant === 'urgency') {
      return isHinglish
        ? pick(['dekh raha/rahi hoon', 'abhi check karta/karti hoon', 'ek sec'])
        : pick(['let me check now', 'on it, give me a sec', 'checking now'])
    }
    return isHinglish
      ? pick(['dekh ke batata/batati hoon', 'pata karke bolunga/bolungi', 'abhi check karta/karti hoon'])
      : pick(["let me check and get back to you", "i'll find out", 'let me look into it'])
  }
  if (intent === 'request') {
    if (dominant === 'urgency') {
      return isHinglish
        ? pick(['haan kar deta/deti hoon', 'abhi karta/karti hoon', 'ok ok'])
        : pick(['on it!', 'right away!', 'doing it now'])
    }
    return isHinglish
      ? pick(['theek hai, kar deta/deti hoon', 'haan karta/karti hoon', 'okay'])
      : pick(["sure, will do", 'okay, on it', 'yep, will do'])
  }

  // Emotion-based
  if (emotion === 'distressed' || intent === 'emotional') {
    return isHinglish
      ? pick(['arre kya hua? theek ho?', 'yaar, hoon na main', 'sab theek ho jayega'])
      : pick(['that sounds really tough', "i'm here for you", "hope you're okay 💙"])
  }
  if (emotion === 'anxious') {
    return isHinglish
      ? pick(['chinta mat karo', 'ho jayega sab', 'relax yaar, sab theek hoga'])
      : pick(["it'll be okay", "you've got this!", "don't worry, it'll work out"])
  }
  if (emotion === 'warm') {
    return isHinglish
      ? pick(['😊', 'haha ❤️', 'aww'])
      : pick(['😊', 'same here!', '❤️'])
  }
  if (emotion === 'playful') {
    return isHinglish
      ? pick(['hahaha', 'yaar 😂', 'lol haha'])
      : pick(['hahaha', 'lol 😂', 'haha same'])
  }
  if (emotion === 'angry') {
    return isHinglish
      ? pick(['haan yaar, samajh sakta/sakti hoon', 'gussa toh aayega', 'accha theek hai'])
      : pick(["yeah, that's frustrating", 'i get it', 'understandable'])
  }

  // Dominant tone fallback
  if (dominant === 'urgency')    return isHinglish ? pick(['haan karta/karti hoon', 'theek hai']) : pick(['got it, on it', 'okay, doing it now'])
  if (dominant === 'stress')     return isHinglish ? pick(['ho jayega yaar', 'chinta mat karo', 'sab theek hoga']) : pick(["it'll work out", "don't stress about it", "we'll figure it out"])
  if (dominant === 'anger')      return isHinglish ? pick(['haan samajh raha/rahi hoon', 'theek hai yaar']) : pick(['i hear you', 'yeah, makes sense', 'i get it'])
  if (dominant === 'enthusiasm') return isHinglish ? pick(['wah!', 'zabardast!', 'nice yaar!']) : pick(['yes!', 'amazing!', "that's great!"])

  return isHinglish
    ? pick(['haan', 'theek hai', 'okay', 'accha'])
    : pick(['got it!', 'okay!', 'sure!', 'alright'])
}

// ── Recipient style description ───────────────────────────────────────────────

function analyzeRecipientStyle(contextLines) {
  if (!contextLines || contextLines.length < 3) return 'unknown'
  const incomingTexts = contextLines
    .filter((l) => !/You:/.test(l))
    .map((l) => l.replace(/^\[.*?\]\s*[^:]+:\s*/, '').trim())
    .filter(Boolean)
  if (incomingTexts.length < 2) return 'unknown'

  const avgLen    = incomingTexts.reduce((s, t) => s + t.length, 0) / incomingTexts.length
  const usesEmoji = incomingTexts.some((t) => /[\u{1F300}-\u{1FFFF}]/u.test(t))
  const usesPunct = incomingTexts.filter((t) => /[.!?]$/.test(t)).length / incomingTexts.length > 0.5
  const hasSlang  = incomingTexts.some((t) => /\b(lol|haha|bro|yaar|nah|rn|omg|ngl|fr|tbh)\b/i.test(t))

  const parts = []
  if (avgLen < 20)       parts.push('very brief')
  else if (avgLen < 60)  parts.push('concise')
  else if (avgLen < 120) parts.push('moderate length')
  else                   parts.push('detailed')
  if (usesEmoji)  parts.push('uses emojis')
  if (!usesPunct) parts.push('skips punctuation')
  if (hasSlang)   parts.push('casual/slangy')
  return parts.join(', ') || 'conversational'
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeMessage({ chat_id, sender, message, timestamp, conversation_history = '' }) {
  // Filter VCARD contact cards — they are not actual messages and must not be sent
  if (typeof message === 'string' && message.trimStart().startsWith('BEGIN:VCARD')) {
    logger.info('Analyzer', 'VCARD message — skipping analysis', { chat_id })
    return {
      tone_analysis: { scores: { stress: 0, anger: 0, politeness: 0, enthusiasm: 0, urgency: 0 }, dominant: 'neutral' },
      commitment_score: 0, commitment_detected: false,
      emotion: 'neutral', psychological_state: 'neutral', relationship_dynamic: 'unknown',
      subtext: '', urgency_level: 'low',
      suggested_reply: null,   // never send anything for a VCARD
      confidence: 0, method: 'vcard-skip',
      explanation: { summary: 'VCARD contact card — no reply generated.', intent: 'statement', tone_read: 'neutral', context_used: 'none', style_notes: ['vcard-skip'], recipient_style_read: 'unknown', confidenceScore: 0 },
    }
  }

  const tone       = quickToneScore(message)
  const emotion    = detectEmotion(message)
  const commitment = detectCommitment(message)
  const intent     = detectIntent(message)

  const provider = await getActiveProvider()

  // ── No AI: rule-based only ───────────────────────────────────────────────
  if (!provider) {
    return {
      tone_analysis:        { scores: tone.scores, dominant: tone.dominant },
      commitment_score:     commitment.score,
      commitment_detected:  commitment.detected,
      emotion,
      psychological_state:  inferPsychState(tone.dominant, emotion),
      relationship_dynamic: 'unknown',
      subtext:              '',
      urgency_level:        tone.scores.urgency > 50 ? 'high' : tone.scores.urgency > 20 ? 'medium' : 'low',
      suggested_reply:      null,
      confidence:           0.3,
      method:               'rules',
      explanation: {
        summary:              'No AI provider — rules-based analysis only.',
        intent, tone_read: tone.dominant, context_used: 'none',
        style_notes: [], recipient_style_read: 'unknown', confidenceScore: 0.3,
      },
    }
  }

  // ── Build all intelligence modules ────────────────────────────────────────
  const contextLines = conversation_history
    ? conversation_history.split('\n').filter(Boolean).slice(-30)
    : []

  let styleProfile     = null
  let recipientProfile = null
  let convIntel        = null
  let recentAIPhrases  = []
  let allMessages      = []

  if (chat_id) {
    try { styleProfile     = buildStyleProfile(chat_id)     } catch (_) {}
    try { recipientProfile = buildRecipientProfile(chat_id) } catch (_) {}
    try {
      const mem   = loadMemory(chat_id)
      allMessages = mem.messages || []
      convIntel   = analyzeConversation(allMessages)
    } catch (_) {}
    try { recentAIPhrases = getRecentAISentPhrases(chat_id, 10) } catch (_) {}
  }

  // ── Rule-based pre-check: should we reply at all? ────────────────────────
  const preCheck = preCheckShouldReply(message, allMessages)
  if (!preCheck.should) {
    logger.info('Analyzer', 'Pre-check: skip reply', { chat_id, reason: preCheck.reason })
    return {
      tone_analysis: { scores: tone.scores, dominant: tone.dominant },
      commitment_score: commitment.score, commitment_detected: commitment.detected,
      emotion, psychological_state: inferPsychState(tone.dominant, emotion),
      relationship_dynamic: recipientProfile?.possibleRelationship || 'unknown',
      subtext: '', urgency_level: 'low',
      suggested_reply: null,
      should_reply: false,
      skip_reason: preCheck.reason,
      confidence: 0.9,
      method: 'pre-check-skip',
      explanation: {
        summary: `Skipped: ${preCheck.reason}`,
        intent, tone_read: tone.dominant, context_used: 'pre-check',
        style_notes: ['closure-detected'], recipient_style_read: 'unknown', confidenceScore: 0.9,
      },
    }
  }

  // Detect conversation language for language-matching instructions
  const convLang = styleProfile?.language || 'english'

  // Detect conflict signals
  const conflictState = detectConflictSignals(allMessages)

  const styleInstructions  = styleProfileToInstructions(styleProfile)
  const recipientStyleRead = analyzeRecipientStyle(contextLines)
  const learningCtx        = getLearningContext()

  const contextBlock = contextLines.length
    ? `\nFull conversation (oldest → newest):\n${contextLines.join('\n')}`
    : ''

  // ── Ollama fast path ───────────────────────────────────────────────────────
  // llama3.2 times out on heavy prompts. Use a compact, focused prompt.
  if (provider === 'ollama') {
    const recentCtx  = contextLines.slice(-8).join('\n')
    const samples    = styleProfile?.recentSamples?.slice(-3).map((s) => `"${s}"`).join(', ') || ''
    const recProfile = recipientProfile?.summary || recipientStyleRead
    const openLoops  = convIntel?.openLoops?.slice(0, 1).join(' | ') || ''
    const langNote   = convLang === 'hinglish'
      ? 'The user writes in Hinglish (Hindi in Roman script) — reply in Hinglish naturally.'
      : 'Reply in English.'
    const avoidBlock = recentAIPhrases.length
      ? `\nDo NOT repeat these phrases you already sent recently: ${recentAIPhrases.map((p) => `"${p}"`).join(', ')}`
      : ''

    const ollamaPrompt = `You are writing a WhatsApp reply for the user.

Contact: ${sender}
Their message: "${message}"${recentCtx ? `\nRecent conversation:\n${recentCtx}` : ''}${openLoops ? `\nUnanswered question to address: "${openLoops}"` : ''}${samples ? `\nUser's writing style: ${samples}` : ''}${recProfile ? `\nHow ${sender} communicates: ${recProfile}` : ''}
${langNote}${avoidBlock}

Write ONE short, natural WhatsApp reply (max 30 words). Sound exactly like the user. Be specific to this message, not generic. Correct grammar. No quotes, no explanation.`

    let rawResponse = ''
    try {
      rawResponse = await claudeComplete({
        messages: [{ role: 'user', content: ollamaPrompt }],
        maxTokens: 100,
        smart: false,
      })
      const reply = rawResponse.trim().replace(/^["']|["']$/g, '').trim()

      if (reply && reply.length > 1 && reply.length < 300) {
        logger.info('Analyzer', 'Ollama reply generated', { chat_id, sender, reply: reply.slice(0, 60) })
        return {
          tone_analysis:        { scores: tone.scores, dominant: tone.dominant },
          commitment_score:     commitment.score,
          commitment_detected:  commitment.detected,
          emotion,
          psychological_state:  inferPsychState(tone.dominant, emotion),
          relationship_dynamic: recipientProfile?.possibleRelationship || 'unknown',
          subtext:              '',
          urgency_level:        tone.scores.urgency > 50 ? 'high' : tone.scores.urgency > 20 ? 'medium' : 'low',
          suggested_reply:      reply,
          should_reply:         true,
          skip_reason:          null,
          confidence:           0.65,
          method:               'ollama',
          conflict_detected:    conflictState.hasConflict,
          conflict_level:       conflictState.level,
          style_profile: styleProfile ? { formality: styleProfile.formality, style: styleProfile.style, emojiRate: styleProfile.emojiRate, msgCount: styleProfile.msgCount, language: styleProfile.language } : null,
          explanation: {
            summary: `Ollama reply for ${intent} message from ${sender}.`,
            intent, tone_read: tone.dominant,
            context_used: recentCtx ? 'recent conversation' : 'none',
            style_notes: ['ollama:fast-path'],
            recipient_style_read: recProfile,
            confidenceScore: 0.65,
          },
        }
      }
    } catch (err) {
      logger.error('Analyzer', 'Ollama error', { error: err.message })
    }

    // Ollama failed — rules fallback
    const rulesReply = buildRulesReply(intent, emotion, tone.dominant, message, sender, convLang)
    return {
      tone_analysis:        { scores: tone.scores, dominant: tone.dominant },
      commitment_score:     commitment.score, commitment_detected: commitment.detected,
      emotion,
      psychological_state:  inferPsychState(tone.dominant, emotion),
      relationship_dynamic: recipientProfile?.possibleRelationship || 'unknown',
      subtext: '', urgency_level: tone.scores.urgency > 50 ? 'high' : tone.scores.urgency > 20 ? 'medium' : 'low',
      suggested_reply: rulesReply,
      should_reply:    true,
      skip_reason:     null,
      confidence: 0.35, method: 'rules-fallback',
      conflict_detected: conflictState.hasConflict,
      conflict_level:    conflictState.level,
      style_profile: null,
      explanation: {
        summary: 'Ollama unavailable — contextual rules reply.',
        intent, tone_read: tone.dominant, context_used: 'none',
        style_notes: ['rules-fallback'], recipient_style_read: recipientStyleRead, confidenceScore: 0.35,
      },
    }
  }

  // ── Anthropic: full intelligence prompt ───────────────────────────────────

  const learningSection = learningCtx?.text
    ? `\n━━━ LEARNING FROM PAST FEEDBACK ━━━\n(${learningCtx.totalRated} rated replies — ${learningCtx.goodRate}% approval rate)\n${learningCtx.text}`
    : ''

  const antiRepeatSection = recentAIPhrases.length
    ? `\n━━━ DO NOT REPEAT THESE (already sent recently) ━━━\n${recentAIPhrases.map((p, i) => `${i + 1}. "${p}"`).join('\n')}\nEvery reply must be DIFFERENT from all of the above. Same meaning is fine, but different phrasing.`
    : ''

  const languageSection = convLang === 'hinglish'
    ? `\n━━━ LANGUAGE ━━━\nThis conversation is in Hinglish (Hindi written in Roman script). Reply in Hinglish — use natural phrases like "haan", "theek hai", "kal", "yaar", "dekh", "chal", "arre", etc. as the user does. Do NOT switch to English unless the user does.`
    : '\n━━━ LANGUAGE ━━━\nReply in English. Match the conversation\'s tone and script exactly.'

  const conflictSection = conflictState.hasConflict
    ? `\n━━━ ⚠️ CONFLICT / TENSION DETECTED ━━━\nConflict level: ${conflictState.level}. CRITICAL rules for this situation:\n• NEVER argue back or be defensive — that will make things worse\n• Do NOT correct the other person or point out their errors\n• Acknowledge their feeling first before anything else\n• Use calm, short, warm language — not lengthy explanations\n• De-escalate: lower the temperature, don't match their energy\n• If you're genuinely wrong, own it simply — don't over-apologize\n• Goal: preserve the relationship, not win the argument`
    : ''

  const convIntelBlock = convIntel ? `
━━━ CONVERSATION INTELLIGENCE ━━━
${convIntel.narrative}

Most recent exchange:
${convIntel.lastExchange}` : ''

  const recipientBlock = recipientProfile ? `
━━━ HOW ${sender.toUpperCase()} COMMUNICATES ━━━
${recipientProfile.summary}
Likely relationship type: ${recipientProfile.possibleRelationship}` : ''

  const timeStr = new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  const prompt = `You are VAC — you are NOT an AI assistant. You are GHOSTWRITING on behalf of a real person.
Your single job: produce a reply that is INDISTINGUISHABLE from what the user would naturally type.
If a human reading the conversation can tell the difference between VAC and the user → you have failed.
${languageSection}
${conflictSection}

━━━ THE INCOMING MESSAGE ━━━
From: ${sender}
Message: "${message}"
Detected intent: ${intent}
Time: ${timeStr}
${contextBlock}
${convIntelBlock}
${recipientBlock}

━━━ THE USER'S EXACT VOICE (study and replicate this) ━━━
${styleInstructions}
${learningSection}
${antiRepeatSection}

━━━ STEP 1 — DECIDE: SHOULD I EVEN REPLY? ━━━
Set should_reply = false if ANY of these are true:
• The message is a simple acknowledgment with no question (ok / cool / thanks / 👍 / theek hai / accha)
• The conversation is clearly over — they just confirmed something with no follow-up
• Replying would feel intrusive or unnecessary
• You are uncertain about context and a wrong reply could cause harm
• You have already sent multiple messages without a response (over-messaging)
Set should_reply = true only when a response is genuinely needed or expected.
When in doubt → do NOT reply (silence is safer than a bad reply).

━━━ STEP 2 — INTERNAL REASONING (think before writing) ━━━
1. REAL INTENT: What does ${sender} actually want? (beneath the literal words)
2. EMOTIONAL STATE: What are they feeling? What's the relationship temperature right now?
3. OPEN LOOPS: Any unanswered questions or hanging threads that need addressing?
4. OUTCOME: What reply creates the BEST outcome — strengthens trust, resolves the issue, keeps things smooth?
5. STRATEGY: Warm? Direct? Reassuring? Humorous? Brief?
6. AUTHENTICITY: Say it the way THIS user would — not better, not cleaner, just like them

━━━ STEP 3 — WRITE THE REPLY ━━━
Quality rules:
• Specific to THIS conversation — zero generic filler ("I understand", "That's great", etc.)
• If they asked → answer it. Don't deflect or be vague.
• If they're upset → acknowledge first, then address. Never argue, never correct, never escalate.
• Match their message depth: 5-word message → 5-word reply; detailed message → match that detail
• Never start with "I" if the user habitually doesn't
• BANNED phrases: "Of course!", "Absolutely!", "Certainly!", "Sure thing!", "No problem!", "I understand!", "That makes sense!", "Great question!"
• GRAMMAR: Casual style but correct grammar — casual ≠ broken English
• UNIQUENESS: Never repeat a phrase you've already sent to this person recently
• DIPLOMACY: Never argue, never be defensive, never escalate — always preserve the relationship

Return ONLY valid JSON (no markdown, no extra text):
{
  "reasoning": "2-3 sentences: real intent + emotional state + reply strategy",
  "should_reply": true,
  "skip_reason": "if should_reply is false, explain why. Otherwise null.",
  "tone": { "dominant": "stress|anger|politeness|enthusiasm|urgency|neutral", "stress": 0-100, "anger": 0-100, "politeness": 0-100, "enthusiasm": 0-100, "urgency": 0-100 },
  "emotion": "warm|distressed|angry|neutral|anxious|playful|excited|confused",
  "psychological_state": "precise phrase about ${sender}'s current mental state",
  "commitment_detected": true,
  "commitment_score": 0,
  "relationship_dynamic": "close friend | parent | sibling | peer | colleague | romantic partner | etc",
  "subtext": "what ${sender} actually wants beneath the literal words",
  "urgency_level": "low|medium|high|critical",
  "suggested_reply": "the exact reply in the user's voice — or null if should_reply is false",
  "confidence": 0.85,
  "explanation": {
    "summary": "one sentence: why this specific reply",
    "intent": "${intent}",
    "tone_read": "dominant tone in their message",
    "context_used": "what from the conversation influenced this reply",
    "style_notes": ["specific style choices made"],
    "recipient_style_read": "${recipientProfile?.summary || recipientStyleRead}",
    "confidenceScore": 0.85
  }
}`

  let rawResponse = ''
  try {
    rawResponse = await claudeComplete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 900,
      smart: false,
    })
    const clean  = rawResponse.replace(/```json|```/g, '').trim()
    const start  = clean.indexOf('{')
    const end    = clean.lastIndexOf('}')
    const parsed = JSON.parse(clean.slice(start, end + 1))

    // Log reasoning and reply decision
    if (parsed.reasoning) {
      logger.info('Analyzer', 'Strategic reasoning', { chat_id, sender, reasoning: parsed.reasoning })
    }
    if (parsed.should_reply === false) {
      logger.info('Analyzer', 'AI decided: skip reply', { chat_id, sender, skip_reason: parsed.skip_reason })
    }

    const explanation = {
      summary:              parsed.explanation?.summary              || parsed.reasoning || 'AI-generated reply.',
      intent:               parsed.explanation?.intent              || intent,
      tone_read:            parsed.explanation?.tone_read           || tone.dominant,
      context_used:         parsed.explanation?.context_used        || 'full conversation history',
      style_notes:          Array.isArray(parsed.explanation?.style_notes) ? parsed.explanation.style_notes : [],
      recipient_style_read: parsed.explanation?.recipient_style_read || recipientStyleRead,
      confidenceScore:      parsed.explanation?.confidenceScore      ?? parsed.confidence ?? 0.8,
      reasoning:            parsed.reasoning || null,
    }

    // If AI says don't reply, respect that (and null the reply)
    const shouldReply    = parsed.should_reply !== false  // default true unless explicitly false
    const suggestedReply = shouldReply ? (parsed.suggested_reply ?? null) : null

    return {
      tone_analysis: {
        scores: {
          stress:     parsed.tone?.stress      ?? tone.scores.stress,
          anger:      parsed.tone?.anger        ?? tone.scores.anger,
          politeness: parsed.tone?.politeness   ?? tone.scores.politeness,
          enthusiasm: parsed.tone?.enthusiasm   ?? tone.scores.enthusiasm,
          urgency:    parsed.tone?.urgency      ?? tone.scores.urgency,
        },
        dominant: parsed.tone?.dominant ?? tone.dominant,
      },
      commitment_score:     parsed.commitment_score    ?? commitment.score,
      commitment_detected:  parsed.commitment_detected ?? commitment.detected,
      emotion:              parsed.emotion             ?? emotion,
      psychological_state:  parsed.psychological_state ?? inferPsychState(tone.dominant, emotion),
      relationship_dynamic: parsed.relationship_dynamic ?? recipientProfile?.possibleRelationship ?? 'unknown',
      subtext:              parsed.subtext             ?? '',
      urgency_level:        parsed.urgency_level       ?? 'low',
      suggested_reply:      suggestedReply,
      should_reply:         shouldReply,
      skip_reason:          parsed.skip_reason         ?? null,
      confidence:           parsed.confidence          ?? 0.8,
      method:               provider,
      conflict_detected:    conflictState.hasConflict,
      conflict_level:       conflictState.level,
      style_profile: styleProfile ? {
        formality: styleProfile.formality,
        style:     styleProfile.style,
        emojiRate: styleProfile.emojiRate,
        msgCount:  styleProfile.msgCount,
        language:  styleProfile.language,
      } : null,
      explanation,
    }
  } catch (err) {
    logger.error('Analyzer', 'AI parse error', { error: err.message })

    // Try to salvage suggested_reply from raw text
    let extractedReply = null
    if (rawResponse) {
      const m = rawResponse.match(/"suggested_reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (m?.[1]) {
        extractedReply = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
      }
    }

    const usedRules = !extractedReply
    if (usedRules) extractedReply = buildRulesReply(intent, emotion, tone.dominant, message, sender, convLang)

    logger.info('Analyzer', usedRules ? 'Rules reply after parse error' : 'Partial AI reply salvaged', {
      method: usedRules ? 'rules-fallback' : 'ai-partial',
      reply:  extractedReply?.slice(0, 60),
    })

    return {
      tone_analysis:        { scores: tone.scores, dominant: tone.dominant },
      commitment_score:     commitment.score,
      commitment_detected:  commitment.detected,
      emotion,
      psychological_state:  inferPsychState(tone.dominant, emotion),
      relationship_dynamic: recipientProfile?.possibleRelationship ?? 'unknown',
      subtext:              '',
      urgency_level:        tone.scores.urgency > 50 ? 'high' : tone.scores.urgency > 20 ? 'medium' : 'low',
      suggested_reply:      extractedReply,
      confidence:           usedRules ? 0.35 : 0.55,
      method:               usedRules ? 'rules-fallback' : 'ai-partial',
      style_profile: styleProfile ? {
        formality: styleProfile.formality, style: styleProfile.style,
        emojiRate: styleProfile.emojiRate, msgCount:  styleProfile.msgCount,
      } : null,
      explanation: {
        summary:              usedRules ? 'AI parse error — contextual rules reply.' : 'Partial AI reply recovered.',
        intent, tone_read: tone.dominant, context_used: 'none',
        style_notes: [usedRules ? 'rules-fallback' : 'ai-partial'],
        recipient_style_read: recipientStyleRead,
        confidenceScore: usedRules ? 0.35 : 0.55,
      },
    }
  }
}
