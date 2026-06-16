/**
 * VAC Test Run Mode — v2
 *
 * Continuously scans personal WhatsApp conversations for pending (unreplied)
 * messages and auto-generates + sends replies via the same AI stack as the
 * primary auto-reply system. Runs fully independently.
 *
 * Key fixes over v1:
 *  - Pushname-aware direction detection ("Siya Agrawal" = outbound, not inbound)
 *  - Group chats excluded by default  (skipGroups: true)
 *  - System / broadcast chats always excluded
 *  - Per-chat timeout (30s) so a slow Ollama call never blocks the whole scan
 *  - Bridge status verified ONCE at scan start — clear error if not ready
 *  - Detailed per-chat skip reason logged at every decision point
 *  - Fallback: if 0 personal chats have pending replies, a clear diagnostic
 *    explains WHY instead of silently sending nothing
 *
 * Safety layers (unchanged):
 *  - minPendingAgeMs guard: fresh messages go to main handler, not Test Run
 *  - processedKeys Set: never reply twice to the same message
 *  - chatCooldowns Map: per-contact minimum interval between replies
 *  - maxRepliesPerScan: hard cap per scan cycle
 */

import { loadMemory, appendMessage, saveMemory, getContextText, listChats } from './memory.js'
import { analyzeMessage } from './analyzer.js'
import { createReplyRecord } from './replyRecord.js'
import { getBridge } from './bridge.js'
import { vacEvents } from './controller.js'
import { logger } from '../logger.js'

// ── Cancellation token ────────────────────────────────────────────────────────

function createCancelToken() {
  let cancelled = false
  const cbs = []
  return {
    get cancelled() { return cancelled },
    cancel() { cancelled = true; cbs.splice(0).forEach((fn) => fn()) },
    onCancel(fn) { if (cancelled) fn(); else cbs.push(fn) },
  }
}

function sleepCancellable(ms, token) {
  return new Promise((resolve) => {
    if (token.cancelled) return resolve()
    const t = setTimeout(resolve, ms)
    token.onCancel(() => { clearTimeout(t); resolve() })
  })
}

// ── Direction helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if message m was sent BY the user.
 * userNames should include 'You' plus the user's actual WhatsApp pushname
 * (e.g. 'Siya Agrawal') so that messages stored before the direction-fix
 * still resolve correctly.
 */
function isOutboundMsg(m, userNames) {
  if (m.direction === 'out') return true
  if (m.fromMe   === true)   return true
  if (userNames.has(m.sender)) return true
  return false
}

// ── Pending reply detection ───────────────────────────────────────────────────

/**
 * Analyses a chat's memory and returns either:
 *   { pending: true,  lastInboundMsg, lastInboundTs, pendingCount, pendingMessages, reason }
 *   { pending: false, reason: <why> }
 *
 * A chat is pending when the most recent message is inbound AND old enough.
 */
