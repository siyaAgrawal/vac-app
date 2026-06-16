/**
 * Feedback Store — persistent learning layer for the auto-reply engine.
 *
 * Stores ratings on every generated reply and derives learning signals
 * that are fed back into the next reply generation cycle:
 *   - Avoid phrases that appear in low-rated replies
 *   - Prefer length/tone patterns that score high
 *   - Track per-contact accuracy
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir   = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dir, '../../data')
const FB_FILE  = join(DATA_DIR, 'reply-feedback.json')

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

// ── Schema ────────────────────────────────────────────────────────────────────

function defaultStore() {
  return {
    version: 2,
    entries: [],           // FeedbackEntry[]
    learning: {
      avoidPhrases:    [],   // strings that appear in bad replies
      goodPhrases:     [],   // strings that appear in good replies
      preferredLength: null, // 'short' | 'medium' | 'long' | null
      toneAccuracy:    {},   // { [tone]: goodRate } e.g. { warm: 0.9, urgent: 0.6 }
      totalRated:      0,
      goodCount:       0,
      neutralCount:    0,
      badCount:        0,
    },
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

function load() {
  if (!existsSync(FB_FILE)) return defaultStore()
  try {
    const d = JSON.parse(readFileSync(FB_FILE, 'utf-8'))
    return { ...defaultStore(), ...d }
  } catch { return defaultStore() }
}

function save(store) {
  writeFileSync(FB_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record feedback for a reply.
 * @param {object} entry
 * @param {string} entry.replyId
 * @param {string} entry.chatId
 * @param {string} entry.incomingMsg
 * @param {string} entry.generatedReply
 * @param {'good'|'neutral'|'bad'} entry.rating
 * @param {string|null} entry.editedReply  — user correction (if any)
 * @param {object} entry.explanation
 * @param {string} entry.senderName
 */
export function recordFeedback({
  replyId, chatId, incomingMsg, generatedReply,
  rating, editedReply = null, explanation = {}, senderName = ''
}) {
  const store = load()

  // Upsert (allow re-rating)
  const existing = store.entries.findIndex((e) => e.replyId === replyId)
  const entry = {
    replyId,
    chatId,
    senderName,
    incomingMsg: (incomingMsg || '').slice(0, 300),
    generatedReply: (generatedReply || '').slice(0, 500),
    editedReply: editedReply ? editedReply.slice(0, 500) : null,
    rating,
    explanation,
    ratedAt: Date.now(),
  }

  if (existing >= 0) {
    // Undo old rating from stats before replacing
    const old = store.entries[existing]
    if (old.rating === 'good')    store.learning.goodCount    = Math.max(0, store.learning.goodCount - 1)
    if (old.rating === 'neutral') store.learning.neutralCount = Math.max(0, store.learning.neutralCount - 1)
    if (old.rating === 'bad')     store.learning.badCount     = Math.max(0, store.learning.badCount - 1)
    store.learning.totalRated = Math.max(0, store.learning.totalRated - 1)
    store.entries[existing] = entry
  } else {
    store.entries.push(entry)
    if (store.entries.length > 2000) store.entries = store.entries.slice(-2000)
  }

  // Update counters
  store.learning.totalRated++
  if (rating === 'good')    store.learning.goodCount++
  if (rating === 'neutral') store.learning.neutralCount++
  if (rating === 'bad')     store.learning.badCount++

  // Rebuild learning signals from all entries
  _rebuildLearning(store)
  save(store)
  return entry
}

/**
 * Get stats + learning insights for the UI.
 */
