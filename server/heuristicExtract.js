/**
 * Rule-based commitment extraction — precision-first.
 *
 * PHILOSOPHY: Only extract things Siya (the "You" / outgoing side) explicitly
 * committed to doing FOR another person. We care about:
 *   - What: the action promised
 *   - Who:  the person the promise was made to (inferred from conversation partner)
 *   - When: the timeframe (if mentioned)
 *
 * We deliberately SKIP:
 *   - Messages sent BY others (requests, demands, reminders to Siya)
 *   - Generic urgency keywords with no personal commitment
 *   - System messages / media omitted lines
 *   - "We should" / "let's" vague suggestions
 */
import { randomUUID } from 'node:crypto'

const DAY_NAMES = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
}

function daysUntilWeekday(name, from) {
  const target = DAY_NAMES[name.toLowerCase()]
  if (target === undefined) return 7
  const current = from.getDay()
  const diff = (target - current + 7) % 7
  return diff === 0 ? 7 : diff
}

function pad(n) { return String(n).padStart(2, '0') }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function isoTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/**
 * Parse a WhatsApp export line.
 * Returns { timestamp, author, text } or null if it doesn't match WA format.
 * Supports both 12h ("12/25/22, 10:30 AM - Author: msg") and 24h formats.
 */
function parseLine(raw) {
  // Try to match: date, time, author, message
  const m = raw.match(
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s+-\s+([^:]+):\s*([\s\S]*)$/i,
  )
  if (!m) return null
  return {
    author: m[3].trim(),
    text:   m[4].trim(),
  }
}

/** Identify the "other person" in a conversation given a list of authors. */
function inferPartner(authors, selfName = 'You') {
  const others = [...new Set(authors)].filter(
    (a) => a.toLowerCase() !== selfName.toLowerCase() && a !== 'System',
  )
  if (others.length === 1) return others[0]
  if (others.length > 1) return others.join(', ')
  return 'Unknown'
}

/**
 * Strong promise verbs: first-person explicit future actions.
 * We require the subject to be "I" (implicit in these patterns).
 */
// Only match EXPLICIT first-person commitments — specific verbs, not vague support phrases.
// Deliberately excludes "let me help/look/sort/check/see" (too generic).
const STRONG_PROMISE_RE =
  /\b(I('ll| will)\s+(send|call|check|follow\s*up|get\s*back|do|fix|handle|share|forward|ask|confirm|update|tell|pay|transfer|drop|bring|book|schedule|arrange|pick\s*up|come|be\s*there|make\s*sure|take\s*care|sort\s*it|get\s*it\s*done|look\s*into\s*(?:it|the|that|this)|let\s*you\s*know)|I\s+will\s+(send|call|check|share|fix|handle|pay|confirm|update|book|arrange)|I\s*promise|I\s*commit\b|count\s*on\s*me)\b/i

/** "By [timeframe]" deadline patterns */
const DUE_RE =
  /\b(by|before|until)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|tonight|today|next week|EOD|end of day|end of the day|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}|\d{1,2}\s*(?:am|pm))/i

/** Noise lines to always skip */
const NOISE_RE = /^\s*(<Media omitted>|This message was deleted|Messages and calls are end-to-end encrypted)/i

