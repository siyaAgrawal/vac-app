/**
 * VAC WhatsApp Controller
 * Orchestrates: bridge → analyzer → reply record → queue → sender → feedback
 *
 * Config (data/whatsapp-config.json):
 *   autoReply:          false   — global default (off/suggest/auto)
 *   replyDelay:         { min: 2000, max: 7000 }
 *   ignoredChats:       []      — chat IDs to always skip
 *   allowedChats:       []      — if non-empty, only reply to these
 *   maxQueuePerChat:    3
 *   sentimentThreshold: 40      — min urgency/stress to auto-reply (0 = always)
 *   perChatConfig:      {}      — per-chat mode overrides: { [chatId]: { mode } }
 *
 * Per-chat mode values: 'off' | 'suggest' | 'auto'
 */
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBridge, resetBridge } from './bridge.js'
import { analyzeMessage } from './analyzer.js'
import { ReplyQueue } from './queue.js'
import { appendMessage, getContextText, loadMemory, saveMemory, recordReplyOutcome } from './memory.js'
import { createReplyRecord } from './replyRecord.js'
import { logger } from '../logger.js'

const __dir      = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = join(__dir, '../../data/whatsapp-config.json')

// ── Event bus ─────────────────────────────────────────────────────────────────
export const vacEvents = new EventEmitter()
vacEvents.setMaxListeners(50)

// ── Config ────────────────────────────────────────────────────────────────────

function defaultConfig() {
  return {
    autoReply:          false,
    replyDelay:         { min: 2000, max: 8000 },
    ignoredChats:       [],
    allowedChats:       [],
    maxQueuePerChat:    3,
    sentimentThreshold: 0,   // 0 = no threshold (always reply when mode=auto)
    perChatConfig:      {},  // { [chatId]: { mode: 'off'|'suggest'|'auto' } }
  }
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return defaultConfig()
  try { return { ...defaultConfig(), ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) } }
  catch { return defaultConfig() }
}

export function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
}

export function patchConfig(patch) {
  const cfg = { ...loadConfig(), ...patch }
  saveConfig(cfg)
  return cfg
}

/** Patch a single chat's per-chat config */
export function setChatConfig(chatId, patch) {
  const cfg = loadConfig()
  cfg.perChatConfig = cfg.perChatConfig || {}
  cfg.perChatConfig[chatId] = { ...(cfg.perChatConfig[chatId] || {}), ...patch }
  saveConfig(cfg)
  return cfg.perChatConfig[chatId]
}

/**
 * Resolve effective mode for a chat.
 * Per-chat override wins over global setting.
 * Returns: 'off' | 'suggest' | 'auto'
 */
function getEffectiveMode(chatId, cfg) {
  const perChat = cfg.perChatConfig?.[chatId]
  if (perChat?.mode) return perChat.mode
  // Map legacy boolean autoReply → mode string
  return cfg.autoReply ? 'auto' : 'suggest'
}

// ── Conversation log (in-memory, last 500 events) ─────────────────────────────
const conversationLog = []
function logEvent(event) {
  conversationLog.push({ ...event, loggedAt: Date.now() })
  if (conversationLog.length > 500) conversationLog.splice(0, conversationLog.length - 500)
  vacEvents.emit('log', event)
}

export function getConversationLog(limit = 100) {
  return conversationLog.slice(-limit)
}

// ── Controller class ──────────────────────────────────────────────────────────