function detectPendingReply(mem, minPendingAgeMs, userNames) {
  const msgs = mem?.messages
  if (!msgs || msgs.length === 0) {
    return { pending: false, reason: 'no messages in memory' }
  }

  // Find last inbound and last outbound by TIMESTAMP (more reliable than array
  // index — merged memory can have out-of-order insertions)
  let lastInbound  = null   // { msg, ts }
  let lastOutbound = null   // { msg, ts }

  for (const m of msgs) {
    const ts  = m.timestamp || 0
    const out = isOutboundMsg(m, userNames)
    if (out) {
      if (!lastOutbound || ts > lastOutbound.ts) lastOutbound = { msg: m, ts }
    } else {
      if (!lastInbound  || ts > lastInbound.ts)  lastInbound  = { msg: m, ts }
    }
  }

  if (!lastInbound) {
    return { pending: false, reason: 'no inbound messages found (all messages are outbound)' }
  }

  // Already replied: our last outbound is NEWER than their last inbound
  if (lastOutbound && lastOutbound.ts > lastInbound.ts) {
    const gap = Math.round((lastOutbound.ts - lastInbound.ts) / 1000)
    return {
      pending: false,
      reason: `already replied — your last outbound is ${gap}s after their last message`,
    }
  }

  const age = Date.now() - lastInbound.ts

  if (minPendingAgeMs > 0 && age < minPendingAgeMs) {
    return {
      pending: false,
      reason: `message too recent (${Math.round(age / 1000)}s old, threshold ${minPendingAgeMs / 1000}s — handled by main system)`,
    }
  }

  // Collect all inbound messages since our last outbound reply
  const sinceTs     = lastOutbound ? lastOutbound.ts : 0
  const pendingMsgs = msgs.filter(
    (m) => !isOutboundMsg(m, userNames) && (m.timestamp || 0) > sinceTs
  )

  if (pendingMsgs.length === 0) {
    return { pending: false, reason: 'no unreplied inbound messages found' }
  }

  return {
    pending:         true,
    reason:          `${pendingMsgs.length} unreplied message(s), last from "${lastInbound.msg.sender}" ${Math.round(age / 1000)}s ago`,
    lastInboundMsg:  lastInbound.msg,
    lastInboundTs:   lastInbound.ts,
    pendingCount:    pendingMsgs.length,
    pendingMessages: pendingMsgs,
  }
}

// ── Priority scoring ──────────────────────────────────────────────────────────

function scorePriority(pendingInfo) {
  // Every pending chat gets a minimum base so nothing is completely ignored
  let score = 20
  const ageHours = (Date.now() - (pendingInfo.lastInboundTs || 0)) / 3_600_000

  // Recency bonus: decays at 1.5 pts/hr (not 3), floor at 0
  // 24h = 64pts, 48h = 28pts, 72h = 0pts — but base of 20 keeps it alive
  score += Math.max(0, 100 - ageHours * 1.5)

  // Pile-up bonus: more unreplied messages = more important
  score += Math.min(pendingInfo.pendingCount * 10, 50)

  const t = (pendingInfo.lastInboundMsg?.body || '').toLowerCase()
  if (/urgent|asap|help|important|emergency/.test(t)) score += 50
  if (/please|need|waiting/.test(t))                  score += 20
  if (/\?/.test(t))                                   score += 20  // question
  if (/miss|love|care|worried/.test(t))               score += 15  // emotional

  return Math.round(score)
}

// ── System chats to always exclude ───────────────────────────────────────────

const ALWAYS_SKIP = new Set(['0@c.us', 'status@broadcast'])
function isSystemChat(chatId) {
  return ALWAYS_SKIP.has(chatId) || chatId.includes('broadcast')
}

// ── TestRunController ─────────────────────────────────────────────────────────

class TestRunController {
  constructor() {
    this._running = false
    this._token   = null
    this._state   = this._freshState()
    this.options  = {}
  }

