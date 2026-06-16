/**
 * Clarity local API.
 * API key is loaded automatically from macOS Keychain → .env → data/keys.json.
 * No manual editing required — use the Settings page to enter the key once.
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/settings                — key status + WhatsApp config
 *   POST /api/settings/apikey         — save API key (persists to Keychain + .env)
 *   DELETE /api/settings/apikey       — clear API key
 *   POST /api/whatsapp-import         — parse .txt export → commitments + messages
 *   POST /api/chat                    — streaming Claude chat (SSE)
 *   POST /api/analyze-tone            — server-side Claude tone analysis
 *   POST /api/check-fulfillment       — AI commitment fulfillment check
 *   POST /api/extract-commitments     — extract commitments from any text
 */
import 'dotenv/config'

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { networkInterfaces, hostname as osHostname } from 'node:os'
import { execSync } from 'node:child_process'

function getMdnsHostname() {
  try {
    // macOS: use LocalHostName (mDNS name) — always ends with .local
    const local = execSync('scutil --get LocalHostName', { timeout: 1000 }).toString().trim()
    if (local) return `${local}.local`
  } catch (_) {}
  const h = osHostname()
  return h.endsWith('.local') ? h : `${h}.local`
}
import { parseWhatsAppExport } from './parseWhatsAppExport.js'
import { extractCommitmentsWithOpenAI } from './openaiExtract.js'
import { heuristicExtractFromText } from './heuristicExtract.js'
import { claudeStream, claudeComplete, isOllamaAvailable, getActiveProvider, resetProviderCache } from './claudeClient.js'
import { checkFulfillment } from './fulfillmentCheck.js'
import { analyzeToneServer } from './toneAnalysis.js'
import { getController, vacEvents, loadConfig, patchConfig, getConversationLog, setChatConfig } from './whatsapp/controller.js'
import { listChats, loadMemory, recordSuggestionUsed } from './whatsapp/memory.js'
import { bootstrapApiKey, setApiKey, getKeyStatus, clearApiKey } from './keyStore.js'
import { recordFeedback, getFeedbackStats } from './whatsapp/feedbackStore.js'
import { getReplyHistory, setReplyFeedback, getReplyRecord } from './whatsapp/replyRecord.js'
import { startTestRun, stopTestRun, getTestRunStatus, getTestRunLogs, getTestRunReplies } from './whatsapp/testRun.js'
import { generateSuggestions, improveDraft } from './whatsapp/suggestMultiple.js'
import { generateKeyboardAssist } from './whatsapp/keyboardAssistant.js'
import { keyboardSuggest, recordUsage as recordKeyboardUsage, getPreferredTone } from './keyboard/suggest.js'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Bootstrap API key before anything else ────────────────────────────────────
bootstrapApiKey()

const PORT = Number(process.env.CLARITY_API_PORT || 8787)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

const app = express()
app.use(cors({ origin: true }))
app.use(express.json({ limit: '20mb' }))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIp() {
  const nets = networkInterfaces()
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}


// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const ollama = await isOllamaAvailable()
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim())
  res.json({
    ok: true,
    service: 'clarity-api',
    openai,
    anthropic,
    ollama,
    ai: anthropic || openai || ollama,
    provider: anthropic ? 'anthropic' : ollama ? 'ollama' : openai ? 'openai' : null,
    localIp:       getLocalIp(),
    localHostname: getMdnsHostname(),
    note: anthropic
      ? 'Claude (Anthropic) active'
      : ollama
      ? 'Ollama local AI active (llama3.2:3b)'
      : 'No AI key — open Settings to add your Anthropic API key',
  })
})

// ─── Settings ─────────────────────────────────────────────────────────────────

/** GET /api/settings — current key status + WhatsApp config */
app.get('/api/settings', async (_req, res) => {
  const ollama = await isOllamaAvailable()
  const bridge = getController().bridge
  res.json({
    apiKey: getKeyStatus(),
    provider: process.env.ANTHROPIC_API_KEY?.trim()
      ? 'anthropic'
      : ollama ? 'ollama' : null,
    ollama,
    whatsapp: bridge.getStatus(),
    config: loadConfig(),
  })
})