export function heuristicExtractFromText(text, now = new Date()) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)

  // Collect all parsed lines to know who the conversation partners are
  const parsed = lines.map(parseLine).filter(Boolean)
  const allAuthors = parsed.map((p) => p.author)

  const out = []

  for (let i = 0; i < parsed.length; i++) {
    const { author, text: msg } = parsed[i]

    // Only process outgoing messages (Siya's side)
    if (author.toLowerCase() !== 'you') continue
    if (NOISE_RE.test(msg)) continue

    const isPromise = STRONG_PROMISE_RE.test(msg)
    if (!isPromise) continue   // Skip requests, urgency alone, etc.

    // Infer the person this was said to: look at the other author(s) surrounding this message
    // (check messages within 5 lines before/after)
    const window = parsed.slice(Math.max(0, i - 5), i + 5)
    const windowAuthors = window.map((p) => p.author)
    const person = inferPartner(windowAuthors, 'You')

    // Try to extract due date from this message
    let dueDate = isoDate(new Date(now.getTime() + 2 * 86_400_000))  // default: +2 days
    let dueTime = '17:00'
    let hasDue = false

    const dueMatch = msg.match(DUE_RE)
    if (dueMatch) {
      hasDue = true
      const keyword = dueMatch[2].toLowerCase().trim()
      const d = new Date(now)
      if (keyword === 'today' || keyword === 'eod' || keyword.startsWith('end of')) {
        d.setHours(17, 0, 0, 0)
        dueDate = isoDate(d)
        dueTime = '17:00'
      } else if (keyword === 'tonight') {
        d.setHours(20, 0, 0, 0)
        dueDate = isoDate(d)
        dueTime = '20:00'
      } else if (keyword === 'tomorrow') {
        d.setDate(d.getDate() + 1)
        d.setHours(17, 0, 0, 0)
        dueDate = isoDate(d)
      } else if (keyword === 'next week') {
        d.setDate(d.getDate() + 7)
        dueDate = isoDate(d)
      } else if (DAY_NAMES[keyword] !== undefined) {
        d.setDate(d.getDate() + daysUntilWeekday(keyword, now))
        dueDate = isoDate(d)
      } else if (/^\d{1,2}\/\d{1,2}$/.test(keyword)) {
        const [month, day] = keyword.split('/').map(Number)
        d.setMonth(month - 1, day)
        d.setHours(17, 0, 0, 0)
        if (d < now) d.setFullYear(d.getFullYear() + 1)
        dueDate = isoDate(d)
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(keyword)) {
        dueDate = keyword
      } else if (/\d{1,2}\s*(am|pm)/i.test(keyword)) {
        const timeMatch = keyword.match(/(\d{1,2})\s*(am|pm)/i)
        if (timeMatch) {
          let h = parseInt(timeMatch[1])
          if (timeMatch[2].toLowerCase() === 'pm' && h < 12) h += 12
          if (timeMatch[2].toLowerCase() === 'am' && h === 12) h = 0
          d.setHours(h, 0, 0, 0)
          dueDate = isoDate(d)
          dueTime = isoTime(d)
        }
      }
    } else if (/\btomorrow\b/i.test(msg)) {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(17, 0, 0, 0)
      dueDate = isoDate(d)
    } else if (/\btonight\b/i.test(msg)) {
      const d = new Date(now)
      d.setHours(20, 0, 0, 0)
      dueDate = isoDate(d)
      dueTime = '20:00'
    } else if (/\bnext week\b/i.test(msg)) {
      const d = new Date(now)
      d.setDate(d.getDate() + 7)
      dueDate = isoDate(d)
    }

    const dueDt = new Date(`${dueDate}T${dueTime}:00`)
    const status = dueDt.getTime() < now.getTime() ? 'overdue' : 'pending'
    const critical = /\b(urgent|asap|eod|end of day|as soon as possible|immediately|right now)\b/i.test(msg)

    // Trim the text to a clean actionable summary
    const cleanText = msg.slice(0, 200).replace(/\s+/g, ' ').trim()

    // Deduplicate by (person, cleanText similarity)
    const isDup = out.some(
      (c) =>
        c.person === person &&
        c.text.toLowerCase().slice(0, 60) === cleanText.toLowerCase().slice(0, 60),
    )
    if (isDup) continue

    out.push({
      id: randomUUID(),
      text:    cleanText,
      person,
      action:  cleanText,
      urgency: critical ? 'high' : hasDue ? 'medium' : 'low',
      status,
      dueDate,
      dueTime,
      source:  person !== 'Unknown' ? `WhatsApp – ${person}` : 'WhatsApp export',
      createdAt: now.toISOString(),
      notifyBefore: critical ? 30 : 60,
      notified: false,
      tags:    ['whatsapp', 'rules', ...(person !== 'Unknown' ? [person.toLowerCase()] : [])],
    })
  }

  return out
}
