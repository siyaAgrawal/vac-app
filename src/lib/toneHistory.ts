import type { HeuristicToneAnalysis } from '../types'

const KEY = 'clarity-tone-history-v1'
const VAC_KEY = 'vac-tone-history-v1'

function migrate() {
  try {
    if (localStorage.getItem(KEY)) return
    const vac = localStorage.getItem(VAC_KEY)
    if (vac) localStorage.setItem(KEY, vac)
  } catch {
    /* ignore */
  }
}

export function loadToneHistory(): HeuristicToneAnalysis[] {
  migrate()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as HeuristicToneAnalysis[]
  } catch {
    return []
  }
}

export function appendToneAnalysis(a: HeuristicToneAnalysis) {
  const prev = loadToneHistory()
  const next = [a, ...prev].slice(0, 200)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}
