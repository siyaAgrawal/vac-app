/**
 * Server-side tone + communication analysis using Claude.
 * Mirrors the client-side Anthropic call but keeps the key server-side.
 *
 * Deduplication: if the same text hash is already in-flight, we wait for
 * the existing promise rather than launching a second parallel request.
 * Results are cached for 60 s so rapid re-analysis of the same text
 * returns instantly without hitting the AI provider.
 */
import { claudeComplete } from './claudeClient.js'

const SYSTEM = `You are a world-class communication analyst. Analyze the tone, psychology, and intent of messages with precision.
Return ONLY valid JSON (no markdown, no explanation outside the JSON).`

// ── In-flight deduplication + short-lived result cache ────────────────────────

/** Pending promises keyed by text hash — prevents parallel duplicate requests */
const _inFlight = new Map()
/** Resolved results keyed by text hash — TTL-based */
const _cache = new Map()
const CACHE_TTL_MS = 60_000   // 60 s

function hashText(text) {
  // Fast non-crypto fingerprint — good enough for dedup
  let h = 0
  for (let i = 0; i < Math.min(text.length, 2000); i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  }
  return h.toString(36)
}

function getCached(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _cache.delete(key); return null }
  return entry.value
}

// ── Rules-based fallback (used when AI is unavailable / times out) ────────────

function rulesBasedTone(text) {
  const t = text.toLowerCase()
  const urgentWords = /urgent|asap|immediately|right now|as soon as|deadline|by end of|eod/
  const positiveWords = /thank|great|perfect|awesome|love|appreciate|happy|excited|congrats/
  const negativeWords = /sorry|problem|issue|broken|failed|wrong|can't|unable|stuck|blocked/
  const questionMark = (text.match(/\?/g) || []).length
  const exclamation  = (text.match(/!/g)  || []).length
  const wordCount    = text.trim().split(/\s+/).length

  const urgency    = urgentWords.test(t) ? 80 : Math.min(questionMark * 10 + 20, 70)
  const sentiment  = positiveWords.test(t) ? 72 : negativeWords.test(t) ? 30 : 55
  const clarity    = wordCount < 20 ? 85 : wordCount < 60 ? 70 : 55
  const tone_score = urgentWords.test(t) ? 75 : exclamation > 1 ? 65 : 50

  const tone_tags = []
  if (urgentWords.test(t))    tone_tags.push('urgent')
  if (positiveWords.test(t))  tone_tags.push('warm')
  if (negativeWords.test(t))  tone_tags.push('frustrated')
  if (questionMark > 0)       tone_tags.push('direct')
  if (tone_tags.length === 0) tone_tags.push('casual', 'friendly')

  return {
    tone_tags:      tone_tags.slice(0, 4),
    tone_score,
    urgency,
    clarity,
    sentiment,
    intent_clarity: clarity,
    trust:          60,
    overall_score:  Math.round((clarity + sentiment + (100 - urgency / 2)) / 3),
    observations: [
      'Analysis based on rules — add an Anthropic API key in Settings for AI-powered insights.',
      `Message is ${wordCount < 20 ? 'brief' : wordCount < 60 ? 'moderate' : 'detailed'} (${wordCount} words).`,
      urgentWords.test(t) ? 'Contains urgency signals — time-sensitive content detected.' : 'No strong urgency signals detected.',
    ],
    commitments:     [],
    suggested_reply: null,
    _source:         'rules',
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeToneServer(text) {
  const key = hashText(text)

  // Return cached result if fresh
  const cached = getCached(key)
  if (cached) return cached

  // Deduplicate: if already in-flight for this key, wait for it
  if (_inFlight.has(key)) return _inFlight.get(key)

  const promise = _doAnalyze(text).finally(() => _inFlight.delete(key))
  _inFlight.set(key, promise)
  return promise
}

async function _doAnalyze(text) {
  const key = hashText(text)

  const prompt = `Analyze the tone, psychology, and intent of the following message:

"""
${text.slice(0, 12000)}
"""

Return ONLY valid JSON with this exact structure:
{
  "tone_tags": ["2-5 descriptive tone labels — choose from: assertive, passive-aggressive, warm, cold, urgent, relaxed, professional, casual, empathetic, dismissive, frustrated, enthusiastic, formal, friendly, manipulative, anxious, confident, vague, direct, diplomatic"],
  "tone_score": <0-100, intensity of the dominant tone>,
  "urgency": <0-100, how urgent the message feels>,
  "clarity": <0-100, how clear and unambiguous the message is>,
  "sentiment": <0-100, 0=very negative, 50=neutral, 100=very positive>,
  "intent_clarity": <0-100, how clear the sender's intent is>,
  "trust": <0-100, how much trust/rapport the message conveys>,
  "overall_score": <0-100, overall communication effectiveness>,
  "observations": ["3 specific, insightful observations about communication psychology, subtext, or impact"],
  "commitments": ["any explicit or implicit action items promised by the sender — be precise, or return empty array"],
  "suggested_reply": "<one concrete sentence for how to reply, or null>"
}`

  try {
    const raw = await claudeComplete({
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1200,
      smart: false,
    })

    const clean = raw.replace(/```json|```/g, '').trim()
    const start = clean.indexOf('{')
    const end   = clean.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Invalid JSON from tone analysis')
    const result = JSON.parse(clean.slice(start, end + 1))

    // Cache successful result
    _cache.set(key, { value: result, ts: Date.now() })
    return result
  } catch (err) {
    // If AI is unavailable (timeout, connection refused, no provider), fall back to rules.
    // Re-throw only for real errors (bad JSON from a successful call, etc.)
    const isProviderError =
      err.message?.includes('fetch failed') ||
      err.message?.includes('No AI provider') ||
      err.message?.includes('ECONNREFUSED') ||
      err.name === 'TimeoutError' ||
      err.name === 'AbortError'

    if (isProviderError) {
      console.warn('[ToneAnalysis] AI provider unavailable, using rules-based fallback:', err.message?.slice(0, 120))
      const fallback = rulesBasedTone(text)
      // Cache fallback for a shorter time (10 s) so it retries the AI soon
      _cache.set(key, { value: fallback, ts: Date.now() - (CACHE_TTL_MS - 10_000) })
      return fallback
    }

    throw err
  }
}
