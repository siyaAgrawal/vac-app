/**
 * VAC Keyboard Suggest
 *
 * Generates 4 reply suggestions for any app/platform.
 * Called by: iOS keyboard extension, Android IME, universal Chrome extension.
 *
 * Uses instant heuristic engine (20+ context patterns) for keyboard UX speed.
 * If Anthropic key is set, falls back to Claude for richer suggestions.
 *
 * Self-learning: tracks tone preference per contact, improves over time.
 */

import { claudeComplete, getActiveProvider } from '../claudeClient.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir   = dirname(fileURLToPath(import.meta.url))
const MEM_DIR = join(__dir, '../../data/keyboard-memory')
if (!existsSync(MEM_DIR)) mkdirSync(MEM_DIR, { recursive: true })

// ── Memory ─────────────────────────────────────────────────────────────────────

function memFile(key) {
  return join(MEM_DIR, key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) + '.json')
}
function loadProfile(key) {
  const f = memFile(key)
  if (!existsSync(f)) return { key, usageLog: [], toneCount: {}, totalUsed: 0 }
  try { return JSON.parse(readFileSync(f, 'utf-8')) }
  catch { return { key, usageLog: [], toneCount: {}, totalUsed: 0 } }
}
function saveProfile(key, p) {
  writeFileSync(memFile(key), JSON.stringify(p, null, 2), 'utf-8')
}

export function recordUsage(key, { tone, text, platform }) {
  const p = loadProfile(key)
  p.usageLog.push({ ts: Date.now(), tone, text: text?.slice(0, 120), platform })
  if (p.usageLog.length > 200) p.usageLog = p.usageLog.slice(-200)
  p.toneCount[tone] = (p.toneCount[tone] || 0) + 1
  p.totalUsed = (p.totalUsed || 0) + 1
  saveProfile(key, p)
}

export function getPreferredTone(key) {
  const p = loadProfile(key)
  if (p.totalUsed < 3) return null
  const entries = Object.entries(p.toneCount)
  if (!entries.length) return null
  const [top] = entries.sort((a, b) => b[1] - a[1])
  return top[1] / p.totalUsed >= 0.45 ? top[0] : null
}

