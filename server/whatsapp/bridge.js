/**
 * WhatsApp Bridge — core client using whatsapp-web.js
 * Handles QR auth, message listening, sending, and auto-reconnect on disconnect.
 */
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode'
import { EventEmitter } from 'node:events'
import { execSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../logger.js'

const __dir = dirname(fileURLToPath(import.meta.url))

// ── Chrome path resolution ────────────────────────────────────────────────────
// Checks common install locations in priority order so the bridge works whether
// Chrome for Testing was downloaded to /tmp, or the user has system Chrome.

function _findChrome() {
  const candidates = [
    // Previously downloaded Chrome for Testing (permanent location)
    join(__dir, '../../data/chrome/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    // System Google Chrome (macOS)
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Chromium (macOS)
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux paths
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Old /tmp location (may exist if not yet rebooted)
    '/tmp/vac-chrome/chrome/mac_arm-147.0.7727.56/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      logger.info('Bridge', `Using Chrome at: ${p}`)
      return p
    }
  }
  throw new Error(
    'No Chrome found. Install Google Chrome or set the CHROME_PATH environment variable.'
  )
}

// Reconnect: start at 5s, double each attempt, cap at 60s
const RECONNECT_BASE_DELAY   = 5_000
const RECONNECT_MAX_DELAY    = 60_000
// If auth is stale, don't loop forever
const MAX_RECONNECT_ATTEMPTS = 10

export class WhatsAppBridge extends EventEmitter {
  constructor() {
    super()
    this.client            = null
    this.status            = 'disconnected'
    this.qrDataUrl         = null
    this.qrRaw             = null
    this.info              = null
    this._initialized      = false
    this._destroying       = false
    this._reconnectTimer   = null
    this._reconnectAttempt = 0
  }

  // ── Chrome cleanup ──────────────────────────────────────────────────────────

  async _cleanupStaleChrome() {
    try { execSync('pkill -f "Chrome for Testing" 2>/dev/null', { stdio: 'ignore' }) } catch (_) {}
    try { execSync('pkill -f "chrome-mac-arm64" 2>/dev/null',   { stdio: 'ignore' }) } catch (_) {}
    await new Promise((r) => setTimeout(r, 1500))

    const sessionDir = join(__dir, '../../data/.wwebjs_auth/session')
    for (const f of ['DevToolsActivePort', 'lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const p = join(sessionDir, f)
      if (existsSync(p)) { try { unlinkSync(p) } catch (_) {} }
    }
    logger.info('Bridge', 'Stale Chrome cleanup done')
  }

  // ── Reconnect scheduler ─────────────────────────────────────────────────────

  _scheduleReconnect(delay = RECONNECT_BASE_DELAY) {
    if (this._destroying || this._reconnectTimer) return
    if (this._reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('Bridge', 'Max reconnect attempts reached — giving up', { attempts: this._reconnectAttempt })
      this.emit('status', { status: 'reconnect_failed' })
      return
    }
    const backoff = Math.min(delay * Math.pow(2, this._reconnectAttempt), RECONNECT_MAX_DELAY)
    logger.warn('Bridge', `Auto-reconnect in ${backoff / 1000}s (attempt ${this._reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})`)
    this.emit('status', { status: 'reconnecting', delay: backoff, attempt: this._reconnectAttempt + 1 })

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer   = null
      this._reconnectAttempt++
      this._initialized      = false
      try {
        await this.init()
      } catch (err) {
        logger.error('Bridge', 'Reconnect attempt failed', { error: err.message, attempt: this._reconnectAttempt })
        this._scheduleReconnect(backoff)
      }
    }, backoff)
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async init() {
    if (this._initialized) return
    this._initialized = true

    await this._cleanupStaleChrome()
    logger.info('Bridge', 'Initializing WhatsApp client…')

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: join(__dir, '../../data/.wwebjs_auth'),
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: 300000,  // 5 min CDP protocol timeout (prevents "callFunctionOn timed out")
        timeout: 90000,  // 90s launch timeout (Chrome on Mac can be slow first run)
        executablePath: process.env.CHROME_PATH || _findChrome(),
        defaultViewport: { width: 1366, height: 768 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--safebrowsing-disable-auto-update',
          '--window-size=1366,768',
          '--remote-debugging-port=0',
        ],
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1017054695-alpha.html',
      },
    })

    // ── QR code ────────────────────────────────────────────────────────────
    this.client.on('qr', async (qr) => {
      this.status    = 'qr_pending'
      this.qrRaw     = qr
      try {
        this.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 })
      } catch {
        this.qrDataUrl = null
      }
      logger.info('Bridge', 'QR ready — scan in VAC dashboard')
      this.emit('qr',     { qrDataUrl: this.qrDataUrl, raw: qr })
      this.emit('status', { status: 'qr_pending' })
    })

    // ── Ready ──────────────────────────────────────────────────────────────
    this.client.on('ready', () => {
      this.status            = 'ready'
      this.qrDataUrl         = null
      this.qrRaw             = null
      this.info              = this.client.info
      this._reconnectAttempt = 0     // reset backoff counter on successful connect
      try { this.client.pupPage.setDefaultTimeout(180_000) } catch (_) {}
      logger.info('Bridge', 'WhatsApp ready', {
        name: this.info?.pushname,
        phone: this.info?.wid?.user,
      })
      this.emit('ready',  { info: this.info })
      this.emit('status', { status: 'ready', info: this.info })
    })

    // ── Auth failure ───────────────────────────────────────────────────────
    this.client.on('auth_failure', (msg) => {
      this.status = 'auth_failure'
      logger.error('Bridge', 'Auth failure', { reason: msg })
      this.emit('status', { status: 'auth_failure', error: msg })
      // Don't auto-reconnect on auth failure (session needs to be re-scanned)
    })

    // ── Disconnected ───────────────────────────────────────────────────────
    this.client.on('disconnected', (reason) => {
      this.status = 'disconnected'
      logger.warn('Bridge', 'Disconnected', { reason })
      this.emit('status', { status: 'disconnected', reason })

      // Auto-reconnect unless the user deliberately logged out or we're shutting down
      if (!this._destroying && reason !== 'LOGOUT' && reason !== 'NAVIGATED') {
        this._scheduleReconnect()
      }
    })

    // ── Loading screen ─────────────────────────────────────────────────────
    this.client.on('loading_screen', (percent) => {
      this.status = 'connecting'
      this.emit('status', { status: 'connecting', percent })
    })

    // ── Incoming / outgoing messages ───────────────────────────────────────
    this.client.on('message_create', async (msg) => {
      // Capture outgoing for memory (skip VCARDs)
      if (msg.fromMe && msg.body?.trim()) {
        if (!msg.body.trimStart().startsWith('BEGIN:VCARD')) {
          try {
            const chat = await msg.getChat()
            this.emit('message_out', {
              chat_id:   msg.to,
              chat_name: chat.name || msg.to,
              message:   msg.body,
              timestamp: msg.timestamp * 1000,
            })
          } catch {}
        }
        return
      }
      if (msg.fromMe) return
      if (!msg.body || msg.body.trim() === '') return
      // Skip contact card VCARDs — they are not text messages and must not be analyzed/sent
      if (msg.body.trimStart().startsWith('BEGIN:VCARD')) return

      try {
        const contact = await msg.getContact()
        const chat    = await msg.getChat()

        const parsed = {
          chat_id:    msg.from,
          chat_name:  chat.name || contact.pushname || msg.from,
          sender:     contact.pushname || contact.name || msg.from.split('@')[0],
          message:    msg.body,
          timestamp:  msg.timestamp * 1000,
          message_id: msg.id._serialized,
          is_group:   chat.isGroup,
        }

        logger.info('Bridge', `Message from ${parsed.sender}`, {
          chat: parsed.chat_name,
          preview: parsed.message.slice(0, 80),
        })
        this.emit('message', parsed)
      } catch (err) {
        logger.error('Bridge', 'Error processing message', { error: err.message })
      }
    })

    await this.client.initialize()
    this.status = 'connecting'
  }

  // ── fetchAllChats ───────────────────────────────────────────────────────────

  async fetchAllChats({ msgLimit = 50, maxChats = 40 } = {}) {
    if (this.status !== 'ready') return []
    try {
      const allChats = await this.client.getChats()
      logger.info('Bridge', `Found ${allChats.length} total chats — processing ${maxChats} most recent`)

      const recent = allChats
        .filter((c) => !c.id._serialized.startsWith('status@') && !c.id._serialized.startsWith('broadcast'))
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, maxChats)

      const myName = this.info?.pushname || 'You'
      const page   = this.client.pupPage
      try { page.setDefaultTimeout(180_000) } catch (_) {}
      try { page.setDefaultNavigationTimeout(180_000) } catch (_) {}

      const results = []

      for (let i = 0; i < recent.length; i++) {
        const chat     = recent[i]
        const chatId   = chat.id._serialized
        const chatName = chat.name || chatId.split('@')[0]

        try {
          const safeName = chatName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          const sel      = `[title="${safeName}"]`

          let clicked = false
          for (let attempt = 0; attempt <= 10 && !clicked; attempt++) {
            if (attempt > 0) {
              await page.evaluate((scrollY) => {
                const pane = document.querySelector('#pane-side')
                if (!pane) return
                const inner = pane.querySelector('[role="grid"], [role="listbox"]') ||
                  Array.from(pane.querySelectorAll('div')).find((el) => {
                    const s = window.getComputedStyle(el)
                    return s.overflowY === 'auto' || s.overflowY === 'scroll'
                  }) || pane
                inner.scrollTop = scrollY
                pane.scrollTop  = scrollY
              }, i * 76)
              await new Promise((r) => setTimeout(r, 300))
            }
            try { await page.click(sel, { timeout: 700 }); clicked = true } catch (_) {}
          }

          if (!clicked) logger.debug('Bridge', `"${chatName}" not found in DOM, skipping click`)

          await new Promise((r) => setTimeout(r, clicked ? 2000 : 0))

          // Retry up to 3 times — "Promise was collected" is a Puppeteer GC
          // race that resolves itself on retry
          let msgs = []
          for (let evalAttempt = 0; evalAttempt < 3; evalAttempt++) {
            try {
              msgs = await page.evaluate(({ chatId, msgLimit, myName }) => {
                const S       = window.Store
                const models  = S?.Msg?.byChat?.(chatId)?.getModelsArray?.() ?? []
                const filtered = models
                  .filter((m) => !m.isNotification && m.body && m.body.trim() && !m.body.trimStart().startsWith('BEGIN:VCARD'))
                  .slice(-msgLimit)
                return filtered.map((m) => ({
                  id:        m.id?._serialized ?? String(m.t),
                  fromMe:    m.id?.fromMe ?? false,
                  author:    m.id?.fromMe
                    ? myName
                    : (m.notifyName || m.sender?.displayName || m.sender?.pushname || chatId.split('@')[0]),
                  text:      m.body,
                  timestamp: (m.t ?? 0) * 1000,
                }))
              }, { chatId, msgLimit, myName })
              break  // success
            } catch (evalErr) {
              if (evalAttempt < 2) {
                await new Promise((r) => setTimeout(r, 800))
              } else {
                throw evalErr  // bubble up after 3 failures
              }
            }
          }

          if (msgs.length === 0) {
            logger.debug('Bridge', `"${chatName}" — 0 messages`)
            continue
          }

          logger.info('Bridge', `Loaded "${chatName}"`, { msgCount: msgs.length })

          results.push({
            chatId,
            chatName,
            isGroup:         chat.isGroup,
            messages:        msgs,
            participants:    [...new Set(msgs.map((m) => m.author))],
            lastMessageTime: msgs.at(-1)?.timestamp ?? 0,
            plainText: msgs.map((m) => {
              const d    = new Date(m.timestamp)
              const date = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
              const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
              return `${date}, ${time} - ${m.author}: ${m.text}`
            }).join('\n'),
            messageCount: msgs.length,
          })
        } catch (err) {
          logger.error('Bridge', `Error processing "${chatName}"`, { error: err.message })
        }
      }

      const total = results.reduce((s, c) => s + c.messageCount, 0)
      logger.info('Bridge', 'fetchAllChats complete', { chats: results.length, totalMessages: total })
      return results.sort((a, b) => b.lastMessageTime - a.lastMessageTime)
    } catch (err) {
      logger.error('Bridge', 'fetchAllChats error', { error: err.message })
      return []
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  async send(chatId, text) {
    if (this.status !== 'ready') throw new Error(`Bridge not ready (status: ${this.status})`)
    logger.info('Bridge', 'Sending message', { chatId, preview: text.slice(0, 60) })
    return this.client.sendMessage(chatId, text)
  }

  async getChat(chatId) {
    return this.client.getChatById(chatId)
  }

  // ── Destroy ─────────────────────────────────────────────────────────────────

  async destroy() {
    this._destroying = true
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    if (this.client) {
      try { await this.client.destroy() } catch (_) {}
      this.status       = 'disconnected'
      this._initialized = false
    }
    logger.info('Bridge', 'Bridge destroyed')
  }

  getStatus() {
    return {
      status:    this.status,
      qrDataUrl: this.qrDataUrl,
      info:      this.info
        ? { name: this.info.pushname, phone: this.info.wid?.user }
        : null,
    }
  }
}

// Singleton
let _bridge = null
export function getBridge() {
  if (!_bridge) _bridge = new WhatsAppBridge()
  return _bridge
}

/** Reset the singleton so the next getBridge() call returns a fresh instance */
export function resetBridge() {
  _bridge = null
}
