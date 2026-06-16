const KEY = 'clarity-notification-prefs-v1'
const VAC_KEY = 'vac-notification-prefs-v1'

export interface NotificationPrefs {
  /** User has gone through the one-time browser prompt flow (we don't re-prompt automatically). */
  permissionPromptShown: boolean
  /** Master switch: when false, no notifications are sent. */
  masterEnabled: boolean
  notifyOverdue: boolean
  notifyPending: boolean
  notifyCompleted: boolean
  /** Optional periodic checks while the app is open. */
  autoRemindEvery15Min: boolean
}

const defaultPrefs: NotificationPrefs = {
  permissionPromptShown: false,
  masterEnabled: true,
  notifyOverdue: true,
  notifyPending: true,
  notifyCompleted: false,
  autoRemindEvery15Min: false,
}

export function loadNotificationPrefs(): NotificationPrefs {
  try {
    let raw = localStorage.getItem(KEY)
    if (!raw) {
      raw = localStorage.getItem(VAC_KEY)
      if (raw) localStorage.setItem(KEY, raw)
    }
    if (!raw) return { ...defaultPrefs }
    return { ...defaultPrefs, ...JSON.parse(raw) } as NotificationPrefs
  } catch {
    return { ...defaultPrefs }
  }
}

export function saveNotificationPrefs(p: NotificationPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function updateNotificationPrefs(patch: Partial<NotificationPrefs>) {
  const next = { ...loadNotificationPrefs(), ...patch }
  saveNotificationPrefs(next)
  return next
}
