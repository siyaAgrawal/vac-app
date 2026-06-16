import type { Commitment } from '../types'
import type { NotificationPrefs } from './notificationPrefs'

const APP_TITLE = 'Clarity'

function isOpen(c: Commitment) {
  return c.status === 'pending' || c.status === 'in-progress' || c.status === 'overdue'
}

function canSend(prefs: NotificationPrefs): boolean {
  return prefs.masterEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

function summarizeTexts(items: Commitment[], max = 6) {
  const titles = items.map((c) => c.text).slice(0, max)
  const more = items.length > max ? ` (+${items.length - max} more)` : ''
  return titles.join(' · ') + more
}

export function sendOverdueDigest(items: Commitment[], prefs: NotificationPrefs): string | null {
  if (!canSend(prefs) || !prefs.notifyOverdue) {
    return 'Turn on “All notifications”, allow the browser, and enable “Send this type” for overdue.'
  }
  const overdue = items.filter((c) => c.status === 'overdue')
  if (!overdue.length) {
    new Notification(`${APP_TITLE} — Overdue`, { body: 'No overdue commitments. You are clear.' })
    return null
  }
  new Notification(`${APP_TITLE} — ${overdue.length} overdue`, {
    body: summarizeTexts(overdue),
    tag: 'clarity-overdue',
  })
  return null
}

export function sendPendingDigest(items: Commitment[], prefs: NotificationPrefs): string | null {
  if (!canSend(prefs) || !prefs.notifyPending) {
    return 'Turn on “All notifications”, allow the browser, and enable “Send this type” for pending.'
  }
  const pending = items.filter((c) => c.status === 'pending' || c.status === 'in-progress')
  if (!pending.length) {
    new Notification(`${APP_TITLE} — Pending`, { body: 'No pending commitments right now.' })
    return null
  }
  new Notification(`${APP_TITLE} — ${pending.length} pending`, {
    body: summarizeTexts(pending),
    tag: 'clarity-pending',
  })
  return null
}

export function sendCompletedDigest(items: Commitment[], prefs: NotificationPrefs): string | null {
  if (!canSend(prefs) || !prefs.notifyCompleted) {
    return 'Turn on “All notifications”, allow the browser, and enable “Send this type” for completed.'
  }
  const done = items.filter((c) => c.status === 'completed')
  if (!done.length) {
    new Notification(`${APP_TITLE} — Completed`, { body: 'No completed items yet.' })
    return null
  }
  new Notification(`${APP_TITLE} — ${done.length} fulfilled`, {
    body: summarizeTexts(done),
    tag: 'clarity-completed',
  })
  return null
}

export function openWorkFingerprint(items: Commitment[]) {
  const open = items.filter(isOpen)
  return open.map((c) => `${c.id}:${c.status}`).sort().join('|')
}

export function completedFingerprint(items: Commitment[]) {
  return items
    .filter((c) => c.status === 'completed')
    .map((c) => c.id)
    .sort()
    .join('|')
}

export function notifyAfterMarkFulfilled(
  fulfilled: Commitment,
  items: Commitment[],
  prefs: NotificationPrefs,
): void {
  if (!canSend(prefs)) return

  if (prefs.notifyCompleted) {
    new Notification(`${APP_TITLE} — Fulfilled`, {
      body: fulfilled.text.slice(0, 200),
      tag: `clarity-done-${fulfilled.id}`,
    })
  }

  if (prefs.notifyPending) {
    const pending = items.filter((c) => c.status === 'pending' || c.status === 'in-progress')
    const body =
      pending.length === 0
        ? 'Nothing left in pending.'
        : `${pending.length} still pending — ${summarizeTexts(pending, 4)}`
    new Notification(`${APP_TITLE} — Pending`, { body, tag: 'clarity-pending' })
  }

  if (prefs.notifyOverdue) {
    const overdue = items.filter((c) => c.status === 'overdue')
    const body =
      overdue.length === 0
        ? 'No overdue items.'
        : `${overdue.length} overdue — ${summarizeTexts(overdue, 4)}`
    new Notification(`${APP_TITLE} — Overdue`, { body, tag: 'clarity-overdue' })
  }
}
