import type { HeuristicToneAnalysis, ToneLabel, ToneScores } from '../types'

const STRESS =
  /\b(urgent|asap|stressed|overwhelmed|deadline|can't cope|frustrat|exhausted|panic)\b/gi
const ANGER =
  /\b(hate|stupid|ridiculous|unacceptable|furious|angry|worst|never again)\b|!{2,}/gi
const POLITE =
  /\b(please|thank you|thanks|appreciate|grateful|kindly|would you mind)\b/gi
const ENTHUSIAST =
  /\b(love|excited|amazing|great|wonderful|fantastic|awesome|can't wait)\b|!+/gi

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

export function analyzeTone(text: string, contactId?: string): HeuristicToneAnalysis {
  const t = text.trim()
  const lower = t.toLowerCase()
  const len = Math.max(t.length, 1)

  const stressHits = [...t.matchAll(STRESS)].length
  const angerHits = [...t.matchAll(ANGER)].length
  const politeHits = [...t.matchAll(POLITE)].length
  const enthHits = [...t.matchAll(ENTHUSIAST)].length

  const capsRatio = (t.match(/[A-Z]/g) || []).length / len
  const exclaim = (t.match(/!/g) || []).length
  const ellipsis = (t.match(/\.\.\./g) || []).length

  let stress = clamp01(stressHits * 0.18 + capsRatio * 0.4 + ellipsis * 0.15 + exclaim * 0.05)
  let anger = clamp01(angerHits * 0.22 + capsRatio * 0.35 + exclaim * 0.12)
  let politeness = clamp01(politeHits * 0.2 + (lower.includes('sorry') ? 0.15 : 0))
  let enthusiasm = clamp01(enthHits * 0.15 + exclaim * 0.08)

  const rawSum = stress + anger + politeness + enthusiasm
  const neutral = clamp01(1 - rawSum * 0.35)

  const scores: ToneScores = { stress, anger, politeness, enthusiasm, neutral }

  const entries = Object.entries(scores) as [ToneLabel, number][]
  entries.sort((a, b) => b[1] - a[1])
  const dominant = entries[0][0]

  const explanation: string[] = []
  if (stressHits) explanation.push(`Stress cues: ${stressHits} stress-related phrase(s) detected.`)
  if (capsRatio > 0.12) explanation.push('Heavy capitalization can read as intensity or distraction.')
  if (ellipsis) explanation.push('Ellipses often signal hesitation or emotional load.')
  if (angerHits) explanation.push('Strong negative wording may escalate conflict.')
  if (politeHits) explanation.push('Polite framing reduces perceived harshness.')
  if (exclaim > 2 && anger < 0.3) explanation.push('Multiple exclamation marks can read as enthusiasm—or pressure.')
  if (!explanation.length) explanation.push('No strong lexical markers; tone appears fairly balanced.')

  const suggestions: string[] = []
  if (stress > 0.45) {
    suggestions.push('Add one concrete next step instead of urgency language.')
    suggestions.push('Take a 10-minute break before sending if this is emotionally charged.')
  }
  if (anger > 0.4) {
    suggestions.push('Replace evaluative words with observable facts.')
    suggestions.push('Lead with shared goal: “We both want this shipped on time.”')
  }
  if (politeness < 0.2 && (stress > 0.35 || anger > 0.3)) {
    suggestions.push('A brief “thanks for your patience” softens without over-apologizing.')
  }
  if (dominant === 'enthusiasm' && exclaim > 3) {
    suggestions.push('Consider trimming exclamation marks for professional recipients.')
  }

  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    messagePreview: t.slice(0, 160) + (t.length > 160 ? '…' : ''),
    dominant,
    scores,
    explanation,
    suggestions: suggestions.length
      ? suggestions
      : ['Message looks clear. Send when ready, or schedule for recipient-friendly hours.'],
    contactId,
  }
}

export function monthlyTrendFromHistory(history: HeuristicToneAnalysis[]) {
  const byTone: Record<ToneLabel, number> = {
    stress: 0,
    anger: 0,
    politeness: 0,
    enthusiasm: 0,
    neutral: 0,
  }
  for (const h of history) {
    byTone[h.dominant] += 1
  }
  const n = Math.max(history.length, 1)
  const pct = (k: ToneLabel) => Math.round((byTone[k] / n) * 100)
  return { byTone, pct, total: history.length }
}
