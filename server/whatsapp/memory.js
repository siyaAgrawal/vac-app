/**
 * Per-chat conversation memory — persisted as JSON files in data/whatsapp-memory/
 * Also builds behavioral style profiles from outgoing message history.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir    = dirname(fileURLToPath(import.meta.url))
const MEMORY_DIR = join(__dir, '../../data/whatsapp-memory')

if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true })

function memFile(chatId) {
  return join(MEMORY_DIR, chatId.replace(/[^a-zA-Z0-9@._-]/g, '_') + '.json')
}

export function loadMemory(chatId) {
  const file = memFile(chatId)
  if (!existsSync(file)) {
    return { chatId, messages: [], lastSeen: null, senderName: null, replyCount: 0 }
  }
  try { return JSON.parse(readFileSync(file, 'utf-8')) }
  catch { return { chatId, messages: [], lastSeen: null, senderName: null, replyCount: 0 } }
}

export function appendMessage(chatId, entry) {
  const mem = loadMemory(chatId)
  mem.messages.push(entry)
  if (mem.messages.length > 200) mem.messages = mem.messages.slice(-200)
  mem.lastSeen = entry.timestamp
  if (!mem.senderName && entry.sender && entry.sender !== 'You') mem.senderName = entry.sender
  saveMemory(chatId, mem)
  return mem
}

export function saveMemory(chatId, mem) {
  writeFileSync(memFile(chatId), JSON.stringify(mem, null, 2), 'utf-8')
}

export function getContextText(chatId, n = 40) {
  const mem = loadMemory(chatId)
  return mem.messages
    .slice(-n)
    .map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.sender}: ${m.body}`)
    .join('\n')
}

// ── Behavioral Style Profile ──────────────────────────────────────────────────
//
// Analyzes the user's outgoing messages for a given chat to build a profile
// that captures their natural communication style with this specific person.
// Returns null if there are too few messages to be meaningful.

// ── Language detection ─────────────────────────────────────────────────────────

const HINGLISH_RE = /\b(haan|nahi|kya|hai|ho|kar|raha|tha|thi|the|bhi|aur|lekin|kyunki|matlab|agar|toh|yaar|bhai|didi|bhaiya|kal|aaj|abhi|jao|aao|karo|dekho|suno|chalo|theek|accha|bilkul|zaroor|pata|kuch|koi|sab|bahut|thoda|jab|tab|phir|isliye|waise|sun|bol|bata|mil|aa|ja|de|le|chal|bas|arre|oye|yeh|woh|kab|kahan|kyun|kaisa|kitna|mera|tera|uska|hamara|tumhara|mujhe|tumhe|usse|hume|bolo|batao|suno|dekho|achha|thik|theek|hona|karna|jaana|rehna|milna|bolna|pyaar|dost|yaar|bhai|behan|ghar|kaam|paisa|time|sahi|galat|bura|acha|bohot|kaafi|sirf|toh|na|naa|haa|hmm|arrey|oye|aise|waise|unse|inse|unka|inka|sabse|kisne|kisko|kisse)\b/i

function detectLanguage(texts) {
  const sample = texts.slice(-20)
  const matches = sample.filter((t) => HINGLISH_RE.test(t)).length
  const ratio   = matches / Math.max(sample.length, 1)
  if (ratio > 0.15) return 'hinglish'
  return 'english'
}

export function getRecentAISentPhrases(chatId, n = 8) {
  const mem = loadMemory(chatId)
  return (mem.messages || [])
    .filter((m) => (m.direction === 'out' || m.sender === 'You') && m.aiGenerated === true)
    .slice(-n)
    .map((m) => (m.body || '').trim())
    .filter(Boolean)
}

export function buildStyleProfile(chatId) {
  const mem      = loadMemory(chatId)
  // Exclude AI-generated messages — they pollute the style profile with VAC's own
  // phrases, creating a feedback loop where VAC learns to sound like itself.
  const outgoing = mem.messages.filter(
    (m) => (m.direction === 'out' || m.sender === 'You') && !m.aiGenerated
  )

  if (outgoing.length < 3) return null

  const texts = outgoing.map((m) => (m.body || '').trim()).filter(Boolean)
  if (texts.length < 3) return null

  // --- Metrics ---
  const avgLen   = Math.round(texts.reduce((s, t) => s + t.length, 0) / texts.length)
  const avgWords = Math.round(texts.reduce((s, t) => s + t.split(/\s+/).length, 0) / texts.length)

  const emojiRe  = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|😀|😂|❤|🙏|😊|😅|🤣|👍|🔥|😭|💯|🫡|🫠/u
  const emojiRate = Math.round(texts.filter((t) => emojiRe.test(t)).length / texts.length * 100)

  const slangRe   = /\b(yaar|bro|haha|lol|btw|nah|rn|omg|ngl|ik|fr|tbh|wdym|idk|bc|coz|wbu|hbu|gg|brb|afk|smh|fyi|imo)\b/i
  const slangRate = Math.round(texts.filter((t) => slangRe.test(t)).length / texts.length * 100)

  const startsLowercase = texts.filter((t) => t.length > 0 && t[0] === t[0].toLowerCase() && /[a-z]/.test(t[0])).length / texts.length > 0.6
  const usesPunctuation = texts.filter((t) => /[.!?]$/.test(t)).length / texts.length > 0.5
  const shortMessages   = texts.filter((t) => t.length < 20).length / texts.length
  const multiLine       = texts.filter((t) => /\n/.test(t)).length / texts.length > 0.1

  // Style label
  const style =
    avgLen < 25  ? 'very brief (1-2 words typically)'   :
    avgLen < 60  ? 'brief (short phrases)'              :
    avgLen < 120 ? 'moderate (a sentence or two)'       :
    avgLen < 250 ? 'descriptive (several sentences)'    :
                   'detailed (long, thorough messages)'

  // Formality
  const formalRe  = /\b(regards|please ensure|kindly|as discussed|pursuant|accordingly|herewith|sincerely)\b/i
  const isFormal  = texts.filter((t) => formalRe.test(t)).length / texts.length > 0.15
  const isCasual  = slangRate > 25 || (startsLowercase && emojiRate > 20)
  const formality = isFormal ? 'professional/formal' : isCasual ? 'casual/informal' : 'conversational'

  // Top words (excluding noise)
  const stopWords = new Set(['the','and','for','that','this','with','have','from','they','been','were','will','your','what','when','just','like','more','also','into','then','than','there','these','those','would','could','should','about','which','after','where','their','some','here','most','over','such','even','back','does','each','well','good','very','only','know','can','all','any','not','you','me','my','is','in','it','to','of','a','i','on','at','do','as','be','by','or','an','so','if','he','she','we','up','us','no','ok','yes','yeah','hey','hi','bye','okay','sure','nope'])
  const wordFreq  = {}
  texts.forEach((t) =>
    t.toLowerCase().split(/[\s,!?.'"]+/).forEach((w) => {
      if (w.length > 2 && !stopWords.has(w)) wordFreq[w] = (wordFreq[w] || 0) + 1
    })
  )
  const topWords = Object.entries(wordFreq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)

  // Language detection
  const language = detectLanguage(texts)

  // Recent samples (last 5 outgoing, for tone reference) — real messages only
  const recentSamples = texts.slice(-5)

  // Response timing (hours between exchanges)
  const timestamps = outgoing.map((m) => m.timestamp).filter(Boolean).sort((a, b) => a - b)
  let avgResponseHours = null
  if (timestamps.length >= 4) {
    const gaps = []
    for (let i = 1; i < Math.min(timestamps.length, 20); i++) {
      const gapH = (timestamps[i] - timestamps[i - 1]) / 3_600_000
      if (gapH < 24) gaps.push(gapH)   // ignore day-long gaps
    }
    if (gaps.length > 0) avgResponseHours = +(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(1)
  }

  return {
    msgCount:         outgoing.length,
    style,
    formality,
    language,
    avgLength:        avgLen,
    avgWords,
    emojiRate,
    slangRate,
    startsLowercase,
    usesPunctuation,
    shortMessages:    Math.round(shortMessages * 100),
    multiLine,
    topWords,
    recentSamples,
    avgResponseHours,
  }
}

// ── Self-improvement: track reply outcomes ────────────────────────────────────
//
// When VAC sends a reply, we later check if the other person responded.
// A response = positive outcome (reply led to continued conversation).
// No response after N hours = neutral/negative outcome.
// This data feeds back into the analyzer to improve future replies.

export function recordReplyOutcome(chatId, replyBody, outcome) {
  // outcome: 'continued' | 'closed' | 'unknown'
  const mem = loadMemory(chatId)
  if (!mem.replyOutcomes) mem.replyOutcomes = []
  mem.replyOutcomes.push({
    body:       (replyBody || '').slice(0, 80),
    outcome,
    ts:         Date.now(),
  })
  // Keep last 50 outcomes per chat
  if (mem.replyOutcomes.length > 50) mem.replyOutcomes = mem.replyOutcomes.slice(-50)
  saveMemory(chatId, mem)
}

export function getReplyOutcomeStats(chatId) {
  const mem = loadMemory(chatId)
  const outcomes = mem.replyOutcomes || []
  const total     = outcomes.length
  const continued = outcomes.filter((o) => o.outcome === 'continued').length
  const closed    = outcomes.filter((o) => o.outcome === 'closed').length
  return {
    total,
    continuationRate: total > 0 ? Math.round(continued / total * 100) : null,
    closureRate:      total > 0 ? Math.round(closed    / total * 100) : null,
    recentOutcomes:   outcomes.slice(-5),
  }
}

// ── Suggestion preference learning ───────────────────────────────────────────

export function recordSuggestionUsed(chatId, { tone, text, wasEdited = false }) {
  const mem = loadMemory(chatId)
  if (!mem.suggestionFeedback) mem.suggestionFeedback = []
  mem.suggestionFeedback.push({
    tone,
    textLen: (text || '').length,
    wasEdited,
    ts: Date.now(),
  })
  // Keep last 100 — enough for preference learning
  if (mem.suggestionFeedback.length > 100) {
    mem.suggestionFeedback = mem.suggestionFeedback.slice(-100)
  }
  saveMemory(chatId, mem)
}

export function getSuggestionPreferences(chatId) {
  const mem = loadMemory(chatId)
  const feedback = mem.suggestionFeedback || []
  if (feedback.length === 0) return { preferredTone: null, toneDistribution: {} }

  const counts = {}
  feedback.forEach((f) => { counts[f.tone] = (counts[f.tone] || 0) + 1 })
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])

  return {
    preferredTone: sorted[0]?.[0] ?? null,
    toneDistribution: counts,
    totalUsed: feedback.length,
  }
}

export function listChats() {
  try {
    return readdirSync(MEMORY_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(readFileSync(join(MEMORY_DIR, f), 'utf-8'))
          return {
            chatId:       d.chatId,
            senderName:   d.senderName,
            lastSeen:     d.lastSeen,
            messageCount: d.messages.length,
            replyCount:   d.replyCount || 0,
          }
        } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0))
  } catch { return [] }
}