class VACController {
  constructor() {
    this.bridge = getBridge()
    this.queue  = new ReplyQueue()
    this._started = false

    // Forward queue events
    this.queue.on('sent', (d) => {
      logEvent({ type: 'reply_sent', ...d })
      vacEvents.emit('reply_sent', d)
    })
    this.queue.on('queued',       (d) => vacEvents.emit('reply_queued',  d))
    this.queue.on('error',        (d) => logEvent({ type: 'queue_error', ...d }))
    this.queue.on('typing_start', (d) => vacEvents.emit('typing_start',  d))

    // Forward bridge status
    this.bridge.on('status', (d) => {
      vacEvents.emit('bridge_status', d)
      if (d.status === 'disconnected' || d.status === 'reconnecting') {
        this._chatsLoaded  = false
        this._chatsLoading = false
        this._cachedChats  = null
      }
    })
    this.bridge.on('qr',    (d) => vacEvents.emit('qr',    d))
    this.bridge.on('ready', (d) => {
      vacEvents.emit('ready', d)
      if (!this._chatsLoaded && !this._chatsLoading) {
        setTimeout(() => this._loadAllChats(), 8000)
      }
    })
  }

  async _loadAllChats() {
    if (this._chatsLoaded || this._chatsLoading) return
    this._chatsLoading = true
    let chats
    try {
      logger.info('Controller', 'Loading all WhatsApp chats…')
      vacEvents.emit('chats_loading', { status: 'loading' })
      chats = await this.bridge.fetchAllChats()
    } catch (fetchErr) {
      logger.error('Controller', 'fetchAllChats threw — skipping chat load, bridge stays alive', { error: fetchErr.message })
      this._chatsLoading = false
      this._chatsLoaded  = false
      return
    }
    try {
      logger.info('Controller', `Loaded ${chats.length} chats`)

      // Resolve the user's own name for direction detection.
      // bridge.fetchAllChats sets author = pushname (e.g. "Siya Agrawal") for fromMe
      // messages, not the literal string "You", so we must compare against both.
      const myName = this.bridge.info?.pushname || null

      for (const chat of chats) {
        const mem = loadMemory(chat.chatId)
        const fetchedMsgs = chat.messages.map((m) => {
          const isFromMe = m.fromMe === true
            || m.author === 'You'
            || (myName && m.author === myName)
          return {
            sender:    isFromMe ? 'You' : m.author,
            body:      m.text,
            timestamp: m.timestamp,
            direction: isFromMe ? 'out' : 'in',
          }
        })

        // Always merge bridge data into memory — bridge is ground truth for message
        // direction (fromMe flag). Never skip the update based on message count:
        // old memory may have all-inbound directions from before the direction fix.
        //
        // Strategy: keep memory messages outside the bridge's time window, replace
        // the overlap window with fresh bridge data (correct directions), keep any
        // live messages newer than the latest bridge message.
        if (fetchedMsgs.length > 0) {
          const firstFetchedTs = fetchedMsgs[0]?.timestamp ?? 0
          const lastFetchedTs  = fetchedMsgs.at(-1)?.timestamp ?? 0

          // Messages in memory older than the bridge window (keep as-is)
          const olderThanWindow = mem.messages.filter(
            (m) => (m.timestamp || 0) < firstFetchedTs
          )
          // Messages in memory newer than the bridge window (live, not yet in bridge)
          const newerThanWindow = mem.messages.filter(
            (m) => (m.timestamp || 0) > lastFetchedTs
          )

          // Deduplicate by timestamp+body fingerprint to avoid double-storing
          const seen = new Set()
          const merged = [...olderThanWindow, ...fetchedMsgs, ...newerThanWindow]
            .filter((m) => {
              const key = `${m.timestamp}|${String(m.body ?? '').slice(0, 30)}`
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })

          mem.messages   = merged.slice(-200)
          mem.lastSeen   = chat.lastMessageTime
          mem.senderName = chat.chatName
          saveMemory(chat.chatId, mem)
        } else if (!mem.senderName) {
          mem.senderName = chat.chatName
          saveMemory(chat.chatId, mem)
        }
      }

      this._chatsLoaded = true
      this._cachedChats = chats
      logEvent({ type: 'chats_loaded', count: chats.length })
      vacEvents.emit('chats_loaded', { chats })
    } catch (err) {
      logger.error('Controller', '_loadAllChats error', { error: err.message })
    } finally {
      this._chatsLoading = false
    }
  }

