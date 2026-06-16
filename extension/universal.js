/**
 * VAC Universal Content Script v2
 *
 * Injects AI suggestion chips into any messaging platform.
 * Connected to:
 *   - /api/keyboard/suggest  → AI suggestions
 *   - /api/keyboard/learn    → self-learning per contact
 *   - /api/whatsapp/chats/lookup → enrich with WhatsApp history when contact name matches
 *
 * Supports: Gmail, Twitter/X DMs, LinkedIn messages, Telegram Web,
 *           Discord, Slack, Instagram DMs, Messenger, Google Messages
 */

const VAC_API  = 'http://localhost:8787'
const BAR_ID   = 'vac-universal-bar'
const STYLE_ID = 'vac-universal-styles'

// ── Platform detection ─────────────────────────────────────────────────────────

const PLATFORM_MAP = {
  'mail.google.com':      'Gmail',
  'twitter.com':          'Twitter',
  'x.com':                'Twitter',
  'linkedin.com':         'LinkedIn',
  'telegram.org':         'Telegram',
  'discord.com':          'Discord',
  'slack.com':            'Slack',
  'instagram.com':        'Instagram',
  'messenger.com':        'Messenger',
  'messages.google.com':  'GoogleMessages',
}
const PLATFORM = Object.entries(PLATFORM_MAP).find(([d]) => location.hostname.includes(d))?.[1] ?? 'Web'

// ── Messaging-context detection ────────────────────────────────────────────────
// Only show VAC for compose/reply areas — not search boxes, login forms, etc.

const COMPOSE_HINTS = [
  // Gmail compose
  '[role="textbox"][g_editable]',
  '[data-testid="compose-body"]',
  // Twitter DM / reply
  '[data-testid="dmComposerTextInput"]',
  '[data-testid="tweetTextarea_0"]',
  // LinkedIn messaging
  '[contenteditable][aria-label*="message" i]',
  '[contenteditable][aria-label*="reply" i]',
  '[contenteditable][aria-label*="write" i]',
  // Telegram
  '.input-message-input',
  '#editable-message-text',
  // Discord
  '[class*="textArea"][role="textbox"]',
  // Slack
  '[data-qa="message_input"]',
  '[contenteditable][aria-label*="message" i]',
  // Instagram
  'textarea[placeholder*="message" i]',
  // Generic messaging
  'textarea[name*="message" i]',
  'textarea[name*="reply" i]',
  'textarea[placeholder*="reply" i]',
  'textarea[placeholder*="type" i]',
  '[contenteditable][placeholder*="message" i]',
  '[contenteditable][placeholder*="reply" i]',
]

function isMessagingInput(el) {
  if (!el) return false
  // Direct selector match
  if (COMPOSE_HINTS.some(sel => el.matches?.(sel))) return true
  // Aria role/label checks
  const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase()
  if (/message|reply|compose|chat|write|send|respond/i.test(label)) return true
  // Exclude search, login, other inputs
  const type = el.getAttribute('type')?.toLowerCase()
  if (type && !['text', 'search', ''].includes(type)) return false
  const excludeLabel = /search|filter|find|email|password|username|url|subject/i
  if (excludeLabel.test(label)) return false
  // Check parent context for messaging-like containers
  const parent = el.closest('[class*="chat"],[class*="message"],[class*="compose"],[class*="reply"],[class*="inbox"],[role="main"]')
  return Boolean(parent)
}

// ── Contact name extraction per platform ───────────────────────────────────────