  _freshState() {
    return {
      running:       false,
      startedAt:     null,
      stoppedAt:     null,
      scanCount:     0,
      totalSent:     0,
      totalSkipped:  0,
      totalErrors:   0,
      currentChatId: null,
      processedKeys: new Set(),
      chatCooldowns: new Map(),
      logs:          [],
      sentReplies:   [],
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  start(opts = {}) {
    if (this._running) return { ok: false, reason: 'Already running' }

    this._state           = this._freshState()
    this._state.running   = true
    this._state.startedAt = Date.now()
    this._running         = true

    this.options = {
      minPendingAgeMs:   opts.minPendingAgeMs   ?? 0,          // 0 = reply to all pending (main system guards real-time)
      perChatCooldownMs: opts.perChatCooldownMs  ?? 3_600_000,  // 1 hr per-contact (prevents spam, not progress)
      scanIntervalMs:    opts.scanIntervalMs     ?? 300_000,    // 5 min between scans
      maxRepliesPerScan: opts.maxRepliesPerScan  ?? 10,         // process up to 10 per scan
      skipGroups:        opts.skipGroups         ?? true,       // skip @g.us by default
      analysisTimeoutMs: opts.analysisTimeoutMs  ?? 35_000,     // per-chat AI timeout
    }

    const token = createCancelToken()
    this._token = token

    logger.info('TestRun', 'Started', this.options)
    this._addLog({ type: 'started', message: `Test Run started`, options: this.options })
    vacEvents.emit('testrun_started', { startedAt: this._state.startedAt, options: this.options })

    this._runLoop(token).catch((err) => {
      logger.error('TestRun', 'Unhandled loop error', { error: err.message })
      this.stop()
    })

    return { ok: true, startedAt: this._state.startedAt, options: this.options }
  }

  stop() {
    if (!this._running) return { ok: false, reason: 'Not running' }

    this._running         = false
    this._state.running   = false
    this._state.stoppedAt = Date.now()

    if (this._token) { this._token.cancel(); this._token = null }

    const summary = {
      stoppedAt:    this._state.stoppedAt,
      scanCount:    this._state.scanCount,
      totalSent:    this._state.totalSent,
      totalSkipped: this._state.totalSkipped,
      totalErrors:  this._state.totalErrors,
    }

    logger.info('TestRun', 'Stopped', summary)
    this._addLog({
      type:    'stopped',
      message: `Stopped — ${this._state.totalSent} sent, ${this._state.totalSkipped} skipped, ${this._state.totalErrors} errors across ${this._state.scanCount} scans`,
    })
    vacEvents.emit('testrun_stopped', summary)

    return { ok: true, ...summary }
  }

  getStatus() {
    return {
      running:       this._state.running,
      startedAt:     this._state.startedAt,
      stoppedAt:     this._state.stoppedAt,
      scanCount:     this._state.scanCount,
      totalSent:     this._state.totalSent,
      totalSkipped:  this._state.totalSkipped,
      totalErrors:   this._state.totalErrors,
      currentChatId: this._state.currentChatId,
      options:       this.options,
    }
  }

  getLogs(limit = 200)    { return this._state.logs.slice(-limit) }
  getSentReplies(limit = 100) { return this._state.sentReplies.slice(-limit).reverse() }

  // ── Loop ────────────────────────────────────────────────────────────────────

  async _runLoop(token) {
    while (!token.cancelled) {
      await this._scan(token)
      if (!token.cancelled) {
        this._addLog({
          type:    'waiting',
          message: `Next scan in ${this.options.scanIntervalMs / 1000}s…`,
        })
        await sleepCancellable(this.options.scanIntervalMs, token)
      }
    }
  }

  // ── Scan ────────────────────────────────────────────────────────────────────

  async _scan(token) {
    this._state.scanCount++
    const scanNum = this._state.scanCount

    // ── 1. Bridge connectivity check ─────────────────────────────────────────
    const bridge = getBridge()
    if (!bridge.client || bridge.status !== 'ready') {
      const msg = `Scan #${scanNum} aborted — Bridge not ready (status: "${bridge.status || 'not initialized'}"). Start the WhatsApp bridge first.`
      this._addLog({ type: 'error', message: msg })
      vacEvents.emit('testrun_scan_start',    { scanNum, pendingCount: 0, totalChats: 0, error: 'bridge_not_ready' })
      vacEvents.emit('testrun_scan_complete', { scanNum, sentThisScan: 0, totalSent: this._state.totalSent, totalSkipped: this._state.totalSkipped, totalErrors: this._state.totalErrors })
      return
    }

    // ── 2. Resolve user identity for direction detection ──────────────────────
    // The bridge sets message.author = pushname (e.g. "Siya Agrawal") for
    // outgoing messages. We include it so old memory files (stored before the
    // direction-fix) still resolve correctly.
    const pushname  = bridge.info?.pushname || null
    const userNames = new Set(['You', ...(pushname ? [pushname] : [])])

    this._addLog({
      type:    'scan_info',
      message: `Scan #${scanNum} — Bridge ✓  User identity: ${[...userNames].join(' / ')}  skipGroups: ${this.options.skipGroups}`,
    })

    // ── 3. Gather all chats + detect pending ──────────────────────────────────
    const allChats = listChats()

    const counters = { system: 0, group: 0, replied: 0, recent: 0, noMsg: 0, dedup: 0, cooldown: 0 }
    const pending  = []

    for (const chat of allChats) {
      if (token.cancelled) return

      // Always skip system / broadcast
      if (isSystemChat(chat.chatId)) {
        counters.system++
        continue
      }

      // Skip group chats unless explicitly opted in
      if (this.options.skipGroups && chat.chatId.endsWith('@g.us')) {
        counters.group++
        continue
      }

      const mem    = loadMemory(chat.chatId)
      const result = detectPendingReply(mem, this.options.minPendingAgeMs, userNames)

      if (!result.pending) {
        // Classify skip reason for counters
        const r = result.reason
        if (r.includes('already replied'))   counters.replied++
        else if (r.includes('too recent'))   counters.recent++
        else if (r.includes('no messages'))  counters.noMsg++

        // Log every individual skip with reason (visible in terminal)
        this._addLog({
          type:    'skipped',
          chatId:  chat.chatId,
          message: `↷ ${chat.senderName || chat.chatId.split('@')[0]}: ${result.reason}`,
        })
        continue
      }

      // Dedup: don't reply to the same message twice in one session
      const key = `${chat.chatId}:${result.lastInboundTs}`
      if (this._state.processedKeys.has(key)) {
        counters.dedup++
        continue
      }

      // Per-chat cooldown
      const lastSent = this._state.chatCooldowns.get(chat.chatId) || 0
      if (Date.now() - lastSent < this.options.perChatCooldownMs) {
        counters.cooldown++
        this._addLog({
          type:    'skipped',
          chatId:  chat.chatId,
          message: `↷ ${chat.senderName || chat.chatId.split('@')[0]}: cooldown active (last sent ${Math.round((Date.now() - lastSent) / 1000)}s ago)`,
        })
        continue
      }

      const score = scorePriority(result)
      pending.push({ chatId: chat.chatId, senderName: chat.senderName, mem, info: result, key, score })
    }

    // Sort highest priority first
    pending.sort((a, b) => b.score - a.score)

    // ── 4. Broadcast scan start ───────────────────────────────────────────────
    const skipLine = Object.entries(counters)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')

    vacEvents.emit('testrun_scan_start', {
      scanNum,
      pendingCount: pending.length,
      totalChats:   allChats.length,
      counters,
    })

    this._addLog({
      type:         'scan_start',
      message:      `Scan #${scanNum}: ${pending.length} PENDING / ${allChats.length} total  (skipped: ${skipLine || 'none'})`,
      scanNum,
      pendingCount: pending.length,
      totalChats:   allChats.length,
    })

    // ── 5. Diagnostic if zero pending ─────────────────────────────────────────
    if (pending.length === 0) {
      this._addLog({
        type:    'zero_pending',
        message: `No actionable chats found. Breakdown: ${skipLine}. ${
          counters.group > 0 ? `(${counters.group} group chats skipped — set skipGroups:false to include them)` : ''
        }${
          counters.replied > 0 ? ` (${counters.replied} chats already replied to)` : ''
        }`,
      })
      vacEvents.emit('testrun_scan_complete', {
        scanNum, sentThisScan: 0,
        totalSent: this._state.totalSent, totalSkipped: this._state.totalSkipped, totalErrors: this._state.totalErrors,
      })
      return
    }

    // ── 6. Process each pending chat ──────────────────────────────────────────
    let sentThisScan = 0

    for (let i = 0; i < pending.length; i++) {
      if (token.cancelled) break

      if (sentThisScan >= this.options.maxRepliesPerScan) {
        this._addLog({
          type:    'cap',
          message: `Reply cap (${this.options.maxRepliesPerScan}/scan) reached — remaining chats deferred to next scan`,
        })
        break
      }

      const sent = await this._processChat(pending[i], token)
      if (sent) sentThisScan++

      // Human-like pause between sends
      if (!token.cancelled && i < pending.length - 1) {
        await sleepCancellable(1500 + Math.random() * 4000, token)
      }
    }

    // ── 7. Scan complete ──────────────────────────────────────────────────────
    vacEvents.emit('testrun_scan_complete', {
      scanNum,
      sentThisScan,
      totalSent:    this._state.totalSent,
      totalSkipped: this._state.totalSkipped,
      totalErrors:  this._state.totalErrors,
    })

    this._addLog({
      type:         'scan_complete',
      message:      `Scan #${scanNum} complete — sent ${sentThisScan} · total: ${this._state.totalSent} replies`,
      scanNum,
      sentThisScan,
      totalSent:    this._state.totalSent,
    })
  }

  // ── Process single chat ─────────────────────────────────────────────────────

  async _processChat({ chatId, senderName, mem, info, key }, token) {
    this._state.currentChatId = chatId
    const name = senderName || chatId.split('@')[0]

    vacEvents.emit('testrun_processing', { chatId, senderName: name })
    this._addLog({ type: 'processing', chatId, message: `⚙  Generating reply for ${name} (${info.reason})` })

    try {
      // Bridge guard (re-check in case it dropped during scan)
      const bridge = getBridge()
      if (!bridge.client || bridge.status !== 'ready') {
        return this._skip(chatId, name, `bridge dropped (${bridge.status})`)
      }

      // ── AI analysis with per-chat timeout ─────────────────────────────────
      const contextText = getContextText(chatId, 40)
      const lastMsg     = info.lastInboundMsg

      let analysis
      try {
        const analysisPromise = analyzeMessage({
          chat_id:              chatId,
          sender:               name,
          message:              lastMsg.body || '',
          timestamp:            lastMsg.timestamp || Date.now(),
          conversation_history: contextText,
        })
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`AI analysis timeout (${this.options.analysisTimeoutMs / 1000}s)`)), this.options.analysisTimeoutMs)
        )
        analysis = await Promise.race([analysisPromise, timeoutPromise])
      } catch (err) {
        return this._skip(chatId, name, `analysis failed: ${err.message}`)
      }

