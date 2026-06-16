/**
 * Server-side OpenAI commitment extraction (key stays off the client).
 */
import { randomUUID } from 'node:crypto'

function parseJsonObject(content) {
  const trimmed = content.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model did not return JSON.')
  return JSON.parse(trimmed.slice(start, end + 1))
}

function toCommitment(e, nowIso) {
  const now = new Date(nowIso)
  let dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
  const urgency = e.critical ? 'high' : 'medium'
  return {
    id: randomUUID(),
    text: String(e.title || 'Untitled').slice(0, 240),
    urgency,
    status,
    dueDate,
    dueTime,
    source: 'WhatsApp export',
    createdAt: nowIso,
    notifyBefore: 60,
    notified: false,
    tags: ['whatsapp'],
  }
}

export async function extractCommitmentsWithOpenAI(apiKey, text) {
  const system = `You extract actionable commitments, promises, deadlines, and follow-ups from a WhatsApp conversation export. Include explicit obligations from any participant.

Respond with ONLY valid JSON (no markdown) in this exact shape:
{"items":[{"title":"short imperative summary","due_iso":"ISO8601 or null","critical":true or false}]}

Rules:
- title: concise, <= 200 chars
- due_iso: ISO 8601 if inferable, else null
- critical: true if urgent, ASAP, today, legal, money
- If nothing qualifies, return {"items":[]}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text.slice(0, 12000) },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI ${res.status}: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Empty OpenAI response')
  const parsed = parseJsonObject(content)
  const items = Array.isArray(parsed.items) ? parsed.items : []
  const nowIso = new Date().toISOString()
  return items.map((e) => toCommitment(e, nowIso))
}