  start() {
    if (this._started) return
    this._started = true

    // Store outgoing messages in memory
    this.bridge.on('message_out', (parsed) => {
      appendMessage(parsed.chat_id, {
        sender:    'You',
        body:      parsed.message,
        timestamp: parsed.timestamp,
        direction: 'out',
      })
    })

    // Handle incoming messages
    this.bridge.on('message', async (parsed) => {
      // If they replied after we sent something → record positive outcome
      try {
        const mem      = loadMemory(parsed.chat_id)
        const messages = mem.messages || []
        if (messages.length >= 2) {
          // Find the most recent outbound AI-generated message before this inbound
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i]
            if ((m.direction === 'out' || m.sender === 'You') && m.aiGenerated) {
              recordReplyOutcome(parsed.chat_id, m.body, 'continued')
              break
            }
            if (m.direction === 'in' || (m.sender !== 'You' && !m.aiGenerated)) break
          }
        }
      } catch (_) {}

      await this._handleMessage(parsed)
    })

    this.bridge.init().catch((err) => {
      logger.error('Controller', 'Bridge init error', { error: err.message })
    })

    logger.info('Controller', 'VAC WhatsApp controller started')
  }

  async _handleMessage(parsed) {
    const { chat_id, sender, message, timestamp, chat_name } = parsed
    const cfg  = loadConfig()
    const mode = getEffectiveMode(chat_id, cfg)

    // ── Filters ───────────────────────────────────────────────────────────────
    if (cfg.ignoredChats.includes(chat_id)) return
    if (cfg.allowedChats.length > 0 && !cfg.allowedChats.includes(chat_id)) return
    if (mode === 'off') {
      // Still persist + analyze for the Live page, just never reply
    }

    // ── Persist ───────────────────────────────────────────────────────────────
    appendMessage(chat_id, { sender, body: message, timestamp, direction: 'in' })
    const contextText = getContextText(chat_id, 40)

    logEvent({ type: 'message_received', chat_id, sender, message: message.slice(0, 100), timestamp })
    vacEvents.emit('message', { ...parsed, contextText })

    // ── Analyze ───────────────────────────────────────────────────────────────
    let analysis
    try {
      analysis = await analyzeMessage({
        chat_id,
        sender,
        message,
        timestamp,
        conversation_history: contextText,
      })
      logger.info('Controller', 'Analysis complete', {
        chat_id, sender, method: analysis.method,
        urgency: analysis.urgency_level, emotion: analysis.emotion,
        hasReply: Boolean(analysis.suggested_reply),
      })
    } catch (err) {
      logger.error('Controller', 'Analysis error', { error: err.message, chat_id })
      analysis = {
        suggested_reply: null, confidence: 0, method: 'error',
        explanation: { summary: 'Analysis error', intent: 'unknown', tone_read: 'unknown',
                       context_used: 'none', style_notes: [], recipient_style_read: 'unknown', confidenceScore: 0 },
      }
    }

    logEvent({ type: 'analysis_done', chat_id, sender, analysis })
    vacEvents.emit('analysis', { chat_id, sender, message, analysis, mode })

    // ── Sentiment threshold gate ───────────────────────────────────────────
    if (mode === 'off') return   // never reply

    // ── Reply decision gate ────────────────────────────────────────────────
    // Both the pre-check (rule-based) and the AI can decide not to reply.
    if (analysis.should_reply === false || !analysis.suggested_reply) {
      const reason = analysis.skip_reason || 'no reply needed'
      logEvent({ type: 'reply_skipped', chat_id, sender, reason })
      logger.info('Controller', `Reply skipped: ${reason}`, { chat_id })
      return
    }

    const reply = analysis.suggested_reply
    if (!reply) return

    const threshold = cfg.sentimentThreshold || 0
    if (threshold > 0) {
      const maxScore = Math.max(
        analysis.tone_analysis?.scores?.urgency    || 0,
        analysis.tone_analysis?.scores?.stress     || 0,
        analysis.tone_analysis?.scores?.enthusiasm || 0,
        analysis.tone_analysis?.scores?.politeness || 0,
      )
      if (maxScore < threshold) {
        // Below threshold → always suggest, never auto-send
        vacEvents.emit('suggestion', { chat_id, sender, message, reply, analysis, mode: 'suggest', replyId: null })
        logEvent({ type: 'threshold_suggest', chat_id, score: maxScore, threshold })
        return
      }
    }

    // ── Create reply record (for explainability + feedback) ───────────────
    const mem    = loadMemory(chat_id)
    const record = createReplyRecord({
      chatId:         chat_id,
      senderName:     mem.senderName || sender,
      incomingMsg:    message,
      generatedReply: reply,
      mode:           mode === 'auto' ? 'auto' : 'suggested',
      explanation:    analysis.explanation || {},
    })

    if (mode === 'auto') {
      // ── Auto-send via queue ─────────────────────────────────────────────
      this.queue.enqueue({
        chatId:   chat_id,
        text:     reply,
        replyId:  record.id,
        analysis,
        client:   this.bridge.client,
      })

      appendMessage(chat_id, {
        sender:      'You',
        body:        reply,
        timestamp:   Date.now(),
        direction:   'out',
        aiGenerated: true,   // excluded from style profile learning
      })

      const m = loadMemory(chat_id)
      m.replyCount = (m.replyCount || 0) + 1
      saveMemory(chat_id, m)
    } else {
      // ── Suggest only ────────────────────────────────────────────────────
      vacEvents.emit('suggestion', { chat_id, sender, message, reply, analysis, replyId: record.id, mode: 'suggest' })
      logEvent({ type: 'suggestion_ready', chat_id, replyId: record.id, reply: reply.slice(0, 100) })
    }
  }

  /** Manually send a reply (from frontend "Send" button) */
  async sendManual(chatId, text, replyId = null) {
    await this.bridge.send(chatId, text)
    appendMessage(chatId, {
      sender: 'You',
      body: text,
      timestamp: Date.now(),
      direction: 'out',
      aiGenerated: Boolean(replyId),
    })
    logEvent({ type: 'manual_send', chatId, text: text.slice(0, 100) })
    vacEvents.emit('reply_sent', { chatId, text, manual: true, replyId })
  }

  /**
   * Fully stop the bridge and reset all state so start() works cleanly next time.
   * Destroys the Puppeteer/Chrome session, clears the bridge singleton, and
   * resets this controller so it can be re-initialized from scratch.
   */
  async stop() {
    logger.info('Controller', 'Stopping bridge…')
    try { await this.bridge.destroy() } catch (_) {}
    resetBridge()            // next getBridge() creates a fresh instance
    this._started       = false
    this._chatsLoaded   = false
    this._chatsLoading  = false
    this._cachedChats   = null
    // Replace the bridge reference with a fresh (not yet initialized) instance
    this.bridge = getBridge()
    // Re-attach bridge event forwarding to the new instance
    this.bridge.on('status', (d) => {
      vacEvents.emit('bridge_status', d)
      if (d.status === 'disconnected' || d.status === 'reconnecting') {
        this._chatsLoaded  = false
        this._chatsLoading = false
        this._cachedChats  = null
      }
    })
    this.bridge.on('qr',    (d) => vacEvents.emit('qr',    d))
    this.bridge.on('ready', (d) => {
      vacEvents.emit('ready', d)
      if (!this._chatsLoaded && !this._chatsLoading) {
        setTimeout(() => this._loadAllChats(), 8000)
      }
    })
    vacEvents.emit('bridge_status', { status: 'disconnected' })
    logger.info('Controller', 'Bridge stopped — ready to restart')
  }
}

let _controller = null
export function getController() {
  if (!_controller) _controller = new VACController()
  return _controller
}
