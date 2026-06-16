import type { AnthropicToneAnalysis, Urgency } from '../types'

function getKey() {
  return import.meta.env.VITE_ANTHROPIC_API_KEY?.trim() ?? ''
}

function getModel() {
  return (
    import.meta.env.VITE_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514'
  )
}

function joinContentText(data: { content?: { type?: string; text?: string }[] }) {
  const blocks = data.content ?? []
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text as string)
    .join('')
}

export async function analyzeMessage(text: string): Promise<AnthropicToneAnalysis> {
  const API_KEY = getKey()
  if (!API_KEY) {
    throw new Error(
      'Set VITE_ANTHROPIC_API_KEY in .env.local. Use a backend proxy in production.',
    )
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: `You are a world-class communication analyst. Analyze the tone, psychology, and intent of the following message with precision.

Message:
"""
${text.slice(0, 12000)}
"""

Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "tone_tags": ["2-5 descriptive tone labels — choose from: assertive, passive-aggressive, warm, cold, urgent, relaxed, professional, casual, empathetic, dismissive, frustrated, enthusiastic, formal, friendly, manipulative, anxious, confident, vague, direct, diplomatic"],
  "tone_score": <0-100, intensity of the dominant tone>,
  "urgency": <0-100, how urgent the message feels>,
  "clarity": <0-100, how clear and unambiguous the message is>,
  "sentiment": <0-100, 0=very negative, 50=neutral, 100=very positive>,
  "intent_clarity": <0-100, how clear the sender's intent is>,
  "trust": <0-100, how much trust/rapport the message conveys>,
  "overall_score": <0-100, overall communication effectiveness>,
  "observations": ["3 specific, insightful observations about communication psychology, subtext, or impact"],
  "commitments": ["any explicit or implicit action items promised by the sender — be precise, or return empty array"],
  "suggested_reply": "<one concrete sentence for how to reply, or null>"
}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string }
    }
    throw new Error(err.error?.message ?? `Anthropic API error ${res.status}`)
  }

  const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
  const raw = joinContentText(data)
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean) as AnthropicToneAnalysis
}

export async function suggestCommitmentDetails(text: string): Promise<{
  urgency: Urgency
  tags: string[]
  suggestedDueHours: number
}> {
  const API_KEY = getKey()
  if (!API_KEY) throw new Error('Missing VITE_ANTHROPIC_API_KEY')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: getModel(),
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Analyze this commitment/task and return ONLY valid JSON:
"${text.slice(0, 4000)}"

{
  "urgency": "low" | "medium" | "high" | "emergency",
  "tags": ["1-3 category tags like 'email', 'meeting', 'review', 'deadline', 'client', 'internal'"],
  "suggestedDueHours": <number of hours from now this is likely due, e.g. 24, 48, 72, 168>
}`,
        },
      ],
    }),
  })

  if (!res.ok) throw new Error('Anthropic API error')
  const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
  const raw = joinContentText(data)
  const clean = raw.replace(/```json|```/g, '').trim()
  return JSON.parse(clean) as { urgency: Urgency; tags: string[]; suggestedDueHours: number }
}
