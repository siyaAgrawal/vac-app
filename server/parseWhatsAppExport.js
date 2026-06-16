/**
 * Parses common WhatsApp ".txt" export shapes (Android / iOS / variants).
 * Returns { messages: { id, author, text, rawHeader, timestamp }[], plainText: string }
 */
import { randomUUID } from 'node:crypto'

function tryMatchLine(line) {
  const patterns = [
    // [DD/MM/YYYY, HH:MM:SS] Author: text  (iOS)
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)\]\s*([^:]+):\s*(.*)$/i,
    // DD/MM/YYYY, HH:MM - Author: text  (Android)
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)\s*[-–—]\s*([^:]+):\s*(.*)$/i,
    // DD-MM-YYYY, HH:MM - Author: text
    /^(\d{1,2}-\d{1,2}-\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*([^:]+):\s*(.*)$/i,
    // M/D/YY, H:MM AM/PM - Author: text  (US format)
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}\s*[ap]m)\s*[-–—]\s*([^:]+):\s*(.*)$/i,
  ]
  for (const re of patterns) {
    const m = line.match(re)
    if (m) {
      return {
        rawHeader: m[0],
        date: m[1].trim(),
        time: m[2].trim(),
        author: m[3].trim(),
        text: (m[4] ?? '').trim(),
      }
    }
  }
  return null
}

function parseTimestamp(date, time) {
  try {
    // Normalise date: support DD/MM/YYYY and MM/DD/YYYY — try both
    const sep = date.includes('-') ? '-' : '/'
    const parts = date.split(sep)
    if (parts.length !== 3) return null

    let [a, b, c] = parts.map(Number)
    // If year is 2 digits, expand
    if (c < 100) c += c < 30 ? 2000 : 1900
    if (a > 31) [a, b, c] = [c, b, a] // year-first

    // Normalise time: handle AM/PM
    let timeStr = time.replace(/\s*/g, '').toLowerCase()
    let hour = 0, min = 0, sec = 0
    const ampm = timeStr.match(/([ap])m$/)
    if (ampm) {
      timeStr = timeStr.replace(/[ap]m$/, '')
      const [h, m2, s2] = timeStr.split(':').map(Number)
      hour = h; min = m2 || 0; sec = s2 || 0
      if (ampm[1] === 'p' && hour !== 12) hour += 12
      if (ampm[1] === 'a' && hour === 12) hour = 0
    } else {
      const [h, m2, s2] = timeStr.split(':').map(Number)
      hour = h; min = m2 || 0; sec = s2 || 0
    }

    // Try DD/MM/YYYY first (most common worldwide), then MM/DD/YYYY
    const tryDate = (day, month, year) => {
      if (month < 1 || month > 12 || day < 1 || day > 31) return null
      const d = new Date(year, month - 1, day, hour, min, sec)
      return isNaN(d.getTime()) ? null : d
    }

    return tryDate(a, b, c) ?? tryDate(b, a, c)
  } catch {
    return null
  }
}

export function parseWhatsAppExport(raw) {
  const lines = raw.replace(/\u200e/g, '').split(/\r?\n/)
  const messages = []
  let cur = null

  for (const line of lines) {
    const hit = tryMatchLine(line)
    if (hit) {
      if (cur) messages.push(cur)
      const ts = parseTimestamp(hit.date, hit.time)
      cur = {
        id: randomUUID(),
        author: hit.author,
        text: hit.text,
        rawHeader: hit.rawHeader,
        timestamp: ts ? ts.toISOString() : null,
        date: hit.date,
        time: hit.time,
      }
    } else if (cur && line.trim()) {
      if (!line.includes('Messages and calls are end-to-end encrypted')) {
        cur.text += `\n${line}`
      }
    }
  }
  if (cur) messages.push(cur)

  // Filter system messages (no real text content)
  const filtered = messages.filter(
    (m) =>
      m.text.trim() &&
      !m.text.match(/^<Media omitted>$/i) &&
      !m.text.match(/^This message was deleted$/i),
  )

  const plainText = filtered.map((m) => `${m.author}: ${m.text}`).join('\n')
  return { messages: filtered, plainText }
}
