import { useState, useEffect, useCallback, useRef } from 'react'
import type { Commitment, InAppNotification } from '../types'
import { commitmentDueAt } from '../lib/commitments'

export type UseNotificationsOptions = {
  /** When true, also fires native Notification (requires permission). */
  browserNotifications?: boolean
}

export function useNotifications(
  commitments: Commitment[],
  options: UseNotificationsOptions = {},
) {
  const { browserNotifications = false } = options
  const [notifications, setNotifications] = useState<InAppNotification[]>([])
  const [toasts, setToasts] = useState<InAppNotification[]>([])
  const sentRef = useRef(new Set<string>())

  const addNotification = useCallback(
    (notif: Omit<InAppNotification, 'id' | 'timestamp' | 'read'>) => {
      const full: InAppNotification = {
        ...notif,
        id: `${notif.commitmentId}-${notif.type}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        read: false,
      }

      setNotifications((prev) => [full, ...prev].slice(0, 50))
      setToasts((prev) => [...prev, full])
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== full.id))
      }, 5000)

      if (
        browserNotifications &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        new Notification(`Clarity — ${notif.title}`, {
          body: notif.message,
          icon: '/favicon.svg',
        })
      }
    },
    [browserNotifications],
  )

  useEffect(() => {
    const check = () => {
      const now = new Date()
      commitments.forEach((c) => {
        if (c.status === 'completed') return

        let due: Date
        try {
          due = commitmentDueAt(c)
        } catch {
          return
        }
        const diffMin = (due.getTime() - now.getTime()) / 60000

        if (c.urgency === 'emergency' && !sentRef.current.has(`${c.id}-emergency`)) {
          sentRef.current.add(`${c.id}-emergency`)
          addNotification({
            commitmentId: c.id,
            title: '🚨 Emergency commitment',
            message: c.text,
            type: 'emergency',
          })
        }

        if (diffMin < 0 && !sentRef.current.has(`${c.id}-overdue`)) {
          sentRef.current.add(`${c.id}-overdue`)
          addNotification({
            commitmentId: c.id,
            title: 'Overdue',
            message: `"${c.text}" was due ${formatAgo(Math.abs(diffMin))} ago`,
            type: 'overdue',
          })
        } else if (diffMin > 0 && diffMin <= c.notifyBefore && !sentRef.current.has(`${c.id}-due`)) {
          sentRef.current.add(`${c.id}-due`)
          addNotification({
            commitmentId: c.id,
            title: diffMin <= 5 ? 'Due now' : `Due in ${Math.round(diffMin)} min`,
            message: c.text,
            type: 'due',
          })
        } else if (
          diffMin > c.notifyBefore &&
          diffMin <= c.notifyBefore + 30 &&
          !sentRef.current.has(`${c.id}-pending`)
        ) {
          sentRef.current.add(`${c.id}-pending`)
          addNotification({
            commitmentId: c.id,
            title: 'Upcoming commitment',
            message: `${c.text} — due ${formatTime(due)}`,
            type: 'pending',
          })
        }
      })
    }

    check()
    const interval = window.setInterval(check, 30_000)
    return () => window.clearInterval(interval)
  }, [commitments, addNotification])

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { notifications, toasts, markRead, markAllRead, dismissToast }
}

function formatAgo(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${Math.round(minutes / 60)}h`
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