export function getFeedbackStats() {
  const store = load()
  const { learning, entries } = store
  const total = learning.totalRated || 0
  const goodRate = total > 0 ? Math.round((learning.goodCount / total) * 100) : null

  // Per-chat stats
  const perChat = {}
  for (const e of entries) {
    if (!perChat[e.chatId]) perChat[e.chatId] = { good: 0, neutral: 0, bad: 0, senderName: e.senderName }
    perChat[e.chatId][e.rating]++
  }

  return {
    total,
    goodCount:       learning.goodCount,
    neutralCount:    learning.neutralCount,
    badCount:        learning.badCount,
    goodRate,
    avoidPhrases:    learning.avoidPhrases.slice(0, 10),
    goodPhrases:     learning.goodPhrases.slice(0, 10),
    preferredLength: learning.preferredLength,
    toneAccuracy:    learning.toneAccuracy,
    recentEntries:   entries.slice(-20).reverse(),
    perChat,
  }
}

/**
 * Return learning context to inject into the AI prompt.
 * Called by analyzer.js before every reply generation.
 */
export function getLearningContext() {
  const store = load()
  const { learning } = store
  if (learning.totalRated < 3) return null  // not enough data yet

  const lines = []

  if (learning.avoidPhrases.length > 0) {
    lines.push(`AVOID these phrases (users rated replies with them negatively): ${learning.avoidPhrases.slice(0, 6).map((p) => `"${p}"`).join(', ')}.`)
  }
  if (learning.goodPhrases.length > 0) {
    lines.push(`These patterns were rated highly: ${learning.goodPhrases.slice(0, 4).map((p) => `"${p}"`).join(', ')}.`)
  }
  if (learning.preferredLength) {
    lines.push(`Users preferred ${learning.preferredLength} replies — calibrate length accordingly.`)
  }

  const goodRate = learning.totalRated > 0
    ? Math.round((learning.goodCount / learning.totalRated) * 100)
    : null

  return {
    text: lines.join(' '),
    goodRate,
    totalRated: learning.totalRated,
  }
}

// ── Internal: rebuild learning signals from all rated entries ─────────────────

function _rebuildLearning(store) {
  const badEntries    = store.entries.filter((e) => e.rating === 'bad')
  const goodEntries   = store.entries.filter((e) => e.rating === 'good')

  // Extract n-grams from bad replies to form avoidance list
  store.learning.avoidPhrases = _extractDistinctPhrases(
    badEntries.map((e) => e.generatedReply),
    goodEntries.map((e) => e.generatedReply),
    6,
  )

  // Extract n-grams that appear in good replies but NOT in bad ones
  store.learning.goodPhrases = _extractDistinctPhrases(
    goodEntries.map((e) => e.generatedReply),
    badEntries.map((e) => e.generatedReply),
    4,
  )

  // Preferred length from good entries
  if (goodEntries.length >= 3) {
    const avgLen = goodEntries.reduce((s, e) => s + (e.generatedReply || '').length, 0) / goodEntries.length
    store.learning.preferredLength =
      avgLen < 40  ? 'short (under 40 chars)' :
      avgLen < 120 ? 'medium (1-2 sentences)' :
                     'detailed (3+ sentences)'
  }

  // Tone accuracy by dominant tone from explanation
  const toneBuckets = {}
  for (const e of store.entries) {
    const tone = e.explanation?.tone_read || e.explanation?.incomingTone
    if (!tone) continue
    if (!toneBuckets[tone]) toneBuckets[tone] = { good: 0, total: 0 }
    toneBuckets[tone].total++
    if (e.rating === 'good') toneBuckets[tone].good++
  }
  for (const [tone, b] of Object.entries(toneBuckets)) {
    store.learning.toneAccuracy[tone] = Math.round((b.good / b.total) * 100)
  }
}

/** Extract short phrases (2-4 words) unique to one set over another */
function _extractDistinctPhrases(targetTexts, excludeTexts, limit) {
  const targetFreq  = _phraseFreq(targetTexts)
  const excludeFreq = _phraseFreq(excludeTexts)

  return Object.entries(targetFreq)
    .filter(([phrase, count]) => count >= 2 && !excludeFreq[phrase])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase]) => phrase)
}

function _phraseFreq(texts) {
  const freq = {}
  for (const text of texts) {
    const words = (text || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`
      freq[bigram] = (freq[bigram] || 0) + 1
    }
  }
  return freq
}
