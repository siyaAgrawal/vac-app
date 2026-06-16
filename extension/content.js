/**
 * VAC Chrome Extension — WhatsApp Web content script
 * Injects AI suggestion chips above the WhatsApp Web compose box.
 *
 * Flow:
 *   1. Watch for active chat changes via MutationObserver
 *   2. Read contact name from the chat header
 *   3. Lookup chatId from the VAC API (localhost:8787)
 *   4. Get 4 AI suggestion variants
 *   5. Inject chip bar above the input box
 *   6. Tap-to-send / tap-to-use-in-input
 */

const VAC_API = 'http://localhost:8787'
const BAR_ID  = 'vac-bar'

let currentChatName  = null
let currentChatId    = null
let fetchTimer       = null
let lastInboundMsg   = ''
let isLoading        = false

// ── Entry ─────────────────────────────────────────────────────────────────────

function init() {
  injectBar()
  observeChatChanges()
  observeMessages()
}

// ── DOM injection ─────────────────────────────────────────────────────────────

function injectBar() {
  if (document.getElementById(BAR_ID)) return

  const bar = document.createElement('div')
  bar.id    = BAR_ID
  bar.classList.add('vac-hidden')
  bar.innerHTML = `
    <div class="vac-header">
      <span class="vac-label">VAC</span>
      <span class="vac-status" id="vac-status">Connecting…</span>
    </div>
    <div id="vac-content"></div>
  `
  // Insert before the footer (compose box area)
  const footer = getFooter()
  if (footer) {
    footer.parentNode.insertBefore(bar, footer)
  } else {
    // retry after layout settles
    setTimeout(injectBar, 1500)
  }
}

function getFooter() {
  // WhatsApp Web compose footer — try stable selectors first
  return (
    document.querySelector('footer[data-testid="conversation-compose-box"]') ||
    document.querySelector('[data-testid="conversation-compose-box"]') ||
    document.querySelector('footer')
  )
}

function getInputEl() {
  return (
    document.querySelector('[data-testid="conversation-compose-box-input"]') ||
    document.querySelector('[contenteditable="true"][data-tab="10"]') ||
    document.querySelector('[contenteditable="true"]')
  )
}

// ── Observers ─────────────────────────────────────────────────────────────────

function observeChatChanges() {
  // Watch the URL / main panel header for active chat changes
  let lastUrl = location.href
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      onChatChange()
    }
    // Also re-inject the bar if it got removed (e.g. by React re-render)
    if (!document.getElementById(BAR_ID)) injectBar()
  })
  obs.observe(document.body, { childList: true, subtree: true })

  // Also poll the header for chat name change
  setInterval(checkChatHeader, 1200)
}