function extractContactName() {
  try {
    switch (PLATFORM) {
      case 'Gmail': {
        // "To:" field, or open conversation subject header + sender
        const toEl = document.querySelector('[data-hovercard-id]')
        if (toEl) return toEl.textContent?.trim()
        // Sender in open thread
        const sender = document.querySelector('.gD[email]')
        return sender?.getAttribute('name') || sender?.textContent?.trim() || null
      }
      case 'Twitter': {
        // DM: the conversation header shows the other person's name
        const header = document.querySelector('[data-testid="conversation-info-content"] span')
          || document.querySelector('[data-testid="DM_Conversation_Avatar"] + div span')
        return header?.textContent?.trim() || null
      }
      case 'LinkedIn': {
        const name = document.querySelector('.msg-thread__link-to-profile-name')
          || document.querySelector('[data-control-name="view_conversation_in_tab"] span')
          || document.querySelector('.msg-conversation-card__row--headline')
        return name?.textContent?.trim() || null
      }
      case 'Telegram': {
        const title = document.querySelector('.chat-info .peer-title')
          || document.querySelector('.info .title')
        return title?.textContent?.trim() || null
      }
      case 'Discord': {
        const header = document.querySelector('[class*="channelName"]')
          || document.querySelector('h2[class*="title"]')
        const name = header?.textContent?.trim()
        // Discord DM channels start with "@" — strip it
        return name?.replace(/^@/, '') || null
      }
      case 'Slack': {
        const name = document.querySelector('[data-qa="channel_name"]')
          || document.querySelector('.p-view_header__name')
        return name?.textContent?.trim() || null
      }
      case 'Instagram': {
        const name = document.querySelector('header h1, [class*="thread"] [class*="username"]')
        return name?.textContent?.trim() || null
      }
      case 'Messenger': {
        const name = document.querySelector('[data-testid="thread-title"]')
          || document.querySelector('h1')
        return name?.textContent?.trim() || null
      }
      case 'GoogleMessages': {
        const name = document.querySelector('.conversation-title')
          || document.querySelector('[data-e2e-conversation-name]')
        return name?.textContent?.trim() || null
      }
      default: return null
    }
  } catch { return null }
}

// ── Conversation context extraction per platform ───────────────────────────────

function extractContext() {
  try {
    switch (PLATFORM) {
      case 'Gmail':         return extractGmail()
      case 'Twitter':       return extractTwitter()
      case 'LinkedIn':      return extractLinkedIn()
      case 'Telegram':      return extractTelegram()
      case 'Discord':       return extractDiscord()
      case 'Slack':         return extractSlack()
      case 'Instagram':     return extractInstagram()
      case 'Messenger':     return extractMessenger()
      case 'GoogleMessages':return extractGoogleMessages()
      default:              return []
    }
  } catch { return [] }
}

function extractGmail() {
  const messages = []
  // Read expanded email bodies in thread
  document.querySelectorAll('.a3s.aiL, .ii.gt .a3s').forEach(el => {
    const text = el.innerText?.trim()
    if (text && text.length > 10) messages.push({ sender: 'Email', text: text.slice(0, 500) })
  })
  const subject = document.querySelector('h2.hP')?.textContent?.trim()
  if (subject) messages.unshift({ sender: 'Subject', text: subject })
  return messages.slice(-6)
}

function extractTwitter() {
  const messages = []
  // DM messages
  document.querySelectorAll('[data-testid="messageEntry"]').forEach(el => {
    const text = el.querySelector('[data-testid="tweetText"] span, span[lang]')?.innerText?.trim()
    if (text) messages.push({ sender: 'DM', text: text.slice(0, 300) })
  })
  // Reply thread
  if (!messages.length) {
    document.querySelectorAll('[data-testid="tweet"] [data-testid="tweetText"]').forEach(el => {
      messages.push({ sender: 'Tweet', text: el.innerText?.trim()?.slice(0, 300) })
    })
  }
  return messages.slice(-10)
}

function extractLinkedIn() {
  const messages = []
  document.querySelectorAll('.msg-s-event-listitem__body').forEach(el => {
    const text = el.innerText?.trim()
    if (text) messages.push({ sender: 'Message', text: text.slice(0, 300) })
  })
  return messages.slice(-10)
}

function extractTelegram() {
  const messages = []
  document.querySelectorAll('.message.spoilers-container').forEach(el => {
    const text = el.querySelector('.text-content, .message-text')?.innerText?.trim()
    const sender = el.querySelector('.peer-title')?.textContent?.trim() || 'Them'
    if (text) messages.push({ sender, text: text.slice(0, 300) })
  })
  return messages.slice(-12)
}

