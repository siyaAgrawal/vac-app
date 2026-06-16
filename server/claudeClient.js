/**
 * AI client — Anthropic Claude (preferred) or Ollama local LLM (fallback).
 * Uses ANTHROPIC_API_KEY from .env for Claude.
 * Falls back to Ollama at localhost:11434 if no key is configured.
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'
const OLLAMA_BASE = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001'
const SMART_MODEL = process.env.ANTHROPIC_SMART_MODEL || 'claude-sonnet-4-6'

// ── Provider detection ─────────────────────────────────────────────────────

// Always read from process.env at call time — key can be injected at runtime
// (e.g. via the Settings page) without a server restart.
function hasAnthropicKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

// Reset Ollama cache when the key changes so provider detection re-runs
export function resetProviderCache() {
  _ollamaAvailable = null
}

let _ollamaAvailable = null
let _ollamaCheckedAt = 0
const OLLAMA_TRUE_TTL  = 30_000   // cache "available" for 30s — Ollama doesn't go down often
const OLLAMA_FALSE_TTL =  3_000   // retry "unavailable" after just 3s — catches startup timing

export async function isOllamaAvailable() {
  const now = Date.now()
  const ttl = _ollamaAvailable ? OLLAMA_TRUE_TTL : OLLAMA_FALSE_TTL
  if (_ollamaAvailable !== null && now - _ollamaCheckedAt < ttl) return _ollamaAvailable
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    _ollamaAvailable = Array.isArray(data.models) && data.models.length > 0
  } catch {
    _ollamaAvailable = false
  }
  _ollamaCheckedAt = now
  return _ollamaAvailable
}

export async function getActiveProvider() {
  if (hasAnthropicKey()) return 'anthropic'
  if (await isOllamaAvailable()) return 'ollama'
  return null
}

// ── Anthropic helpers ──────────────────────────────────────────────────────

function anthropicHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
    'anthropic-version': '2023-06-01',
  }
}

// ── Ollama OpenAI-compatible helpers ───────────────────────────────────────

function ollamaMessages(system, messages) {
  const result = []
  if (system) result.push({ role: 'system', content: system })
  result.push(...messages)
  return result
}

// ── Retry with exponential backoff ─────────────────────────────────────────
// Retries on rate limits (429) and transient server errors (5xx).
// Respects Retry-After header from Anthropic when present.

const RETRYABLE = /4(29)|5(00|02|03|29)/  // 429, 500, 502, 503, 529

// Network/timeout errors should NOT be retried — they indicate the provider is down
function isNetworkOrTimeoutError(err) {
  if (!err) return false
  const msg = err.message ?? ''
  const causeCode = err.cause?.code ?? err.cause?.name ?? ''
  return (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    causeCode.includes('TIMEOUT') ||
    causeCode === 'UND_ERR_HEADERS_TIMEOUT' ||
    causeCode === 'TimeoutError' ||
    err.name === 'TimeoutError' ||
    err.name === 'AbortError'
  )
}

async function withRetry(fn, maxRetries = 3, label = 'request') {
  let lastErr
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Never retry network/timeout errors — provider is unreachable
      if (isNetworkOrTimeoutError(err)) throw err
      const isRetryable = RETRYABLE.test(err.message)
      if (!isRetryable || i === maxRetries) throw err

      // Parse Retry-After if Anthropic included it in the error message
      const retryAfterMatch = err.message.match(/"retry_after":\s*(\d+)/)
      const retryAfterMs    = retryAfterMatch ? parseInt(retryAfterMatch[1]) * 1000 : 0
      const backoffMs       = retryAfterMs || Math.min(1000 * Math.pow(2, i) + Math.random() * 500, 20_000)

      console.warn(`[ClaudeClient] ${label} retry ${i + 1}/${maxRetries} in ${Math.round(backoffMs / 100) / 10}s — ${err.message.slice(0, 100)}`)
      await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  throw lastErr
}

// ── Non-streaming completion ───────────────────────────────────────────────

export async function claudeComplete({ system, messages, maxTokens = 2048, smart = false, timeoutMs }) {
  const provider = await getActiveProvider()

  if (provider === 'anthropic') {
    const model = smart ? SMART_MODEL : DEFAULT_MODEL
    const body  = { model, max_tokens: maxTokens, messages }
    if (system) body.system = system

    return withRetry(async () => {
      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: anthropicHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Anthropic ${res.status}: ${err.slice(0, 300)}`)
      }
      const data = await res.json()
      return data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? ''
    }, 3, `claudeComplete(${model})`)
  }

  if (provider === 'ollama') {
    return withRetry(async () => {
      const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: ollamaMessages(system, messages),
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs ?? 30_000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Ollama ${res.status}: ${err.slice(0, 300)}`)
      }
      const data = await res.json()
      return data.choices?.[0]?.message?.content ?? ''
    }, 1, 'claudeComplete(ollama)')
  }

  // No provider available — return empty string so callers can handle gracefully
  console.warn('[VAC] No AI provider available. Start Ollama (ollama serve) to enable AI features.')
  return ''
}

// ── Streaming completion ───────────────────────────────────────────────────
// Streaming responses retry the full stream from the start on 429/5xx.
// The onChunk callback is only called with real content — no partial chunks on retry.

export async function claudeStream({ system, messages, maxTokens = 2048, smart = false, onChunk }) {
  const provider = await getActiveProvider()

  if (provider === 'anthropic') {
    const model = smart ? SMART_MODEL : DEFAULT_MODEL
    const body  = { model, max_tokens: maxTokens, stream: true, messages }
    if (system) body.system = system

    return withRetry(async () => {
      const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
        method: 'POST',
        headers: anthropicHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Anthropic ${res.status}: ${err.slice(0, 300)}`)
      }
      return consumeAnthropicSSE(res, onChunk)
    }, 3, `claudeStream(${model})`)
  }

  if (provider === 'ollama') {
    return withRetry(async () => {
      const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: ollamaMessages(system, messages),
          max_tokens: maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Ollama ${res.status}: ${err.slice(0, 300)}`)
      }
      return consumeOpenAISSE(res, onChunk)
    }, 2, 'claudeStream(ollama)')
  }

  // No provider — stream nothing, caller gets empty completion
  console.warn('[VAC] No AI provider available. Start Ollama (ollama serve) to enable AI features.')
  if (onChunk) onChunk('')
  return ''
}

// ── SSE consumers ──────────────────────────────────────────────────────────

async function consumeAnthropicSSE(res, onChunk) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = '', buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue
      try {
        const evt = JSON.parse(raw)
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          full += evt.delta.text
          if (onChunk) onChunk(evt.delta.text)
        }
      } catch { /* ignore */ }
    }
  }
  return full
}

async function consumeOpenAISSE(res, onChunk) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = '', buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue
      try {
        const evt = JSON.parse(raw)
        const text = evt.choices?.[0]?.delta?.content
        if (text) {
          full += text
          if (onChunk) onChunk(text)
        }
      } catch { /* ignore */ }
    }
  }
  return full
}

export { DEFAULT_MODEL, SMART_MODEL }