/** POST /api/settings/apikey — save key, hot-reload immediately */
app.post('/api/settings/apikey', (req, res) => {
  const { key } = req.body ?? {}
  if (!key?.trim()) return res.status(400).json({ error: 'key is required' })
  try {
    const result = setApiKey(key)
    resetProviderCache()   // force provider re-detection
    res.json({ ok: true, ...result, status: getKeyStatus() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** DELETE /api/settings/apikey — clear key from all stores */
app.delete('/api/settings/apikey', (_req, res) => {
  clearApiKey()
  resetProviderCache()
  res.json({ ok: true })
})

// ─── WhatsApp Import ─────────────────────────────────────────────────────────

app.post('/api/whatsapp-import', upload.single('file'), async (req, res) => {
  try {
    let raw = ''
    if (req.file?.buffer) {
      raw = req.file.buffer.toString('utf8')
    } else if (typeof req.body?.text === 'string') {
      raw = req.body.text
    } else {
      return res.status(400).json({ error: 'Send multipart field "file" or JSON { "text": "..." }' })
    }

    const { plainText, messages } = parseWhatsAppExport(raw)
    if (!plainText.trim()) {
      return res.status(400).json({ error: 'No messages parsed. Is this a WhatsApp export .txt?' })
    }

    const openaiKey = process.env.OPENAI_API_KEY?.trim()
    const provider = await getActiveProvider()

    let commitments
    let method = 'rules'

    if (provider === 'anthropic' || provider === 'ollama') {
      // Use Claude for commitment extraction — precision focused on Siya's real promises
      const raw = await claudeComplete({
        system: `You are analyzing a WhatsApp conversation. Your job is to extract ONLY the commitments and promises that the user (labelled "You" in the conversation) explicitly made TO other people.

Rules — ONLY include an item if ALL of these are true:
1. The message was sent BY "You" (the user)
2. It contains an explicit first-person promise: "I'll", "I will", "let me", "I promise", "I'll get back", "I'll send", "I'll call", "I'll check", "I'll fix", "I'll handle", "count on me", etc.
3. The action is specific (not just "ok" or "sure")

SKIP:
- Messages from OTHER people (requests, demands they're making to you)
- Vague agreements ("ok", "sure", "sounds good")
- "We should" suggestions without a clear personal commitment
- System messages

For each valid commitment, identify:
- "action": concise imperative summary of what you committed to do (≤ 150 chars)
- "person": the name of the person you made this promise to (from conversation context)
- "due_iso": ISO 8601 datetime if a timeframe was mentioned, else null
- "critical": true if urgent / ASAP / today / money / legal

Respond ONLY with valid JSON (no markdown, no explanation):
{"items":[{"action":"...","person":"...","due_iso":"ISO or null","critical":true|false}]}
If nothing qualifies, return {"items":[]}`,
        messages: [{ role: 'user', content: plainText.slice(0, 14000) }],
        maxTokens: 2000,
        smart: false,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const start = clean.indexOf('{')
      const end = clean.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(clean.slice(start, end + 1))
        const items = Array.isArray(parsed.items) ? parsed.items : []
        const now = new Date()
        const { randomUUID } = await import('node:crypto')
        commitments = items
          .filter((e) => e.action && String(e.action).length > 5)
          .map((e) => {
            const person = String(e.person || 'Unknown').slice(0, 80)
            const action = String(e.action || 'Untitled').slice(0, 240)
            let dueDate = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10)
            let dueTime = '17:00'
            let status = 'pending'
            if (e.due_iso) {
              const d = new Date(e.due_iso)
              if (!Number.isNaN(d.getTime())) {
                dueDate = d.toISOString().slice(0, 10)
                dueTime = d.toISOString().slice(11, 16)
                if (d.getTime() < Date.now()) status = 'overdue'
              }
            }
            return {
              id: randomUUID(),
              text:    action,
              person,
              action,
              urgency: e.critical ? 'high' : 'medium',
              status,
              dueDate,
              dueTime,
              source:  person !== 'Unknown' ? `WhatsApp – ${person}` : 'WhatsApp import',
              createdAt: now.toISOString(),
              notifyBefore: e.critical ? 30 : 60,
              notified: false,
              tags: ['whatsapp', 'claude', person.toLowerCase()],
            }
          })
        method = 'claude'
      } else {
        commitments = heuristicExtractFromText(plainText)
      }
    } else if (openaiKey) {
      commitments = await extractCommitmentsWithOpenAI(openaiKey, plainText)
      method = 'openai'
    } else {
      commitments = heuristicExtractFromText(plainText)
    }

    res.json({
      commitments,
      messages,
      meta: {
        messageCount: messages.length,
        usedOpenAI: method === 'openai',
        usedClaude: method === 'claude',
        method,
      },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Import failed' })
  }
})

// ─── Chat (SSE streaming) ─────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, waContext, systemExtra, activeChatLabel } = req.body ?? {}

  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' })
  }

  const provider = await getActiveProvider()
  if (!provider) {
    return res.status(503).json({ error: 'No AI available. Start Ollama or add ANTHROPIC_API_KEY to .env' })
  }

  // Smaller Ollama models need tighter context windows
  const isOllama = (await getActiveProvider()) === 'ollama'
  const maxContext = isOllama ? 6000 : 60000

  // Build system prompt
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  let system = `You are a sharp, empathetic conversation analyst and personal assistant. Today is ${today}.
You help users understand WhatsApp conversations — relationship dynamics, emotional patterns, commitments, and how to communicate better.
Be honest, direct, and concise. Use bullet points. Respond in the user's language.`

  if (activeChatLabel?.trim()) {
    system += `\nChat label: "${activeChatLabel}"`
  }

  if (waContext?.trim()) {
    // For smaller models, take the most recent messages (end of the chat) as they're most relevant
    const ctx = waContext.length > maxContext
      ? '...[earlier messages truncated]\n' + waContext.slice(-maxContext)
      : waContext
    system += `\n\nWhatsApp conversation to analyse:\n---\n${ctx}\n---\nAnswer questions about this conversation directly and specifically.`
  }

  if (systemExtra?.trim()) {
    system += `\n${systemExtra}`
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)

  try {
    await claudeStream({
      system,
      messages,
      maxTokens: 2048,
      smart: false,
      onChunk: (text) => send({ type: 'chunk', text }),
    })
    send({ type: 'done' })
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : 'Stream error' })
  } finally {
    res.end()
  }
})

// ─── Analyze Tone ─────────────────────────────────────────────────────────────

app.post('/api/analyze-tone', async (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  if (!(await getActiveProvider())) {
    return res.status(503).json({ error: 'No AI available. Start Ollama or add ANTHROPIC_API_KEY to .env' })
  }

  try {
    const result = await analyzeToneServer(text)
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Tone analysis failed' })
  }
})

// ─── Check Fulfillment ────────────────────────────────────────────────────────

app.post('/api/check-fulfillment', async (req, res) => {
  const { commitment, evidence, waContext } = req.body ?? {}
  if (!commitment?.trim()) return res.status(400).json({ error: 'commitment text required' })

  if (!(await getActiveProvider())) {
    return res.status(503).json({ error: 'No AI available. Start Ollama or add ANTHROPIC_API_KEY to .env' })
  }

  try {
    const result = await checkFulfillment({ commitment, evidence, waContext })
    res.json(result)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Fulfillment check failed' })
  }
})

// ─── Extract Commitments from any text ───────────────────────────────────────

app.post('/api/extract-commitments', async (req, res) => {
  const { text } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim()) {
    // Fallback to heuristics
    const commitments = heuristicExtractFromText(text)
    return res.json({ commitments, method: 'rules' })
  }

  try {
    const openaiKey = process.env.OPENAI_API_KEY?.trim()
    let commitments
    let method

    if (process.env.ANTHROPIC_API_KEY?.trim()) {
      const raw = await claudeComplete({
        system: `Extract ONLY explicit commitments the user ("You") made to other people from this conversation text.
Include only items where the user said something like "I'll", "I will", "let me", "I promise", "I'll get back", etc.
Skip requests from others, vague agreements, and anything not a clear personal promise.

Return ONLY valid JSON (no markdown):
{"items":[{"action":"concise action ≤150 chars","person":"who this was promised to","due_iso":"ISO8601 or null","critical":true|false}]}
If nothing qualifies: {"items":[]}`,
        messages: [{ role: 'user', content: text.slice(0, 12000) }],
        maxTokens: 1000,
        smart: false,
      })
      const clean = raw.replace(/```json|```/g, '').trim()
      const s = clean.indexOf('{'), e = clean.lastIndexOf('}')
      const parsed = JSON.parse(clean.slice(s, e + 1))
      const { randomUUID } = await import('node:crypto')
      const now = new Date()
      commitments = (parsed.items || [])
        .filter((item) => item.action && String(item.action).length > 5)
        .map((item) => {
          const person = String(item.person || 'Unknown').slice(0, 80)
          const action = String(item.action || 'Untitled').slice(0, 240)
          let dueDate = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10)
          let dueTime = '17:00', status = 'pending'
          if (item.due_iso) {
            const d = new Date(item.due_iso)
            if (!isNaN(d)) {
              dueDate = d.toISOString().slice(0, 10)
              dueTime = d.toISOString().slice(11, 16)
              if (d < now) status = 'overdue'
            }
          }
          return {
            id: randomUUID(), text: action, person, action,
            urgency: item.critical ? 'high' : 'medium', status, dueDate, dueTime,
            source: person !== 'Unknown' ? `Claude – ${person}` : 'Claude extraction',
            createdAt: now.toISOString(), notifyBefore: item.critical ? 30 : 60,
            notified: false, tags: ['claude', person.toLowerCase()],
          }
        })
      method = 'claude'
    } else {
      commitments = await extractCommitmentsWithOpenAI(openaiKey, text)
      method = 'openai'
    }

    res.json({ commitments, method })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e instanceof Error ? e.message : 'Extraction failed' })
  }
})