function extractDiscord() {
  const messages = []
  document.querySelectorAll('[class*="message_"][class*="cozy"]').forEach(el => {
    const content = el.querySelector('[class*="messageContent"]')?.innerText?.trim()
    const author  = el.querySelector('[class*="username"]')?.textContent?.trim() || 'User'
    if (content) messages.push({ sender: author, text: content.slice(0, 300) })
  })
  return messages.slice(-10)
}

function extractSlack() {
  const messages = []
  document.querySelectorAll('[data-qa="message_content"]').forEach(el => {
    const text    = el.innerText?.trim()
    const author  = el.closest('[data-qa="message_container"]')
      ?.querySelector('[data-qa="message_sender_name"]')?.textContent?.trim() || 'User'
    if (text) messages.push({ sender: author, text: text.slice(0, 300) })
  })
  return messages.slice(-10)
}

function extractInstagram() {
  const messages = []
  // Instagram DMs: each bubble has a specific structure
  document.querySelectorAll('[role="row"] span, [class*="message"] span').forEach(el => {
    const text = el.innerText?.trim()
    if (text && text.length > 2 && text.length < 400 && !el.querySelector('*')) {
      messages.push({ sender: 'DM', text })
    }
  })
  return [...new Map(messages.map(m => [m.text, m])).values()].slice(-8)
}

function extractMessenger() {
  const messages = []
  document.querySelectorAll('[data-scope="messages_table"] [dir="auto"]').forEach(el => {
    const text = el.innerText?.trim()
    if (text && text.length > 2) messages.push({ sender: 'Message', text: text.slice(0, 300) })
  })
  return messages.slice(-10)
}

function extractGoogleMessages() {
  const messages = []
  document.querySelectorAll('mws-message-wrapper').forEach(el => {
    const text = el.querySelector('.text-msg-content')?.innerText?.trim()
    if (text) messages.push({ sender: 'Message', text: text.slice(0, 200) })
  })
  return messages.slice(-10)
}

// ── WhatsApp bridge enrichment ────────────────────────────────────────────────
// If the contact name matches a WhatsApp chat, we enrich with full WA history.

const waLookupCache = new Map()  // name → { chatId, expires }

