import { format, isBefore, parseISO } from 'date-fns'
import type { Commitment, CommitmentStatus, Urgency } from '../types'

interface AiExtractedItem {
  action: string
  person: string
  due_iso: string | null
  critical: boolean
}

interface AiResponse {
  items: AiExtractedItem[]
}

function parseJsonObject(content: string): AiResponse {
  const trimmed = content.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model did not return JSON.')
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as AiResponse
  if (!Array.isArray(parsed.items)) parsed.items = []
  return parsed
}

function toCommitment(e: AiExtractedItem): Commitment {
  const now = new Date()
  const person = String(e.person || 'Unknown').slice(0, 80)
  const action = String(e.action || 'Untitled').slice(0, 240)
  let dueDate = format(now, 'yyyy-MM-dd')
  let dueTime = '17:00'
  let status: CommitmentStatus = 'pending'
  if (e.due_iso) {
    const d = parseISO(e.due_iso)
    if (!Number.isNaN(d.getTime())) {
      dueDate = format(d, 'yyyy-MM-dd')
      dueTime = format(d, 'HH:mm')
      if (isBefore(d, now)) status = 'overdue'
    }
  }
  const urgency: Urgency = e.critical ? 'high' : 'medium'
  return {
    id: crypto.randomUUID(),
    text: action,
    person,
    action,
    urgency,
    status,
    dueDate,
    dueTime,
    source: person !== 'Unknown' ? `OpenAI – ${person}` : 'OpenAI extraction',
    createdAt: now.toISOString(),
    notifyBefore: e.critical ? 30 : 60,
    notified: false,
    tags: ['openai', person.toLowerCase()],
  }
}

export async function extractCommitmentsWithAI(text: string): Promise<Commitment[]> {
  const key = import.meta.env.VITE_OPENAI_API_KEY?.trim()
  if (!key) {
    throw new Error(
      'Add VITE_OPENAI_API_KEY to .env.local (see .env.example). Keys in the client are only for local demos — use a server proxy in production.',
    )
  }

  const system = `You are analyzing a conversation. Extract ONLY commitments that the user ("You") explicitly made TO other people.

Include an item ONLY if ALL of these are true:
1. The message was sent BY "You"
2. It contains an explicit first-person promise: "I'll", "I will", "let me", "I promise", "I'll get back", "I'll send", "I'll call", etc.
3. The action is specific (not just "ok", "sure", "sounds good")

SKIP:
- Messages from other people (requests or demands made TO you)
- Vague agreements without a clear action
- "We should" suggestions
- System messages

Respond with ONLY valid JSON (no markdown):
{"items":[{"action":"concise action ≤150 chars","person":"who this was promised to","due_iso":"ISO 8601 or null","critical":true|false}]}

Rules:
- action: imperative summary of what you committed to do
- person: name of the person the commitment was made to (from conversation context)
- due_iso: ISO 8601 if a date/time can be inferred, else null
- critical: true if urgent, ASAP, EOD, legal, money, or health/safety
- If nothing qualifies: {"items":[]}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text.slice(0, 12000) },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty model response.')

  const parsed = parseJsonObject(content)
  return parsed.items
    .filter((e) => e.action && String(e.action).length > 5)
    .map(toCommitment)
}
