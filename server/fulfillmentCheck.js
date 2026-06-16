/**
 * AI-powered commitment fulfillment checker.
 * Given a commitment + optional evidence/chat context, asks Claude
 * whether the commitment has been fulfilled.
 */
import { claudeComplete } from './claudeClient.js'

const SYSTEM = `You are an expert analyst who determines whether a commitment or obligation has been fulfilled.
You analyze evidence (conversation excerpts, notes, or status updates) and give a clear verdict.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON:
{
  "fulfilled": true | false,
  "confidence": 0.0–1.0,
  "reasoning": "2-3 sentence explanation of your verdict",
  "suggestion": "one actionable next step if not fulfilled, or null if fulfilled"
}`

export async function checkFulfillment({ commitment, evidence, waContext }) {
  const parts = [`Commitment: "${commitment}"`]

  if (evidence?.trim()) {
    parts.push(`\nEvidence provided by user:\n${evidence.slice(0, 3000)}`)
  }

  if (waContext?.trim()) {
    parts.push(`\nWhatsApp conversation context (last portion):\n${waContext.slice(-4000)}`)
  }

  if (parts.length === 1) {
    parts.push('\nNo evidence or context provided — assess based on commitment text only.')
  }

  const text = await claudeComplete({
    system: SYSTEM,
    messages: [{ role: 'user', content: parts.join('\n') }],
    maxTokens: 400,
    smart: false,
  })

  const clean = text.replace(/```json|```/g, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Invalid JSON from fulfillment check')
  return JSON.parse(clean.slice(start, end + 1))
}
