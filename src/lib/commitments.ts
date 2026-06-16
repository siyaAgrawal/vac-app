import { addDays, format, isBefore, parseISO } from 'date-fns'
import type { Commitment, CommitmentStatus, Urgency } from '../types'

const STORAGE_KEY = 'clarity-commitments-v3'
const LEGACY_V1_KEY = 'clarity-commitments-v1'
const LEGACY_V2_KEY = 'clarity-commitments-v2'
const VAC_KEY = 'vac-commitments-v1'

interface LegacyCommitmentV1 {
  id: string
  title: string
  dueAt: string | null
  source: string
  platform: string
  status: 'pending' | 'completed' | 'overdue'
  critical: boolean
  createdAt: string
}

function isLegacyV1(row: unknown): row is LegacyCommitmentV1 {
  return (
    typeof row === 'object' &&
    row !== null &&
    'title' in row &&
    'dueAt' in row &&
    !('dueDate' in row)
  )
}

function migrateV1ToV2(raw: string): Commitment[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown[]
    if (!Array.isArray(parsed) || !parsed.length || !isLegacyV1(parsed[0])) return null
    return parsed.map((row) => {
      const r = row as LegacyCommitmentV1
      const base = new Date()
      let dueDate = format(base, 'yyyy-MM-dd')
      let dueTime = '17:00'
      if (r.dueAt) {
        const d = parseISO(r.dueAt)
        if (!Number.isNaN(d.getTime())) {
          dueDate = format(d, 'yyyy-MM-dd')
          dueTime = format(d, 'HH:mm')
        }
      }
      const status: CommitmentStatus =
        r.status === 'completed' ? 'completed' : r.status === 'overdue' ? 'overdue' : 'pending'
      const urgency: Urgency = r.critical ? 'high' : 'medium'
      return {
        id: r.id,
        text: r.title,
        person: 'Unknown',
        action: r.title,
        urgency,
        status,
        dueDate,
        dueTime,
        source: r.source,
        createdAt: r.createdAt,
        notifyBefore: 60,
        notified: false,
        tags: r.platform ? [r.platform] : [],
      } satisfies Commitment
    })
  } catch {
    return null
  }
}

// Generic-response phrases that should NEVER be stored as commitments.
// These are support/acknowledgment phrases, not real promises.
const GENERIC_RESPONSE_RE =
  /^(got\s*it|I\s*understand|I\s*hear\s*you|I\s*see|let\s*me\s*(help|look|sort|see|check|know|assist|handle)|I('m|\s*am)\s*(VAC|here\s*to\s*help|on\s*it|looking)|no\s*problem|sure\s*thing|of\s*course|absolutely|noted)/i

function isValidCommitment(c: { text: string; action: string }): boolean {
  const t = (c.action || c.text || '').trim()
  if (!t || t.length < 10) return false
  if (GENERIC_RESPONSE_RE.test(t)) return false
  return true
}

function migrateIntoV2() {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return

    // Try v2 first — only keep genuinely valid items
    const v2 = localStorage.getItem(LEGACY_V2_KEY)
    if (v2) {
      try {
        const parsed = JSON.parse(v2) as Commitment[]
        const valid = backfillFields(parsed).filter(isValidCommitment)
        if (valid.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(reconcileStatuses(valid)))
          return
        }
      } catch { /* fall through */ }
    }

    // Try v1 legacy keys
    const v1 = localStorage.getItem(LEGACY_V1_KEY)
    if (v1) {
      const m = migrateV1ToV2(v1)
      if (m?.length) {
        const valid = m.filter(isValidCommitment)
        if (valid.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(reconcileStatuses(valid)))
          return
        }
      }
    }
    const vac = localStorage.getItem(VAC_KEY)
    if (vac) {
      const m = migrateV1ToV2(vac)
      const valid = (m ?? []).filter(isValidCommitment)
      if (valid.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(reconcileStatuses(valid)))
    }
  } catch {
    /* ignore */
  }
}

export function commitmentDueAt(c: Commitment): Date {
  const time = c.dueTime.length === 5 ? `${c.dueTime}:00` : c.dueTime
  return new Date(`${c.dueDate}T${time}`)
}

/** Backfill new fields on commitments loaded from older storage. */
function backfillFields(items: Commitment[]): Commitment[] {
  return items.map((c) => ({
    ...c,
    person: c.person ?? 'Unknown',
    action: c.action ?? c.text,
  }))
}

