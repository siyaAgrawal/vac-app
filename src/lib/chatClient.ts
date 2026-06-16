/**
 * Client-side Claude streaming chat.
 * Tries server /api/chat first (if ANTHROPIC_API_KEY is in .env).
 * Falls back to direct browser → Anthropic API (needs VITE_ANTHROPIC_API_KEY).
 *
 * Both paths stream text chunks via onChunk().
 */

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  messages: ChatMsg[]
  waContext?: string
  activeChatLabel?: string
  onChunk: (text: string) => void
  signal?: AbortSignal
}

// ── Server-side streaming (SSE) ───────────────────────────────────────────────

async function streamViaServer(opts: StreamOptions): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: opts.messages,
      waContext: opts.waContext,
      activeChatLabel: opts.activeChatLabel,
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Server error ${res.status}`)
  }

  return consumeSSE(res, opts.onChunk)
}

// ── Browser-side streaming (direct Anthropic API) ────────────────────────────

function buildSystemPrompt(waContext?: string, activeChatLabel?: string): string {
  const parts = [
    `You are a sharp, empathetic conversation analyst and personal assistant.
You help the user deeply understand their WhatsApp conversations — including relationship dynamics, emotional patterns, unspoken tensions, commitments, and how to respond better.

When asked about the conversation:
- Be honest and direct, not just validating
- Identify emotional patterns, power dynamics, recurring themes
- Call out passive-aggressive, avoidant, or unhealthy communication if present
- Suggest concrete next steps or reply wording when helpful
- Track commitments, promises, and follow-ups mentioned
- Notice changes in tone, frequency, or engagement over time

Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Be concise. Use bullet points for lists. Match the user's language.`,
  ]

  if (activeChatLabel) {
    parts.push(`\nActive conversation: "${activeChatLabel}"`)
  }

  if (waContext?.trim()) {
    parts.push(
      `\nFull WhatsApp conversation loaded as context. Analyse it deeply when asked:\n<whatsapp_chat>\n${waContext.slice(0, 60000)}\n</whatsapp_chat>`,
    )
  }

  return parts.join('\n')
}

async function streamViaBrowser(opts: StreamOptions): Promise<string> {
  const key = (import.meta.env.VITE_ANTHROPIC_API_KEY ?? '').trim()
  if (!key) {
    throw new Error(
      'NO_KEY: Add ANTHROPIC_API_KEY to .env (server) or VITE_ANTHROPIC_API_KEY to .env.local (browser) to use the chat assistant.',
    )
  }

  const model =
    (import.meta.env.VITE_ANTHROPIC_MODEL ?? '').trim() || 'claude-haiku-4-5-20251001'

  const system = buildSystemPrompt(opts.waContext, opts.activeChatLabel)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      stream: true,
      system,
      messages: opts.messages.slice(-30),
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `Anthropic API error ${res.status}`)
  }

  return consumeSSE(res, opts.onChunk)
}

// ── Shared SSE consumer ───────────────────────────────────────────────────────

async function consumeSSE(
  res: Response,
  onChunk: (text: string) => void,
): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue
      try {
        const evt = JSON.parse(raw) as Record<string, unknown>
        // Anthropic streaming format
        if (
          evt.type === 'content_block_delta' &&
          typeof evt.delta === 'object' &&
          evt.delta !== null
        ) {
          const delta = evt.delta as Record<string, unknown>
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            full += delta.text
            onChunk(delta.text)
          }
        }
        // Server SSE format (our own /api/chat)
        if (evt.type === 'chunk' && typeof evt.text === 'string') {
          full += evt.text
          onChunk(evt.text)
        }
        if (evt.type === 'error') {
          throw new Error(String(evt.message ?? 'Stream error'))
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }

  return full
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Health-check: does the server have an AI key? */
let _serverHasKey: boolean | null = null
export async function serverHasKey(): Promise<boolean> {
  if (_serverHasKey !== null) return _serverHasKey
  try {
    const res = await fetch('/api/health')
    const data = (await res.json()) as { anthropic?: boolean; openai?: boolean; ollama?: boolean; ai?: boolean }
    _serverHasKey = Boolean(data.ai || data.anthropic || data.openai || data.ollama)
  } catch {
    _serverHasKey = false
  }
  return _serverHasKey
}

/** Stream a chat response. Uses server if available, browser API otherwise. */
export async function streamChat(opts: StreamOptions): Promise<string> {
  const useServer = await serverHasKey()
  if (useServer) {
    return streamViaServer(opts)
  }
  return streamViaBrowser(opts)
}

export function hasBrowserKey(): boolean {
  return Boolean((import.meta.env.VITE_ANTHROPIC_API_KEY ?? '').trim())
}
