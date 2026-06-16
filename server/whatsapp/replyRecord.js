/**
 * Reply Records — persists every auto-generated reply with full context,
 * explanation, and feedback slot. Stored per-chat.
 *
 * File layout: data/whatsapp-replies/{chatId}.json
 *   { chatId, replies: ReplyRecord[] }
 *
 * ReplyRecord: {
 *   id, chatId, senderName,
 *   incomingMsg, generatedReply,
 *   sentAt, mode ('auto'|'suggested'|'approved'|'manual'),
 *   explanation: { summary, intent, tone_read, context_used, style_notes[], recipient_style_read, confidenceScore },
 *   feedback: { rating, editedReply, submittedAt }
 * }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const __dir      = dirname(fileURLToPath(import.meta.url))
const REPLIES_DIR = join(__dir, '../../data/whatsapp-replies')

if (!existsSync(REPLIES_DIR)) mkdirSync(REPLIES_DIR, { recursive: true })

function replyFile(chatId) {
  return join(REPLIES_DIR, chatId.replace(/[^a-zA-Z0-9@._-]/g, '_') + '.json')
}

function loadReplies(chatId) {
  const f = replyFile(chatId)
  if (!existsSync(f)) return { chatId, replies: [] }
  try { return JSON.parse(readFileSync(f, 'utf-8')) }
  catch { return { chatId, replies: [] } }
}

function saveReplies(chatId, store) {
  // Keep last 500 per chat
  if (store.replies.length > 500) store.replies = store.replies.slice(-500)
  writeFileSync(replyFile(chatId), JSON.stringify(store, null, 2), 'utf-8')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create and persist a new reply record.
 */
export function createReplyRecord({ chatId, senderName, incomingMsg, generatedReply, mode, explanation }) {
  const store = loadReplies(chatId)
  const record = {
    id:             randomUUID(),
    chatId,
    senderName:     senderName || '',
    incomingMsg:    (incomingMsg  || '').slice(0, 500),
    generatedReply: (generatedReply || '').slice(0, 1000),
    sentAt:         Date.now(),
    mode:           mode || 'auto',
    explanation:    explanation || {},
    feedback: {
      rating:      null,
      editedReply: null,
      submittedAt: null,
    },
  }
  store.replies.push(record)
  saveReplies(chatId, store)
  return record
}

/**
 * Attach feedback to an existing reply record.
 */
export function setReplyFeedback(chatId, replyId, { rating, editedReply }) {
  const store = loadReplies(chatId)
  const record = store.replies.find((r) => r.id === replyId)
  if (!record) return null
  record.feedback = {
    rating,
    editedReply: editedReply || null,
    submittedAt: Date.now(),
  }
  saveReplies(chatId, store)
  return record
}

/**
 * Get recent reply records for a chat (newest first).
 */
export function getReplyHistory(chatId, limit = 50) {
  const store = loadReplies(chatId)
  return store.replies.slice(-limit).reverse()
}

/**
 * Get a single reply record by ID.
 */
export function getReplyRecord(chatId, replyId) {
  const store = loadReplies(chatId)
  return store.replies.find((r) => r.id === replyId) || null
}

/**
 * Get all reply records across all chats (for global stats).
 */
export function getAllReplyRecords(limit = 200) {
  try {
    const files = readdirSync(REPLIES_DIR).filter((f) => f.endsWith('.json'))
    const all = []
    for (const f of files) {
      try {
        const d = JSON.parse(readFileSync(join(REPLIES_DIR, f), 'utf-8'))
        all.push(...(d.replies || []))
      } catch { /* skip corrupted */ }
    }
    return all.sort((a, b) => b.sentAt - a.sentAt).slice(0, limit)
  } catch { return [] }
}