// ─── WhatsApp Live Bridge ─────────────────────────────────────────────────────

/** GET /api/whatsapp/status — bridge + config state */
app.get('/api/whatsapp/status', (_req, res) => {
  const bridge = getController().bridge
  const cfg = loadConfig()
  res.json({ ...bridge.getStatus(), config: cfg })
})

/** POST /api/whatsapp/start — initialize the bridge (or reconnect if stuck) */
app.post('/api/whatsapp/start', async (_req, res) => {
  try {
    const controller = getController()
    const bridgeStatus = controller.bridge.status

    // If already ready, nothing to do
    if (bridgeStatus === 'ready') {
      return res.json({ ok: true, message: 'Already connected', status: 'ready' })
    }

    // If stuck in an error/disconnected/failed state, do a full reconnect
    const needsRestart = bridgeStatus === 'auth_failure' ||
                         bridgeStatus === 'reconnect_failed' ||
                         (controller._started && bridgeStatus === 'disconnected')

    if (needsRestart) {
      // Async — don't await (takes 10-15s); respond immediately so UI can show progress
      controller.stop().then(() => controller.start()).catch((err) => {
        logger.error('API', '/api/whatsapp/start restart error', { error: err.message })
      })
      vacEvents.emit('bridge_status', { status: 'connecting' })
      return res.json({ ok: true, message: 'Bridge restarting…', status: 'connecting' })
    }

    // First time start
    controller.start()
    vacEvents.emit('bridge_status', { status: 'connecting' })
    res.json({ ok: true, message: 'Controller starting…', status: 'connecting' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** POST /api/whatsapp/reconnect — hard restart the bridge */
app.post('/api/whatsapp/reconnect', async (_req, res) => {
  try {
    const controller = getController()
    // Respond immediately — restart is async and takes 10-15s
    res.json({ ok: true, message: 'Bridge reconnecting…', status: 'connecting' })
    vacEvents.emit('bridge_status', { status: 'connecting' })
    await controller.stop()
    controller.start()
  } catch (e) {
    // Already responded, just log
    logger.error('API', '/api/whatsapp/reconnect error', { error: e.message })
  }
})

/** POST /api/whatsapp/stop — fully stop bridge and reset state for clean restart */
app.post('/api/whatsapp/stop', async (_req, res) => {
  try {
    await getController().stop()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** GET /api/whatsapp/events — SSE stream for real-time events */
app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Replay last 30 log entries
  const log = getConversationLog(30)
  send('log_replay', { events: log })

  // Send current bridge status immediately
  send('bridge_status', getController().bridge.getStatus())

  const handlers = {
    bridge_status:          (d) => send('bridge_status', d),
    qr:                     (d) => send('qr', d),
    ready:                  (d) => send('ready', d),
    chats_loading:          (d) => send('chats_loading', d),
    chats_loaded:           (d) => send('chats_loaded', d),
    message:                (d) => send('message', d),
    analysis:               (d) => send('analysis', d),
    suggestion:             (d) => send('suggestion', d),
    reply_sent:             (d) => send('reply_sent', d),
    reply_queued:           (d) => send('reply_queued', d),
    typing_start:           (d) => send('typing_start', d),
    log:                    (d) => send('log', d),
    // ── Test Run events ──────────────────────────────────────────────────────
    testrun_started:        (d) => send('testrun_started', d),
    testrun_stopped:        (d) => send('testrun_stopped', d),
    testrun_scan_start:     (d) => send('testrun_scan_start', d),
    testrun_scan_complete:  (d) => send('testrun_scan_complete', d),
    testrun_processing:     (d) => send('testrun_processing', d),
    testrun_sent:           (d) => send('testrun_sent', d),
    testrun_skipped:        (d) => send('testrun_skipped', d),
    testrun_error:          (d) => send('testrun_error', d),
    testrun_log:            (d) => send('testrun_log', d),
  }

  for (const [evt, fn] of Object.entries(handlers)) vacEvents.on(evt, fn)

  req.on('close', () => {
    for (const [evt, fn] of Object.entries(handlers)) vacEvents.off(evt, fn)
  })
})

/** POST /api/whatsapp/send — manually send a message */
app.post('/api/whatsapp/send', async (req, res) => {
  const { chatId, text } = req.body ?? {}
  if (!chatId || !text) return res.status(400).json({ error: 'chatId and text required' })
  try {
    await getController().sendManual(chatId, text)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** GET /api/whatsapp/config */
app.get('/api/whatsapp/config', (_req, res) => {
  res.json(loadConfig())
})

/** PATCH /api/whatsapp/config */
app.patch('/api/whatsapp/config', (req, res) => {
  try {
    const cfg = patchConfig(req.body ?? {})
    res.json(cfg)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** GET /api/whatsapp/chats — list all chats from memory */
app.get('/api/whatsapp/chats', (_req, res) => {
  res.json(listChats())
})

/** GET /api/whatsapp/chats/lookup?q=name — find chatId by contact name (used by browser extension) */
app.get('/api/whatsapp/chats/lookup', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase()
  if (!q) return res.status(400).json({ error: 'q required' })
  const all = listChats()
  const match = all.find((c) =>
    (c.senderName || '').toLowerCase().includes(q) ||
    (c.chatId || '').toLowerCase().includes(q)
  )
  if (!match) return res.status(404).json({ error: 'Chat not found', q })
  res.json({ chatId: match.chatId, senderName: match.senderName })
})

/** GET /api/whatsapp/chats/all — full chat history for all chats (for ChatContext import) */
app.get('/api/whatsapp/chats/all', async (_req, res) => {
  const ctrl = getController()
  // Return cached chats if available (populated at startup)
  if (ctrl._cachedChats) {
    return res.json({ chats: ctrl._cachedChats })
  }
  if (ctrl.bridge.status !== 'ready') {
    return res.status(503).json({ error: 'Bridge not ready', status: ctrl.bridge.status })
  }
  // Fallback: fetch live (slow — only if startup load hasn't run yet)
  try {
    const chats = await ctrl.bridge.fetchAllChats()
    ctrl._cachedChats = chats
    res.json({ chats })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** GET /api/whatsapp/commitments/all — scan all WhatsApp chats and extract every commitment */
app.get('/api/whatsapp/commitments/all', async (_req, res) => {
  const ctrl = getController()
  const chats = ctrl._cachedChats ?? []
  if (chats.length === 0 && ctrl.bridge.status !== 'ready') {
    return res.status(503).json({ error: 'Bridge not ready — no chats loaded yet', status: ctrl.bridge.status })
  }

  // If no cached chats, try fetching live
  let chatList = chats
  if (chatList.length === 0) {
    try {
      chatList = await ctrl.bridge.fetchAllChats()
      ctrl._cachedChats = chatList
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  const allCommitments = []
  for (const chat of chatList) {
    if (!chat.plainText) continue
    // Only scan last 200 lines to keep it fast
    const text = chat.plainText.split('\n').slice(-200).join('\n')
    const rawItems = heuristicExtractFromText(text)
    if (rawItems.length === 0) continue
    for (const item of rawItems) {
      allCommitments.push({
        ...item,
        chatId:   chat.chatId,
        chatName: chat.chatName,
        isGroup:  chat.isGroup ?? false,
      })
    }
  }

  // Deduplicate by text similarity (exact duplicate check)
  const seen = new Set()
  const deduped = allCommitments.filter((c) => {
    const key = (c.text ?? c.commitment ?? '').toLowerCase().trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  res.json({ commitments: deduped, totalChatsScanned: chatList.length })
})

/** GET /api/whatsapp/chats/:chatId/memory */
app.get('/api/whatsapp/chats/:chatId/memory', (req, res) => {
  try {
    const mem = loadMemory(decodeURIComponent(req.params.chatId))
    res.json(mem)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/** POST /api/whatsapp/keyboard-assist — keyboard-first intelligence layer */
app.post('/api/whatsapp/keyboard-assist', async (req, res) => {
  const { chatId, draft = '', platform = 'whatsapp' } = req.body ?? {}
  if (!chatId) return res.status(400).json({ error: 'chatId required' })
  try {
    const payload = await generateKeyboardAssist({
      chatId: String(chatId),
      draft: typeof draft === 'string' ? draft : '',
      platform: typeof platform === 'string' ? platform : 'whatsapp',
    })
    res.json(payload)
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Keyboard assist failed' })
  }
})

/** GET /api/whatsapp/log — last 100 controller events */
app.get('/api/whatsapp/log', (_req, res) => {
  res.json(getConversationLog(100))
})

// ─── Per-chat config ──────────────────────────────────────────────────────────

/** GET /api/whatsapp/chats/:chatId/config — get per-chat auto-reply mode */
app.get('/api/whatsapp/chats/:chatId/config', (req, res) => {
  const cfg = loadConfig()
  const perChat = cfg.perChatConfig?.[req.params.chatId] || {}
  res.json({
    chatId: req.params.chatId,
    mode:   perChat.mode || (cfg.autoReply ? 'auto' : 'suggest'),
    global: cfg.autoReply,
    ...perChat,
  })
})

/** PATCH /api/whatsapp/chats/:chatId/config — set per-chat mode */
app.patch('/api/whatsapp/chats/:chatId/config', (req, res) => {
  const { mode } = req.body ?? {}
  const valid = ['off', 'suggest', 'auto']
  if (!valid.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${valid.join(', ')}` })
  const updated = setChatConfig(req.params.chatId, { mode })
  res.json({ chatId: req.params.chatId, ...updated })
})

// ─── Reply records ────────────────────────────────────────────────────────────

/** GET /api/whatsapp/replies/:chatId — reply history with explanations */
app.get('/api/whatsapp/replies/:chatId', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  res.json(getReplyHistory(req.params.chatId, limit))
})

/** GET /api/whatsapp/replies/:chatId/:replyId — single reply record */
app.get('/api/whatsapp/replies/:chatId/:replyId', (req, res) => {
  const record = getReplyRecord(req.params.chatId, req.params.replyId)
  if (!record) return res.status(404).json({ error: 'Reply not found' })
  res.json(record)
})

// ─── Feedback ─────────────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp/feedback
 * Body: { replyId, chatId, rating: 'good'|'neutral'|'bad', editedReply? }
 */
app.post('/api/whatsapp/feedback', async (req, res) => {
  const { replyId, chatId, rating, editedReply } = req.body ?? {}
  if (!replyId || !chatId) return res.status(400).json({ error: 'replyId and chatId required' })
  if (!['good', 'neutral', 'bad'].includes(rating)) {
    return res.status(400).json({ error: 'rating must be good, neutral, or bad' })
  }

  // Update the reply record with feedback
  const record = setReplyFeedback(chatId, replyId, { rating, editedReply })
  if (!record) return res.status(404).json({ error: 'Reply record not found' })

  // Feed into learning store
  recordFeedback({
    replyId,
    chatId,
    incomingMsg:    record.incomingMsg,
    generatedReply: record.generatedReply,
    rating,
    editedReply:    editedReply || null,
    explanation:    record.explanation || {},
    senderName:     record.senderName || '',
  })

  res.json({ ok: true, replyId, rating })
})

/** GET /api/whatsapp/feedback/stats — learning stats */
app.get('/api/whatsapp/feedback/stats', (_req, res) => {
  res.json(getFeedbackStats())
})

/** POST /api/whatsapp/feedback/suggestion-used — track which suggestion was selected */
app.post('/api/whatsapp/feedback/suggestion-used', (req, res) => {
  const { chatId, tone, text, wasEdited = false } = req.body ?? {}
  if (!chatId || !tone) return res.status(400).json({ error: 'chatId and tone required' })
  try {
    recordSuggestionUsed(String(chatId), {
      tone: String(tone),
      text: typeof text === 'string' ? text : '',
      wasEdited: Boolean(wasEdited),
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Test Run Mode ────────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp/test-run/start
 * Body (all optional): { minPendingAgeMs, perChatCooldownMs, scanIntervalMs, maxRepliesPerScan }
 */
app.post('/api/whatsapp/test-run/start', (req, res) => {
  const result = startTestRun(req.body ?? {})
  res.status(result.ok ? 200 : 409).json(result)
})

/** POST /api/whatsapp/test-run/stop */
app.post('/api/whatsapp/test-run/stop', (_req, res) => {
  const result = stopTestRun()
  res.status(result.ok ? 200 : 409).json(result)
})

/** GET /api/whatsapp/test-run/status */
app.get('/api/whatsapp/test-run/status', (_req, res) => {
  res.json(getTestRunStatus())
})

/** GET /api/whatsapp/test-run/logs?limit=200 */
app.get('/api/whatsapp/test-run/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500)
  res.json(getTestRunLogs(limit))
})

/** GET /api/whatsapp/test-run/replies?limit=100 */
app.get('/api/whatsapp/test-run/replies', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  res.json(getTestRunReplies(limit))
})

// ─── VAC Keyboard API ─────────────────────────────────────────────────────────

/**
 * POST /api/whatsapp/suggestions
 * Body: { chatId, message, sender }
 * Returns 4 tone-varied contextual reply suggestions.
 */
app.post('/api/whatsapp/suggestions', async (req, res) => {
  const { chatId, message, sender } = req.body ?? {}
  if (!chatId || !message) return res.status(400).json({ error: 'chatId and message required' })
  try {
    const result = await generateSuggestions({ chatId, message, sender: sender || 'Contact' })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/whatsapp/improve
 * Body: { chatId, draft }
 * Returns an improved version of the user's typed draft.
 */
app.post('/api/whatsapp/improve', async (req, res) => {
  const { chatId, draft } = req.body ?? {}
  if (!chatId || !draft) return res.status(400).json({ error: 'chatId and draft required' })
  try {
    const result = await improveDraft({ chatId, draft })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Keyboard API (iOS / Android / Universal Extension) ──────────────────────

/**
 * POST /api/keyboard/suggest
 * Generic suggestion endpoint — works for any app or website.
 * Called by: iOS keyboard extension, Android IME, universal Chrome extension.
 *
 * Body: { draft, contextBefore, contextAfter, appContext, recentMessages, profileKey, platform }
 */
app.post('/api/keyboard/suggest', async (req, res) => {
  const {
    draft          = '',
    contextBefore  = '',
    contextAfter   = '',
    appContext      = '',
    recentMessages = [],
    profileKey     = 'global',
    platform       = 'unknown',
    // WhatsApp bridge: pass chatId directly OR a senderName to look up by name
    chatId,
    senderName,
  } = req.body ?? {}

  try {
    let enrichedMessages = Array.isArray(recentMessages) ? recentMessages : []
    let resolvedChatId   = chatId || null

    // If no chatId but senderName given, try to resolve via WhatsApp chat list
    if (!resolvedChatId && senderName) {
      try {
        const chats = listChats()
        const match = chats.find((c) => {
          const name = (c.senderName || c.chatId || '').toLowerCase()
          return name.includes(senderName.toLowerCase()) ||
                 senderName.toLowerCase().includes(name)
        })
        if (match) resolvedChatId = match.chatId
      } catch { /* bridge not ready */ }
    }

    // If we have a chatId (direct or resolved), enrich with real WA history
    if (resolvedChatId) {
      try {
        const mem = loadMemory(String(resolvedChatId))
        if (mem?.messages?.length) {
          const bridgeMessages = mem.messages.slice(-20).map((m) => ({
            sender: m.sender === 'You' ? 'You' : (mem.senderName || senderName || 'Them'),
            text:   m.body || '',
          }))
          enrichedMessages = [...bridgeMessages, ...enrichedMessages].slice(-20)
        }
      } catch { /* bridge not ready — use what was passed */ }
    }

    const result = await keyboardSuggest({
      draft,
      contextBefore,
      contextAfter,
      appContext,
      recentMessages: enrichedMessages,
      profileKey:     resolvedChatId ? String(resolvedChatId) : String(profileKey),
      platform:       String(platform),
      goalMode:       String(req.body?.goalMode ?? 'auto'),
    })

    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /api/keyboard/send
 * Send a message via the WhatsApp bridge.
 * Called by the iOS/Android keyboard "↑ Send" button.
 *
 * Body: { text, chatId?, senderName? }
 * - If chatId provided — use it directly.
 * - If only senderName — fuzzy-match against listChats() to resolve chatId.
 */
app.post('/api/keyboard/send', async (req, res) => {
  const { text, chatId: explicitChatId, senderName } = req.body ?? {}
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  try {
    let chatId = explicitChatId || null

    // Resolve by name if no chatId
    if (!chatId && senderName) {
      const chats = listChats()
      const q     = senderName.toLowerCase()
      const match = chats.find((c) => {
        const name = (c.senderName || c.chatId || '').toLowerCase()
        return name.includes(q) || q.includes(name)
      })
      if (match) chatId = match.chatId
    }

    if (!chatId) return res.status(404).json({ error: 'Could not resolve contact — WhatsApp bridge must be connected and have a chat history with this contact.' })

    await getController().sendManual(chatId, text.trim())
    res.json({ ok: true, chatId })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * POST /api/keyboard/learn
 * Record which suggestion the user actually used.
 * Feeds the self-learning profile.
 *
 * Body: { profileKey, tone, text, platform }
 */
app.post('/api/keyboard/learn', (req, res) => {
  const { profileKey = 'global', tone = '', text = '', platform = 'unknown' } = req.body ?? {}
  try {
    recordKeyboardUsage(String(profileKey), {
      tone:     String(tone),
      text:     String(text).slice(0, 200),
      platform: String(platform),
    })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/**
 * GET /api/keyboard/profile?key=...
 * Returns the learned preference profile for a given key.
 */
app.get('/api/keyboard/profile', (req, res) => {
  const key = String(req.query.key || 'global')
  try {
    const preferredTone = getPreferredTone(key)
    res.json({ key, preferredTone })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  console.log(`\nVAC API → http://127.0.0.1:${PORT}  (also on all network interfaces)`)
  console.log(`  AI: ${hasAnthropicKey ? '✓ Claude (Anthropic) ready' : '✗ No API key — open Settings in the app to add it'}`)
  console.log(`  Settings: /api/settings | WhatsApp: /api/whatsapp/start`)

  // Auto-start WhatsApp bridge if a session already exists
  const sessionDir = join(__dir, '../data/.wwebjs_auth/session')
  if (existsSync(sessionDir)) {
    console.log('  WhatsApp: existing session found — auto-starting bridge…')
    try {
      getController().start()
    } catch (e) {
      console.error('  WhatsApp auto-start error:', e.message)
    }
  } else {
    console.log('  WhatsApp: no session — go to Live page and click Start Bridge')
  }
})
