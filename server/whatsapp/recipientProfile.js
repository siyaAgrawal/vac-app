/**
 * Recipient Profile — behavioral analysis of the person the user is texting.
 *
 * Analyzes their incoming messages to build a lightweight psychological profile:
 *   - How they write (length, formality, emoji use, slang)
 *   - How fast they respond
 *   - Their emotional tendencies
 *   - Their likely relationship to the user
 *
 * Used by the analyzer to adapt reply tone, depth, and strategy.
 */
import { loadMemory } from './memory.js'

function isOutbound(m) {
  return m.direction === 'out' || m.sender === 'You' || m.fromMe === true
}

export function buildRecipientProfile(chatId) {
  const mem  = loadMemory(chatId)
  const msgs = mem?.messages || []
  if (msgs.length < 3) return null

  const inMsgs = msgs.filter((m) => !isOutbound(m) && (m.body || '').trim())
  if (inMsgs.length < 2) return null

  const texts = inMsgs.map((m) => (m.body || '').trim())

  // ── Length & style ─────────────────────────────────────────────────────────
  const avgLen  = texts.reduce((s, t) => s + t.length, 0) / texts.length
  const style   = avgLen < 15  ? 'very brief (1–5 words)'
    : avgLen < 40  ? 'brief (short phrases)'
    : avgLen < 100 ? 'moderate (a sentence or two)'
    :               'detailed (multi-sentence paragraphs)'

  // ── Response speed (how fast they reply to the user's messages) ────────────
  const responseTimes = []
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1]
    const curr = msgs[i]
    if (!isOutbound(prev) || isOutbound(curr)) continue
    // Wait — we want THEIR reply speed: outbound first, then THEIR inbound
    // Reverse: user sends, they reply
  }
  // Correct: find pairs where user sent, then they replied
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1]
    const curr = msgs[i]
    if (isOutbound(prev) && !isOutbound(curr)) {
      const gap = (curr.timestamp || 0) - (prev.timestamp || 0)
      if (gap > 0 && gap < 12 * 3_600_000) responseTimes.push(gap)
    }
  }
  const avgResponseMs  = responseTimes.length > 0
    ? responseTimes.reduce((s, g) => s + g, 0) / responseTimes.length
    : null
  const responseSpeed  = avgResponseMs === null     ? 'unknown'
    : avgResponseMs < 90_000    ? 'very fast (under 90 sec)'
    : avgResponseMs < 600_000   ? 'fast (under 10 min)'
    : avgResponseMs < 3_600_000 ? 'moderate (under 1 hr)'
    :                             'slow (hours or more)'

  // ── Communication signals ──────────────────────────────────────────────────
  const emojiRe   = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|😀|😂|❤|🙏|😊|😅|💙|🤣|👍|🔥|😭/u
  const emojiRate = Math.round(texts.filter((t) => emojiRe.test(t)).length / texts.length * 100)

  const formalRe   = /\b(regards|please ensure|kindly|dear|thank you|sincerely|pursuant|as discussed)\b/i
  const isFormal   = texts.filter((t) => formalRe.test(t)).length / texts.length > 0.15

  const slangRe    = /\b(bro|yaar|nah|rn|omg|ngl|fr|tbh|lol|haha|wdym|idk|bc|coz|wbu|hbu|gg|brb|smh)\b/i
  const usesSlang  = texts.some((t) => slangRe.test(t))

  const emotionalRe   = /❤|😊|😢|😭|love|miss|sorry|worried|scared|happy|sad|💙|💔|🙏|omg|aww|haha/i
  const emotionalRate = Math.round(texts.filter((t) => emotionalRe.test(t)).length / texts.length * 100)

  const questionRate  = Math.round(texts.filter((t) => /\?/.test(t)).length / texts.length * 100)

  const startsLower   = texts.filter(
    (t) => t.length > 0 && /[a-z]/.test(t[0]) && t[0] === t[0].toLowerCase()
  ).length / texts.length > 0.6

  const usesPunct = texts.filter((t) => /[.!?]$/.test(t)).length / texts.length > 0.5

  // ── Likely relationship type ───────────────────────────────────────────────
  const possibleRelationship = isFormal         ? 'professional / teacher / authority figure'
    : emotionalRate > 50                         ? 'very close (family / best friend)'
    : emotionalRate > 25 && usesSlang            ? 'close friend'
    : usesSlang                                  ? 'peer / casual friend'
    :                                              'acquaintance / neutral contact'

  // ── Behavioral summary string (injected into the AI prompt) ──────────────
  const traits = [
    `writes ${style} messages`,
    `responds ${responseSpeed}`,
    isFormal    ? 'uses formal / polite language'   : 'writes casually',
    usesSlang   ? 'frequently uses slang and informal language' : null,
    emojiRate > 40 ? 'uses emojis very often'
      : emojiRate > 15 ? 'uses some emojis'
      : 'rarely uses emojis',
    questionRate > 40 ? 'asks lots of questions'   : null,
    emotionalRate > 40 ? 'communicates emotionally / expressively' : null,
    startsLower ? 'usually starts messages with lowercase'        : null,
    !usesPunct  ? 'usually skips punctuation'                     : null,
  ].filter(Boolean)

  return {
    msgCount:            inMsgs.length,
    avgLen:              Math.round(avgLen),
    style,
    isFormal,
    usesSlang,
    emotionalRate,
    emojiRate,
    questionRate,
    responseSpeed,
    possibleRelationship,
    summary:             traits.join(', '),
  }
}