function observeMessages() {
  // Watch message list for new inbound messages
  const obs = new MutationObserver(() => {
    const newLast = getLastInboundMessage()
    if (newLast && newLast !== lastInboundMsg) {
      lastInboundMsg = newLast
      scheduleFetch()
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
}

function checkChatHeader() {
  const name = getChatName()
  if (name && name !== currentChatName) {
    currentChatName = name
    currentChatId   = null  // invalidate cached chatId
    lastInboundMsg  = ''
    onChatChange()
  }
}

function onChatChange() {
  currentChatId   = null
  lastInboundMsg  = getLastInboundMessage() || ''
  setStatus('Loading…')
  scheduleFetch()
}

// ── Chat name extraction ───────────────────────────────────────────────────────

function getChatName() {
  // Try the header span in the conversation panel
  const header = (
    document.querySelector('[data-testid="conversation-header"] span[dir="auto"]') ||
    document.querySelector('._amig span[dir="auto"]') ||
    document.querySelector('header span[dir="auto"]')
  )
  return header?.textContent?.trim() || null
}

// ── Message extraction ────────────────────────────────────────────────────────

function getLastInboundMessage() {
  // Get the last incoming message text from the DOM
  const msgRows = document.querySelectorAll('[data-testid="msg-container"]')
  for (let i = msgRows.length - 1; i >= 0; i--) {
    const row = msgRows[i]
    // Outbound messages have a tail on the right side — skip them
    if (row.querySelector('[data-testid="msg-dblcheck"]') ||
        row.querySelector('[data-testid="msg-check"]') ||
        row.querySelector('[data-testid="msg-time"]')?.closest('[class*="out"]')) {
      // Could be outbound — try to detect via aria or class
    }
    // Try getting text from copyable-text (most reliable)
    const copyable = row.querySelector('[data-testid="copyable-text"]') ||
                     row.querySelector('.copyable-text') ||
                     row.querySelector('span[dir="ltr"]')
    if (copyable) {
      const text = copyable.textContent?.trim()
      if (text && text.length > 0) {
        // Skip if this looks like an outbound context element
        const isIncoming = !row.querySelector('[data-testid="msg-dblcheck"]') &&
                           !row.querySelector('[data-icon="msg-dblcheck"]') &&
                           !row.querySelector('[data-icon="msg-check"]')
        if (isIncoming) return text
      }
    }
  }
  return ''
}

// ── API calls ─────────────────────────────────────────────────────────────────

function scheduleFetch() {
  clearTimeout(fetchTimer)
  fetchTimer = setTimeout(fetchSuggestions, 600)
}

async function fetchSuggestions() {
  if (isLoading) return
  const chatName = currentChatName || getChatName()
  if (!chatName) return

  isLoading = true
  setStatus('Thinking…')
  showSkeleton()

  try {
    // Step 1: resolve chatId if we don't have it
    if (!currentChatId) {
      const lookupRes = await fetch(
        `${VAC_API}/api/whatsapp/chats/lookup?q=${encodeURIComponent(chatName)}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (!lookupRes.ok) {
        setStatus('Chat not in VAC yet')
        showContent('<p class="vac-no-reply">Send or receive a message first to sync this chat.</p>')
        return
      }
      const { chatId } = await lookupRes.json()
      currentChatId = chatId
    }

    // Step 2: get suggestions
    const sugRes = await fetch(`${VAC_API}/api/whatsapp/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: currentChatId, message: lastInboundMsg, sender: chatName }),
      signal: AbortSignal.timeout(15000),
    })

    if (!sugRes.ok) throw new Error(`API error ${sugRes.status}`)
    const data = await sugRes.json()

    if (data.noReplyNeeded) {
      setStatus('No reply needed')
      showContent('<p class="vac-no-reply">Conversation looks complete. No reply needed.</p>')
      return
    }

    const suggestions = data.suggestions || []
    if (suggestions.length === 0) {
      setStatus('Ready')
      showContent('<p class="vac-no-reply">No suggestions generated.</p>')
      return
    }

    setStatus(data.conflict ? '⚠️ De-escalate' : 'Ready')
    renderChips(suggestions, data.conflict)

  } catch (err) {
    if (err.name === 'TimeoutError') {
      setStatus('Timeout — VAC running?')
    } else {
      setStatus('VAC offline')
    }
    showContent('<p class="vac-no-reply">Make sure the VAC app is running on your Mac.</p>')
  } finally {
    isLoading = false
  }
}

async function sendMessage(text) {
  // Use WhatsApp's compose input to type and send the message
  const input = getInputEl()
  if (!input) return

  // Focus the input
  input.focus()

  // Insert text via execCommand (works in WhatsApp Web's contenteditable)
  document.execCommand('selectAll', false, null)
  document.execCommand('insertText', false, text)

  // Give WhatsApp time to register the input, then hit Enter
  await new Promise((r) => setTimeout(r, 120))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
}

function useInInput(text) {
  const input = getInputEl()
  if (!input) return
  input.focus()
  document.execCommand('selectAll', false, null)
  document.execCommand('insertText', false, text)
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderChips(suggestions, conflict) {
  const bar = document.getElementById(BAR_ID)
  if (bar) bar.classList.remove('vac-hidden')

  let html = `<div class="vac-chips">`
  for (const s of suggestions) {
    const safeText = escHtml(s.text)
    const safeTone = escHtml(s.label || s.tone)
    html += `
      <div class="vac-chip" data-text="${safeText}" data-tone="${safeTone}">
        <span class="vac-chip-tone">${safeTone}</span>
        <span class="vac-chip-text" title="${safeText}">${safeText}</span>
        <div class="vac-chip-actions">
          <button class="vac-btn vac-btn-send" data-action="send" data-text="${safeText}">Send</button>
          <button class="vac-btn vac-btn-use"  data-action="use"  data-text="${safeText}">Use</button>
        </div>
      </div>`
  }
  html += `</div>`
  if (conflict) {
    html = `<div style="margin-bottom:6px"><span class="vac-conflict-badge">⚠️ Tension detected — replies are de-escalating</span></div>` + html
  }
  showContent(html)

  // Attach click handlers
  document.getElementById('vac-content')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    const text   = btn.dataset.text
    const action = btn.dataset.action
    if (action === 'send') {
      sendMessage(text)
      const tone = btn.closest('.vac-chip').dataset.tone
      // WhatsApp-specific feedback
      fetch(`${VAC_API}/api/whatsapp/feedback/suggestion-used`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: currentChatId, tone, text }),
      }).catch(() => {})
      // Keyboard learning — uses contact name as profileKey so iOS/Android/Chrome share the same profile
      fetch(`${VAC_API}/api/keyboard/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileKey: currentChatName || currentChatId, tone, text, platform: 'whatsapp-web' }),
      }).catch(() => {})
    } else if (action === 'use') useInInput(text)
  })
}

function showSkeleton() {
  const bar = document.getElementById(BAR_ID)
  if (bar) bar.classList.remove('vac-hidden')
  showContent(`
    <div class="vac-skeleton">
      <div class="vac-skeleton-chip"></div>
      <div class="vac-skeleton-chip"></div>
      <div class="vac-skeleton-chip"></div>
      <div class="vac-skeleton-chip"></div>
    </div>`)
}

function showContent(html) {
  const el = document.getElementById('vac-content')
  if (el) el.innerHTML = html
}

function setStatus(msg) {
  const el = document.getElementById('vac-status')
  if (el) el.textContent = msg
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Boot ──────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000))
} else {
  setTimeout(init, 2000)
}
