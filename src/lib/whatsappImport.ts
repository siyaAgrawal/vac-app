import type { Commitment } from '../types'

export type WhatsAppMessage = {
  id: string
  author: string
  text: string
  rawHeader: string
  timestamp: string | null
  date: string
  time: string
}

export type WhatsAppImportResult = {
  commitments: Commitment[]
  messages: WhatsAppMessage[]
  meta: { messageCount: number; usedOpenAI: boolean; usedClaude: boolean; method: string }
}

const WA_MESSAGES_KEY = 'clarity-wa-messages-v1'
const WA_CONTEXT_KEY = 'clarity-wa-context-v1'

export function saveWaMessages(messages: WhatsAppMessage[], plainText: string) {
  localStorage.setItem(WA_MESSAGES_KEY, JSON.stringify(messages))
  localStorage.setItem(WA_CONTEXT_KEY, plainText)
}

export function loadWaMessages(): WhatsAppMessage[] {
  try {
    const raw = localStorage.getItem(WA_MESSAGES_KEY)
    return raw ? (JSON.parse(raw) as WhatsAppMessage[]) : []
  } catch {
    return []
  }
}

export function loadWaContext(): string {
  return localStorage.getItem(WA_CONTEXT_KEY) ?? ''
}

export function clearWaMessages() {
  localStorage.removeItem(WA_MESSAGES_KEY)
  localStorage.removeItem(WA_CONTEXT_KEY)
}

export async function importWhatsAppExportFile(file: File): Promise<WhatsAppImportResult> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/whatsapp-import', { method: 'POST', body: fd })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `Import failed (${res.status})`)
  }
  const result = (await res.json()) as WhatsAppImportResult
  // Persist messages for viewer + chat context
  const plainText = result.messages.map((m) => `${m.author}: ${m.text}`).join('\n')
  saveWaMessages(result.messages, plainText)
  return result
}

export async function checkApiHealth(): Promise<{
  ok: boolean
  openai: boolean
  anthropic: boolean
  ollama?: boolean
  ai?: boolean
  provider?: string | null
  note?: string
} | null> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