export function loadCommitments(): Commitment[] {
  migrateIntoV2()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedCommitments()
    const parsed = JSON.parse(raw) as Commitment[]
    return reconcileStatuses(backfillFields(parsed))
  } catch {
    return seedCommitments()
  }
}

export function saveCommitments(items: Commitment[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function reconcileStatuses(items: Commitment[]): Commitment[] {
  const now = new Date()
  return items.map((c) => {
    if (c.status === 'completed') return c
    let due: Date
    try {
      due = commitmentDueAt(c)
    } catch {
      return c
    }
    if (isBefore(due, now)) {
      if (c.status !== 'overdue') return { ...c, status: 'overdue' as const }
      return c
    }
    if (c.status === 'overdue') return { ...c, status: 'pending' as const }
    return c
  })
}

function seedCommitments(): Commitment[] {
  const now = new Date()
  const d1 = addDays(now, 2)
  const d2 = addDays(now, -5)
  const items: Commitment[] = [
    {
      id: crypto.randomUUID(),
      text: "I'll send the Q2 roadmap draft",
      person: 'Team',
      action: "Send Q2 roadmap draft",
      urgency: 'high',
      status: 'pending',
      dueDate: format(d1, 'yyyy-MM-dd'),
      dueTime: '17:00',
      source: 'WhatsApp – Team',
      createdAt: now.toISOString(),
      notifyBefore: 120,
      notified: false,
      tags: ['sample'],
    },
    {
      id: crypto.randomUUID(),
      text: "I'll follow up with Jordan on the contract",
      person: 'Jordan',
      action: 'Follow up with Jordan on contract',
      urgency: 'high',
      status: 'overdue',
      dueDate: format(d2, 'yyyy-MM-dd'),
      dueTime: '17:00',
      source: 'WhatsApp – Jordan',
      createdAt: addDays(now, -10).toISOString(),
      notifyBefore: 60,
      notified: false,
      tags: ['sample', 'jordan'],
    },
    {
      id: crypto.randomUUID(),
      text: "Let me share the notes from our design sync",
      person: 'Design team',
      action: 'Share notes from design sync',
      urgency: 'medium',
      status: 'pending',
      dueDate: format(addDays(now, 1), 'yyyy-MM-dd'),
      dueTime: '18:00',
      source: 'WhatsApp – Design team',
      createdAt: now.toISOString(),
      notifyBefore: 45,
      notified: false,
      tags: ['sample'],
    },
  ]
  saveCommitments(items)
  return items
}

function splitIso(iso: string): { dueDate: string; dueTime: string } {
  const d = parseISO(iso)
  return { dueDate: format(d, 'yyyy-MM-dd'), dueTime: format(d, 'HH:mm') }
}

// ─── Day-name → days-from-now helper ─────────────────────────────────────────

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}

function daysUntilWeekday(name: string, from: Date): number {
  const target = DAY_NAMES[name.toLowerCase()]
  if (target === undefined) return 7
  const current = from.getDay()
  const diff = (target - current + 7) % 7
  return diff === 0 ? 7 : diff
}


/**
 * Parse a WhatsApp export line — returns { author, text } or null.
 * Handles both "DD/MM/YYYY, HH:mm - Author: text" and 12h formats.
 */
function parseWaLine(raw: string): { author: string; text: string } | null {
  const m = raw.match(
    /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\s+-\s+([^:]+):\s*([\s\S]*)$/i,
  )
  return m ? { author: m[1].trim(), text: m[2].trim() } : null
}

/**
 * Rule-based extraction — precision first.
 * ONLY extracts explicit first-person promises made BY the user ("You") TO another person.
 * Skips requests from others, vague agreements, and noise lines.
 */
export function extractCommitmentsFromText(text: string, _platform = 'Scan'): Commitment[] {
  const rawLines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const now = new Date()

  // Only match EXPLICIT first-person commitments — specific verbs, not vague support phrases.
  const STRONG_PROMISE_RE =
    /\b(I('ll| will)\s+(send|call|check|follow\s*up|get\s*back|do|fix|handle|share|forward|ask|confirm|update|tell|pay|transfer|drop|bring|book|schedule|arrange|pick\s*up|come|be\s*there|make\s*sure|take\s*care|sort\s*it|get\s*it\s*done|look\s*into\s*(?:it|the|that|this)|let\s*you\s*know)|I\s+will\s+(send|call|check|share|fix|handle|pay|confirm|update|book|arrange)|I\s*promise\b|I\s*commit\b|count\s*on\s*me)\b/i

  const DUE_RE =
    /\b(by|before|until)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|tonight|today|next week|EOD|end of day|end of the day|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i

  const NOISE_RE = /^\s*(<Media omitted>|This message was deleted|Messages and calls are end-to-end encrypted)/i

  // Parse all lines that match WA format
  const parsed = rawLines.map(parseWaLine).filter(Boolean) as { author: string; text: string }[]

  const out: Commitment[] = []

  for (let i = 0; i < parsed.length; i++) {
    const { author, text: msg } = parsed[i]

    // Only process outgoing messages
    if (author.toLowerCase() !== 'you') continue
    if (NOISE_RE.test(msg)) continue
    if (!STRONG_PROMISE_RE.test(msg)) continue

    // Infer who the commitment was made to from surrounding context
    const window = parsed.slice(Math.max(0, i - 5), i + 6)
    const others = [...new Set(window.map((p) => p.author))].filter(
      (a) => a.toLowerCase() !== 'you',
    )
    const person = others.length === 1 ? others[0] : others.length > 1 ? others.join(', ') : 'Unknown'

    // Parse due date
    let dueAtIso: string | null = null
    const dueMatch = msg.match(DUE_RE)
    if (dueMatch) {
      const keyword = dueMatch[2].toLowerCase().trim()
      const d = new Date(now)
      if (keyword === 'today' || keyword === 'eod' || keyword.startsWith('end of')) {
        d.setHours(17, 0, 0, 0); dueAtIso = d.toISOString()
      } else if (keyword === 'tonight') {
        d.setHours(20, 0, 0, 0); dueAtIso = d.toISOString()
      } else if (keyword === 'tomorrow') {
        d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); dueAtIso = d.toISOString()
      } else if (keyword === 'next week') {
        d.setDate(d.getDate() + 7); d.setHours(17, 0, 0, 0); dueAtIso = d.toISOString()
      } else if (DAY_NAMES[keyword] !== undefined) {
        d.setDate(d.getDate() + daysUntilWeekday(keyword, now))
        d.setHours(17, 0, 0, 0); dueAtIso = d.toISOString()
      } else if (/^\d{1,2}\/\d{1,2}$/.test(keyword)) {
        const [month, day] = keyword.split('/').map(Number)
        d.setMonth(month - 1, day); d.setHours(17, 0, 0, 0)
        if (d < now) d.setFullYear(d.getFullYear() + 1)
        dueAtIso = d.toISOString()
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(keyword)) {
        dueAtIso = `${keyword}T17:00:00.000Z`
      }
    } else if (/\btomorrow\b/i.test(msg)) {
      const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); dueAtIso = d.toISOString()
    } else if (/\btonight\b/i.test(msg)) {
      const d = new Date(now); d.setHours(20, 0, 0, 0); dueAtIso = d.toISOString()
    } else if (/\bnext week\b/i.test(msg)) {
      const d = new Date(now); d.setDate(d.getDate() + 7); dueAtIso = d.toISOString()
    }

    const { dueDate, dueTime } = dueAtIso
      ? splitIso(dueAtIso)
      : { dueDate: format(addDays(now, 2), 'yyyy-MM-dd'), dueTime: '17:00' }

    const critical = /\b(urgent|asap|eod|end of day|as soon as possible|immediately)\b/i.test(msg)
    const hasDue = Boolean(dueAtIso)
    const urgency: Urgency = critical ? 'high' : hasDue ? 'medium' : 'low'

    const timePart = dueTime.length === 5 ? `${dueTime}:00` : dueTime
    const dueD = new Date(`${dueDate}T${timePart}`)
    const status: CommitmentStatus = isBefore(dueD, now) ? 'overdue' : 'pending'

    const action = msg.slice(0, 200).replace(/\s+/g, ' ').trim()

    // Deduplicate
    const isDup = out.some(
      (c) => c.person === person && c.text.toLowerCase().slice(0, 60) === action.toLowerCase().slice(0, 60),
    )
    if (isDup) continue

    out.push({
      id: crypto.randomUUID(),
      text: action,
      person,
      action,
      urgency,
      status,
      dueDate,
      dueTime,
      source: person !== 'Unknown' ? `WhatsApp – ${person}` : 'WhatsApp conversation',
      createdAt: now.toISOString(),
      notifyBefore: critical ? 30 : 60,
      notified: false,
      tags: ['rules', ...(person !== 'Unknown' ? [person.toLowerCase()] : [])],
    })
  }

  return out
}
