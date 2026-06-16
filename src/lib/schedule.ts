export function recipientLocalParts(timezone: string, date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      minute: '2-digit',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    const parts = fmt.formatToParts(date)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12)
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
    const label = `${String(hour).padStart(2, '0')}:${minute}`
    const dateLabel = [
      parts.find((p) => p.type === 'weekday')?.value,
      parts.find((p) => p.type === 'month')?.value,
      parts.find((p) => p.type === 'day')?.value,
    ]
      .filter(Boolean)
      .join(' ')
    return { hour, label, dateLabel, timezone }
  } catch {
    return { hour: 12, label: '—', dateLabel: '', timezone: 'UTC' }
  }
}

export function isInconvenientHour(
  timezone: string,
  professional: boolean,
  date = new Date(),
) {
  const { hour } = recipientLocalParts(timezone, date)
  if (hour >= 23 || hour < 7) {
    return {
      bad: true,
      reason: `Recipient local time is around ${hour}:00 — likely asleep.`,
    }
  }
  if (professional && (hour < 8 || hour >= 20)) {
    return {
      bad: true,
      reason: 'Outside typical business hours for professional contacts.',
    }
  }
  return { bad: false, reason: 'Within a reasonable window for this contact type.' }
}

export function suggestSendWindow(
  activeStart: number,
  activeEnd: number,
  timezone: string,
) {
  return {
    text: `Likely higher engagement when recipient is active (${activeStart}:00–${activeEnd}:00 ${timezone}).`,
    activeStart,
    activeEnd,
  }
}