      if (token.cancelled) return false

      // Honor AI's reply decision
      if (analysis.should_reply === false) {
        return this._skip(chatId, name, `AI decided not to reply: ${analysis.skip_reason || 'conversation appears closed or reply not needed'}`)
      }

      if (!analysis.suggested_reply) {
        return this._skip(chatId, name, `AI returned no reply (method: ${analysis.method || 'unknown'}) — check AI provider in Settings`)
      }

      // ── Pre-send guard: re-read memory to prevent duplicate sends ──────────
      // This protects against restarts where processedKeys/chatCooldowns reset.
      const freshMem  = loadMemory(chatId)
      const freshMsgs = freshMem.messages || []
      if (freshMsgs.length > 0) {
        const lastFresh = freshMsgs[freshMsgs.length - 1]
        // If the last message in memory is already outbound, we already replied
        const pushname  = bridge.info?.pushname || null
        const userNamesCheck = new Set(['You', ...(pushname ? [pushname] : [])])
        const lastIsOut = lastFresh.direction === 'out'
          || lastFresh.fromMe === true
          || userNamesCheck.has(lastFresh.sender)
        if (lastIsOut) {
          return this._skip(chatId, name, 'already replied (last message in memory is outbound — skip to prevent duplicate)')
        }

        // Also check persistent cooldown stamp from previous sessions
        const lastTestRunSent = freshMem.lastTestRunSentAt || 0
        const persistedCooldownMs = this.options.perChatCooldownMs
        if (Date.now() - lastTestRunSent < persistedCooldownMs) {
          const secsLeft = Math.round((persistedCooldownMs - (Date.now() - lastTestRunSent)) / 1000)
          return this._skip(chatId, name, `persistent cooldown active — sent ${Math.round((Date.now() - lastTestRunSent) / 1000)}s ago, ${secsLeft}s remaining`)
        }
      }