async function lookupWhatsAppChatId(name) {
  if (!name) return null
  const cached = waLookupCache.get(name)
  if (cached && Date.now() < cached.expires) return cached.chatId

  try {
    const res = await fetch(
      `${VAC_API}/api/whatsapp/chats/lookup?q=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(2000) }
    )
    if (!res.ok) { waLookupCache.set(name, { chatId: null, expires: Date.now() + 60_000 }); return null }
    const { chatId } = await res.json()
    waLookupCache.set(name, { chatId, expires: Date.now() + 300_000 })  // 5-min cache
    return chatId || null
  } catch {
    return null
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

let currentInput   = null
let fetchTimer     = null
let isLoading      = false
let lastDraft      = ''
let lastContextKey = ''

// ── Styles (injected once) ─────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    #${BAR_ID} {
      all: initial;
      position: fixed !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.09);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.07);
      padding: 8px 10px 10px;
      width: 320px;
      max-width: calc(100vw - 24px);
      pointer-events: all;
      transition: opacity 0.15s ease, transform 0.15s ease;
      box-sizing: border-box;
    }
    #${BAR_ID}.vac-u-hidden {
      opacity: 0 !important;
      pointer-events: none !important;
      transform: translateY(6px) !important;
    }
    #${BAR_ID} .vac-u-header {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 7px;
    }
    #${BAR_ID} .vac-u-badge {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #0071e3;
    }
    #${BAR_ID} .vac-u-contact {
      font-size: 11px;
      color: #6e6e73;
      font-weight: 500;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${BAR_ID} .vac-u-wa-badge {
      font-size: 9px;
      color: #25d366;
      font-weight: 600;
      background: #f0fff5;
      border: 1px solid #d0f0da;
      border-radius: 5px;
      padding: 1px 5px;
    }
    #${BAR_ID} .vac-u-close {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 14px;
      color: #c0c0c0;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }
    #${BAR_ID} .vac-u-close:hover { color: #555; }
    #${BAR_ID} .vac-u-chips { display: flex; flex-direction: column; gap: 5px; }
    #${BAR_ID} .vac-u-chip {
      background: #f7f8fc;
      border: 1px solid rgba(0,113,227,0.1);
      border-radius: 10px;
      padding: 7px 11px;
      cursor: pointer;
      transition: all 0.1s ease;
      text-align: left;
      width: 100%;
    }
    #${BAR_ID} .vac-u-chip:hover {
      background: #edf2fd;
      border-color: rgba(0,113,227,0.25);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(0,113,227,0.08);
    }
    #${BAR_ID} .vac-u-chip:active { transform: translateY(0); }
    #${BAR_ID} .vac-u-tone {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0071e3;
      margin-bottom: 2px;
    }
    #${BAR_ID} .vac-u-text {
      font-size: 13px;
      color: #1d1d1f;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #${BAR_ID} .vac-u-skeleton { display: flex; flex-direction: column; gap: 5px; }
    #${BAR_ID} .vac-u-skel {
      height: 42px;
      background: linear-gradient(90deg, #f2f2f2 25%, #e8e8e8 50%, #f2f2f2 75%);
      background-size: 200% 100%;
      animation: vac-shimmer 1.2s infinite;
      border-radius: 10px;
    }
    @keyframes vac-shimmer {
      0%   { background-position: 200% 0 }
      100% { background-position: -200% 0 }
    }
  `
  document.head.appendChild(style)
}

// ── Bar DOM ────────────────────────────────────────────────────────────────────

function getOrCreateBar() {
  let bar = document.getElementById(BAR_ID)
  if (!bar) {
    bar = document.createElement('div')
    bar.id = BAR_ID
    bar.className = 'vac-u-hidden'
    bar.innerHTML = `
      <div class="vac-u-header">
        <span class="vac-u-badge">VAC</span>
        <span class="vac-u-contact" id="vac-u-contact"></span>
        <span class="vac-u-wa-badge" id="vac-u-wa-badge" style="display:none">WA connected</span>
        <button class="vac-u-close" id="vac-u-close">✕</button>
      </div>
      <div id="vac-u-content"></div>
    `
    document.body.appendChild(bar)
    document.getElementById('vac-u-close')?.addEventListener('click', e => {
      e.stopPropagation()
      bar.classList.add('vac-u-hidden')
    })
  }
  return bar
}

function positionBar(inputEl) {
  const bar  = getOrCreateBar()
  const rect = inputEl.getBoundingClientRect()
  const vw   = window.innerWidth
  const vh   = window.innerHeight
  const bw   = 320
  const bh   = 220  // estimated

  // Prefer above input; fall back to below
  let top  = rect.top - bh - 10
  if (top < 8) top = rect.bottom + 8
  top = Math.max(8, Math.min(top, vh - bh - 8))

  let left = rect.left
  left = Math.max(8, Math.min(left, vw - bw - 8))

  bar.style.top  = `${top}px`
  bar.style.left = `${left}px`
  bar.classList.remove('vac-u-hidden')
}

function setContact(name, waConnected) {
  const el = document.getElementById('vac-u-contact')
  const wb = document.getElementById('vac-u-wa-badge')
  if (el)  el.textContent  = name ? `→ ${name}` : PLATFORM
  if (wb)  wb.style.display = waConnected ? 'inline' : 'none'
}

function showSkeleton(inputEl) {
  getOrCreateBar()
  positionBar(inputEl)
  document.getElementById('vac-u-content').innerHTML = `
    <div class="vac-u-skeleton">
      <div class="vac-u-skel"></div>
      <div class="vac-u-skel"></div>
      <div class="vac-u-skel"></div>
      <div class="vac-u-skel"></div>
    </div>`
}

function renderChips(suggestions, inputEl, contactName, profileKey) {
  getOrCreateBar()
  positionBar(inputEl)
  const html = suggestions.map(s => `
    <button class="vac-u-chip" data-text="${esc(s.text)}" data-tone="${esc(s.tone)}">
      <div class="vac-u-tone">${esc(s.tone)}</div>
      <div class="vac-u-text">${esc(s.text)}</div>
    </button>`).join('')
  const content = document.getElementById('vac-u-content')
  content.innerHTML = `<div class="vac-u-chips">${html}</div>`

  content.onclick = e => {
    const chip = e.target.closest('.vac-u-chip')
    if (!chip) return
    const text = chip.dataset.text
    const tone = chip.dataset.tone
    insertText(inputEl, text)
    getOrCreateBar().classList.add('vac-u-hidden')
    // Record learning against the contact's profile
    fetch(`${VAC_API}/api/keyboard/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileKey: profileKey || PLATFORM, tone, text, platform: 'chrome' }),
    }).catch(() => {})
  }
}

// ── Text insertion ─────────────────────────────────────────────────────────────

function insertText(el, text) {
  if (!el) return
  el.focus()
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const s = el.selectionStart ?? 0, e = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, s) + text + el.value.slice(e)
    el.selectionStart = el.selectionEnd = s + text.length
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    // contenteditable — select all and replace
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
    document.execCommand('insertText', false, text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
}

// ── Fetch suggestions ──────────────────────────────────────────────────────────

function scheduleFetch(inputEl) {
  clearTimeout(fetchTimer)
  fetchTimer = setTimeout(() => doFetch(inputEl), 480)
}

async function doFetch(inputEl) {
  if (isLoading || !inputEl) return

  const draft      = getDraft(inputEl)
  const context    = extractContext()
  const ctxKey     = context.slice(-3).map(m => m.text).join('|').slice(0, 150)

  if (draft === lastDraft && ctxKey === lastContextKey) return
  lastDraft      = draft
  lastContextKey = ctxKey

  isLoading = true
  showSkeleton(inputEl)

  // Try to extract contact name and look up WhatsApp chatId
  const contactName = extractContactName()
  const chatId      = await lookupWhatsAppChatId(contactName)
  // Use contact name as profileKey for per-contact learning; fall back to platform
  const profileKey  = contactName || PLATFORM

  setContact(contactName, Boolean(chatId))

  try {
    const res = await fetch(`${VAC_API}/api/keyboard/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft,
        contextBefore:  context.map(m => `${m.sender}: ${m.text}`).join('\n').slice(-1000),
        recentMessages: context,
        appContext:     PLATFORM,
        profileKey,
        platform:       'chrome',
        // If we found a WhatsApp chatId, server enriches with full WA history
        ...(chatId ? { chatId } : {}),
      }),
      signal: AbortSignal.timeout(14000),
    })

    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()
    const suggestions = data.suggestions || []

    if (!suggestions.length) {
      getOrCreateBar().classList.add('vac-u-hidden')
    } else {
      renderChips(suggestions, inputEl, contactName, profileKey)
    }
  } catch {
    getOrCreateBar().classList.add('vac-u-hidden')
  } finally {
    isLoading = false
  }
}