export function getUsageSample(key, n = 5) {
  const p = loadProfile(key)
  return p.usageLog.slice(-n).map((e) => e.text).filter(Boolean)
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const GOAL_MODE_HINTS = {
  persuade:  'Goal: craft replies that persuade and convince. Be compelling, not pushy.',
  reconnect: 'Goal: repair or strengthen the relationship. Be warm, genuine, empathetic.',
  impress:   'Goal: make the sender look sharp, confident, and impressive.',
  firm:      'Goal: assertive, clear replies that hold boundaries respectfully.',
  funny:     'Goal: clever, witty, fun replies that make the conversation enjoyable.',
}

function buildPrompt({ draft, contextBefore, recentMessages, preferredTone, usedSamples, goalMode, appContext }) {
  const hasDraft   = draft?.trim().length > 0
  const lastInbound = (recentMessages || []).filter(m => m.sender !== 'You').slice(-1)[0]
  const msgBlock   = recentMessages?.length
    ? recentMessages.slice(-6).map((m) => `${m.sender || 'Them'}: ${m.text}`).join('\n')
    : ''
  const ctx        = [contextBefore?.slice(-500), msgBlock].filter(Boolean).join('\n')
  const prefHint   = preferredTone ? ` Prefer "${preferredTone}" style.` : ''
  const styleHint  = usedSamples?.length ? ` User writes like: ${usedSamples.slice(-2).map(s => `"${s}"`).join(', ')}.` : ''
  const goalHint   = GOAL_MODE_HINTS[goalMode?.toLowerCase()] ? `\n${GOAL_MODE_HINTS[goalMode.toLowerCase()]}` : ''
  const appHint    = appContext ? ` Platform: ${appContext}.` : ''
  const lastInboundLine = lastInbound?.text ? `\nLast message from them: "${lastInbound.text}"` : ''

  return `You are VAC — a discreet AI that helps people text better.${appHint}${prefHint}${styleHint}${goalHint}
Mirror the user's texting style. Be direct, human, lowercase casual unless context demands otherwise.
Each suggestion should serve a different social goal: Natural (gut), Diplomatic (builds goodwill), Persuasive (advances your agenda), Warm (deepens connection).${lastInboundLine}

${ctx ? `Conversation:\n${ctx}\n\n` : ''}${hasDraft ? `Draft: "${draft}"\n` : '(no draft)\n'}
Write exactly 4 replies. Sound human and casual — NOT like an AI. Immediately sendable. No greetings like "Of course" or "Absolutely".
Tones: Natural (gut reaction), Diplomatic (builds goodwill), Persuasive (advances your agenda), Warm (deepens connection).
JSON only: {"suggestions":[{"tone":"Natural","text":"...","why":"..."},{"tone":"Diplomatic","text":"...","why":"..."},{"tone":"Persuasive","text":"...","why":"..."},{"tone":"Warm","text":"...","why":"..."}]}`
}

// ── Tone / rash / timing helpers ──────────────────────────────────────────────

function analyzeToneOfMessage(text) {
  if (!text) return { label: 'Neutral', emoji: '😐', score: 0 }
  const t = text.toLowerCase()
  if (/[A-Z]{4,}/.test(text) || /[!]{3,}/.test(text) || /\b(wtf|angry|hate|stupid|idiot|damn|hell)\b/i.test(t))
    return { label: 'Aggressive', emoji: '😤', score: -2 }
  if (/urgent|asap|now|immediately|emergency|right now|call me/i.test(t))
    return { label: 'Urgent', emoji: '⚡', score: -1 }
  if (/sorry|can't|cant|won't|wont|busy|not sure|maybe|idk/i.test(t))
    return { label: 'Negative', emoji: '😕', score: -1 }
  if (/lol|haha|😂|🤣|😆|funny|joke|hilarious|lmao/i.test(t))
    return { label: 'Playful', emoji: '😄', score: 1 }
  if (/great|love|thanks|thank|amazing|awesome|perfect|happy|glad|excited|❤|🙏/i.test(t))
    return { label: 'Positive', emoji: '😊', score: 2 }
  return { label: 'Neutral', emoji: '😐', score: 0 }
}

function bestReplyTime(lastMessageTimestamp, toneScore) {
  const ageMinutes = lastMessageTimestamp ? (Date.now() - lastMessageTimestamp) / 60000 : 0
  if (toneScore <= -2) return { label: 'Take a breath (5 min)', emoji: '🧘', delayMinutes: 5 }
  if (toneScore < 0)   return { label: 'Reply thoughtfully', emoji: '💭', delayMinutes: 2 }
  if (ageMinutes > 120) return { label: "Reply now (they're waiting)", emoji: '⚡', delayMinutes: 0 }
  return { label: 'Good time to reply', emoji: '✅', delayMinutes: 0 }
}

function detectRash(draft) {
  if (!draft?.trim()) return { rash: false, reason: null }
  const t = draft
  if (/[A-Z]{5,}/.test(t)) return { rash: true, reason: 'Typing in all caps' }
  if (/[!]{3,}/.test(t)) return { rash: true, reason: 'Too many exclamation marks' }
  if (/\b(idiot|stupid|hate you|screw|wtf|shut up|whatever|forget it|done with)\b/i.test(t))
    return { rash: true, reason: 'Aggressive language detected' }
  if (/\b(you always|you never|every time|i can't believe)\b/i.test(t))
    return { rash: true, reason: 'Escalating language — might start a fight' }
  return { rash: false, reason: null }
}

// ── Smart heuristic suggestions (instant, no AI needed) ───────────────────────
// Rich pattern matching that covers work pressure, social contexts, Hinglish, etc.

function buildFallbackSuggestions({ draft, recentMessages, contextBefore }) {
  const lastInbound = (recentMessages || []).filter(m => m.sender !== 'You').slice(-1)[0]?.text || ''
  const raw    = lastInbound || contextBefore || ''
  const lastMsg = raw.toLowerCase().trim()
  const d       = (draft || '').trim()
  const rawOrig = raw.trim()  // preserve case for caps detection

  // ── Pattern detection ──────────────────────────────────────────────────────
  const isUrgent      = /asap|urgent|immediately|right now|now!|hurry|deadline|waiting|everyone|!!+|ASAP/i.test(rawOrig)
  const isAggressive  = /[A-Z]{4,}/.test(rawOrig) || /[!]{3,}/.test(rawOrig) || /\b(wtf|angry|hate|stupid|idiot|damn|consequences|fire you|in trouble)\b/i.test(lastMsg)
  const isPressure    = /\b(report|project|task|finish|done|complete|deadline|deliver|submit|need it|by end|by tomorrow|by tonight)\b/i.test(lastMsg)
  const isQuestion    = rawOrig.includes('?') || /^(what|when|where|who|why|how|is|are|can|do|did|will|would|should|have|has|could|bata|btao)\b/i.test(lastMsg)
  const isTimeRelated = /tonight|today|tomorrow|later|now|soon|free|available|busy|weekend|time|when|meet|7pm|8pm|evening|morning|lunch/i.test(lastMsg)
  const isPositive    = /good|great|nice|love|happy|excited|glad|thanks|thank|awesome|congrat|perfect|amazing|proud|well done|great job/i.test(lastMsg)
  const isNegative    = /bad|sad|sorry|unfortunate|can't|cannot|won't|not sure|busy|can't make|miss|won't work|not possible/i.test(lastMsg)
  const isChecking    = /how are|how's|you ok|you good|what's up|wassup|sup\b|everything ok|you alright|kaisa|kaise|kya hal/i.test(lastMsg)
  const isPlanning    = /plan|let's|lets|wanna|want to|going to|should we|how about|kya sochte|chale|jaate|milenge|kab mile|kab aao/i.test(lastMsg)
  const isThanks      = /thank|thanks|appreciate|grateful|shukriya|dhanyawad/i.test(lastMsg)
  const isApology     = /sorry|apologize|my bad|forgive|maafi|sorry yaar/i.test(lastMsg)
  const isMissing     = /miss you|miss u|thinking of you|been a while|long time no see/i.test(lastMsg)
  const isConflict    = /\b(why did|you said|you told|that's not|that's wrong|you lied|you promised|you said you|you never|you always)\b/i.test(lastMsg)
  const isHelp        = /\b(help|can you|could you|would you|please|kya tum|help me|need your)\b/i.test(lastMsg)
  const isHinglish    = /\b(yaar|bhai|bro|kya|hai|nahi|haan|theek|kal|aaj|agar|mujhe|tumhe|hum|woh|toh|matlab)\b/i.test(lastMsg)
  const isInfo        = !isQuestion && rawOrig.length > 10

  // ── Draft present — build 4 variants around it ─────────────────────────────
  if (d) {
    const base = d.replace(/[.!?]+$/, '')
    if (isUrgent || isPressure) return make(
      `${base} — on it now`,
      `${base}, give me 20 mins`,
      `${base} — almost done, just finalizing`,
      `${base}! sending it shortly 🙏`
    )
    if (isTimeRelated) return make(
      `${base}!`,
      `${base} — what time works for you?`,
      `${base}, what did you have in mind?`,
      `${base}! sounds great 😊`
    )
    if (isPositive) return make(
      `${base} 😄`,
      `${base}, honestly same`,
      `${base} — really glad to hear that`,
      `${base}! that means a lot`
    )
    if (isQuestion) return make(
      `${base}`,
      `${base} — let me think`,
      `${base}, what made you ask?`,
      `${base}, what about you?`
    )
    return make(
      `${base}`,
      `${base}, honestly`,
      `${base} — for real`,
      `${base} 😊`
    )
  }

  // ── No draft — generate from message context ────────────────────────────────

  // Work pressure / urgent
  if ((isUrgent || isPressure) && isAggressive) return make(
    "on it — finishing now",
    "understood, sending it within the hour",
    "already working on it — will have it done shortly",
    "got it, i'll push everything else and finish this first 🙏"
  )
  if (isUrgent && isPressure) return make(
    "on it!",
    "finishing up now, sending shortly",
    "almost done — will send in 20 mins",
    "yes! prioritizing this right now 🙏"
  )
  if (isUrgent) return make(
    "on it!",
    "yes, dealing with it right now",
    "handling it — will update you shortly",
    "right away, on top of it 🙏"
  )

  // Aggressive / conflict
  if (isAggressive && isConflict) return make(
    "let's talk about this properly",
    "i hear you — can we sort this out calmly?",
    "i understand you're frustrated. let me explain",
    "i get it, i'm sorry — let's fix this together"
  )
  if (isAggressive) return make(
    "okay, got it",
    "understood — i'll handle it",
    "heard you loud and clear — i'll take care of it",
    "i understand, i'm on it 🙏"
  )

  // Apology
  if (isApology) return make(
    "no worries at all!",
    "it's all good, don't stress about it",
    "totally fine — these things happen",
    "honestly don't even worry ❤️"
  )

  // Thanks
  if (isThanks) return make(
    'of course!',
    'happy to help anytime',
    'anytime — let me know if you need more',
    'always here for you ❤️'
  )

  // Checking in
  if (isChecking) return make(
    "i'm good! you?",
    'doing well, thanks for asking. you?',
    "all good on my end — what's up with you?",
    "i'm good! been thinking about you tbh"
  )

  // Planning / meet up (check before isMissing so "kab milenge" hits here, not "miss you")
  if (isPlanning) return make(
    "yeah let's do it!",
    'sounds like a plan, count me in',
    'i like that — when were you thinking?',
    "yes!! i've been wanting to do that"
  )

  // Time/schedule question
  if (isTimeRelated && isQuestion) return make(
    'yeah i can make it',
    'let me check and get back to you',
    "i'm free — what did you have in mind?",
    "yeah i'd love that, what's the plan?"
  )

  // Missing / long time
  if (isMissing) return make(
    'miss you too!!',
    "yes!! we need to catch up properly",
    "same honestly — let's actually plan something",
    "ugh yes, been too long 😭❤️"
  )

  // Help request
  if (isHelp) return make(
    'yeah sure!',
    'of course — what do you need?',
    'absolutely, what can i help with?',
    'yes! happy to help ❤️'
  )

  // Conflict / accusation
  if (isConflict) return make(
    "that's not what i said",
    "let me clarify — i think there's a misunderstanding",
    "i hear you, but here's my side of it",
    "i'm sorry you feel that way — can we talk about it?"
  )

  // Positive
  if (isPositive) return make(
    'haha yes!!',
    "right?? i'm so glad",
    'exactly what i was thinking',
    'that honestly made my day ❤️'
  )

  // Negative
  if (isNegative) return make(
    'aw no worries',
    'i get it, no stress',
    "totally fine — let's figure something out",
    "don't even worry about it, seriously ❤️"
  )

  // Info sharing (they told you something)
  if (isInfo && !isQuestion) return make(
    'wait seriously?',
    'haha that makes sense actually',
    'oh interesting — tell me more',
    'omg i had no idea 😭'
  )

  // Question
  if (isQuestion) return make(
    'yeah for sure',
    "honestly i've been thinking about that too",
    "good question — i'd say yes",
    'of course! always 😊'
  )

  // Hinglish fallback
  if (isHinglish) return make(
    'haan yaar!',
    'theek hai, bata',
    'sahi bol raha hai',
    'haha bilkul ❤️'
  )

  // Generic fallback
  return make(
    'got it!',
    'makes sense, thanks for letting me know',
    'noted — i appreciate you telling me',
    'understood ❤️'
  )
}

function make(natural, thoughtful, smart, warm) {
  return [
    { tone: 'Natural',    text: natural,    why: 'instinctive reply' },
    { tone: 'Thoughtful', text: thoughtful, why: 'shows you were listening' },
    { tone: 'Smart',      text: smart,      why: 'advances the conversation' },
    { tone: 'Warm',       text: warm,       why: 'emotionally present' },
  ]
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function keyboardSuggest(opts = {}) {
  const {
    draft          = '',
    contextBefore  = '',
    contextAfter   = '',
    appContext      = '',
    recentMessages = [],
    profileKey     = 'global',
    platform       = 'unknown',
    goalMode       = 'auto',
  } = opts

  const preferredTone = getPreferredTone(profileKey)
  const usedSamples   = getUsageSample(profileKey)

  const prompt = buildPrompt({ draft, contextBefore, recentMessages, preferredTone, usedSamples, goalMode, appContext })

  // Compute rich context fields
  const lastInbound    = recentMessages.filter(m => m.sender !== 'You').slice(-1)[0]
  const toneOfIncoming = analyzeToneOfMessage(lastInbound?.text || contextBefore)
  const rashCheck      = detectRash(draft)
  const bestTime       = bestReplyTime(lastInbound?.timestamp, toneOfIncoming.score)
  const ageMinutes     = lastInbound?.timestamp ? (Date.now() - lastInbound.timestamp) / 60000 : 0
  const sendingCtx     = ageMinutes > 60
    ? 'They sent this a while ago'
    : ageMinutes > 10
      ? 'Sent ~' + Math.round(ageMinutes) + ' min ago'
      : 'Just now'

  // For keyboard: use Claude if API key is set (fast ~1-2s), otherwise instant heuristics.
  // Ollama is too slow for real-time keyboard UX (~3 min on typical hardware).
  let items
  const provider = await getActiveProvider()
  if (provider === 'anthropic') {
    try {
      const raw = await claudeComplete({
        messages:  [{ role: 'user', content: prompt }],
        maxTokens: 350,
        timeoutMs: 8_000,   // Claude haiku is fast; abort quickly if it hangs
      })
      if (!raw?.trim()) throw new Error('empty response')
      const stripped = raw.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '')
      const start    = stripped.indexOf('{')
      const end      = stripped.lastIndexOf('}')
      if (start === -1 || end === -1) throw new Error('no JSON in response')
      const parsed = JSON.parse(stripped.slice(start, end + 1))
      items = parsed.suggestions || []
      if (!items.length) throw new Error('empty suggestions array')
    } catch (err) {
      console.warn('[keyboard/suggest] Claude failed, using heuristics:', err?.message?.slice(0, 80))
      items = buildFallbackSuggestions({ draft, recentMessages, contextBefore })
    }
  } else {
    // No API key or Ollama too slow — use instant heuristics
    items = buildFallbackSuggestions({ draft, recentMessages, contextBefore })
  }

  return {
    ok:             true,
    suggestions:    items,
    profileKey,
    toneOfIncoming,
    bestReplyWindow: bestTime,
    rashWarning:    rashCheck.rash,
    rashReason:     rashCheck.reason,
    sendingContext: sendingCtx,
  }
}