      // ── Create reply record ────────────────────────────────────────────────
      const record = createReplyRecord({
        chatId,
        senderName:     mem.senderName || name,
        incomingMsg:    lastMsg.body || '',
        generatedReply: analysis.suggested_reply,
        mode:           'test_run',
        explanation:    analysis.explanation || {},
      })

      // ── Send ───────────────────────────────────────────────────────────────
      await bridge.send(chatId, analysis.suggested_reply)

      // Persist to memory so future scans (and restarts) see the reply
      appendMessage(chatId, {
        sender:      'You',
        body:        analysis.suggested_reply,
        timestamp:   Date.now(),
        direction:   'out',
        aiGenerated: true,   // excluded from style profile learning
      })

      // Stamp the persistent cooldown so restart doesn't re-send immediately
      const stamped = loadMemory(chatId)
      stamped.lastTestRunSentAt = Date.now()
      saveMemory(chatId, stamped)

      // ── Bookkeeping ────────────────────────────────────────────────────────
      this._state.processedKeys.add(key)
      this._state.chatCooldowns.set(chatId, Date.now())
      this._state.totalSent++

      const sentEntry = {
        replyId:        record.id,
        chatId,
        senderName:     name,
        incomingMsg:    lastMsg.body || '',
        generatedReply: analysis.suggested_reply,
        sentAt:         Date.now(),
        confidence:     analysis.confidence,
        urgencyLevel:   analysis.urgency_level,
        emotion:        analysis.emotion,
        explanation:    analysis.explanation,
        feedback:       null,
      }
      this._state.sentReplies.push(sentEntry)
      if (this._state.sentReplies.length > 500) this._state.sentReplies.shift()