function getDraft(el) {
  if (!el) return ''
  return (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
    ? el.value?.trim() || ''
    : el.innerText?.trim() || ''
}

// ── Input observation ──────────────────────────────────────────────────────────

document.addEventListener('focusin', e => {
  const el = e.target
  if (!isMessagingInput(el)) return
  currentInput = el
  scheduleFetch(el)
}, true)

document.addEventListener('input', e => {
  if (e.target !== currentInput) return
  scheduleFetch(currentInput)
}, true)

document.addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement
    const bar    = document.getElementById(BAR_ID)
    if (!active || active === document.body) { bar?.classList.add('vac-u-hidden'); return }
    if (bar?.contains(active)) return
    if (!isMessagingInput(active)) bar?.classList.add('vac-u-hidden')
  }, 180)
}, true)

// ── Reposition on scroll/resize ────────────────────────────────────────────────

let repositionTimer = null
function onLayoutChange() {
  if (!currentInput || document.getElementById(BAR_ID)?.classList.contains('vac-u-hidden')) return
  clearTimeout(repositionTimer)
  repositionTimer = setTimeout(() => positionBar(currentInput), 80)
}

window.addEventListener('scroll',  onLayoutChange, { passive: true, capture: true })
window.addEventListener('resize',  onLayoutChange, { passive: true })

// ── Helpers ────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Boot ───────────────────────────────────────────────────────────────────────

injectStyles()
getOrCreateBar()