      const preview = analysis.suggested_reply.length > 70
        ? analysis.suggested_reply.slice(0, 70) + '…'
        : analysis.suggested_reply

      this._addLog({
        type:        'sent',
        chatId,
        senderName:  name,
        message:     `✓ Replied to ${name}: "${preview}"`,
        replyId:     record.id,
        reply:       analysis.suggested_reply,
        incomingMsg: lastMsg.body,
        confidence:  analysis.confidence,
        urgency:     analysis.urgency_level,
      })

      vacEvents.emit('testrun_sent', {
        chatId,        senderName:    name,
        reply:         analysis.suggested_reply,
        replyId:       record.id,
        incomingMsg:   lastMsg.body,
        confidence:    analysis.confidence,
        urgencyLevel:  analysis.urgency_level,
        emotion:       analysis.emotion,
        explanation:   analysis.explanation,
      })

      logger.info('TestRun', 'Reply sent', { chatId, name, len: analysis.suggested_reply.length, confidence: analysis.confidence })
      return true

    } catch (err) {
      this._state.totalErrors++
      this._addLog({ type: 'error', chatId, message: `✗ Error for ${name}: ${err.message}` })
      vacEvents.emit('testrun_error', { chatId, error: err.message })
      logger.error('TestRun', 'Process chat error', { chatId, error: err.message })
      return false
    } finally {
      this._state.currentChatId = null
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _skip(chatId, name, reason) {
    this._state.totalSkipped++
    this._addLog({ type: 'skipped', chatId, message: `↷ ${name}: ${reason}` })
    vacEvents.emit('testrun_skipped', { chatId, senderName: name, reason })
    return false
  }

  _addLog(entry) {
    const log = { ...entry, ts: Date.now() }
    this._state.logs.push(log)
    if (this._state.logs.length > 1000) this._state.logs = this._state.logs.slice(-1000)
    vacEvents.emit('testrun_log', log)
  }
}

// ── Singleton + exports ───────────────────────────────────────────────────────

let _instance = null
function getTestRun() {
  if (!_instance) _instance = new TestRunController()
  return _instance
}

export function startTestRun(opts)   { return getTestRun().start(opts) }
export function stopTestRun()        { return getTestRun().stop() }
export function getTestRunStatus()   { return getTestRun().getStatus() }
export function getTestRunLogs(n)    { return getTestRun().getLogs(n) }
export function getTestRunReplies(n) { return getTestRun().getSentReplies(n) }
