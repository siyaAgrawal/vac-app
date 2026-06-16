import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import {
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Sparkles,
  ListChecks,
  Trash2,
  Plus,
  X,
  Play,
  MessageCircle,
  ShieldCheck,
  LoaderCircle,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  CheckCheck,
} from 'lucide-react'
import type { Commitment, CommitmentStatus, FulfillmentCheck, Urgency } from '../types'
import {
  extractCommitmentsFromText,
  loadCommitments,
  reconcileStatuses,
  saveCommitments,
} from '../lib/commitments'
import { extractCommitmentsWithAI } from '../lib/extractAi'
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
  type NotificationPrefs,
} from '../lib/notificationPrefs'
import {
  notifyAfterMarkFulfilled,
  sendCompletedDigest,
  sendOverdueDigest,
  sendPendingDigest,
} from '../lib/commitmentNotifications'
import { useNotifications } from '../hooks/useNotifications'
import { checkApiHealth, loadWaContext } from '../lib/whatsappImport'
import { useChatContext } from '../context/ChatContext'

const AUTO_FP_KEY = 'clarity-auto-notif-fp-v1'

function readAutoFp(): { overdue: string; pending: string; completed: string } {
  try {
    return JSON.parse(
      sessionStorage.getItem(AUTO_FP_KEY) ||
        '{"overdue":"","pending":"","completed":""}',
    ) as { overdue: string; pending: string; completed: string }
  } catch {
    return { overdue: '', pending: '', completed: '' }
  }
}

function writeAutoFp(fp: { overdue: string; pending: string; completed: string }) {
  sessionStorage.setItem(AUTO_FP_KEY, JSON.stringify(fp))
}

function Toggle({
  on,
  onChange,
  disabled,
  id,
}: {
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  id: string
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        'relative h-7 w-12 shrink-0 rounded-full transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        on ? 'bg-foreground' : 'bg-[#d2d2d7]',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

const URGENCIES: Urgency[] = ['low', 'medium', 'high', 'emergency']

function getDueLabel(commitment: Commitment) {
  try {
    return format(new Date(`${commitment.dueDate}T${commitment.dueTime}:00`), 'EEE d MMM, h:mm a')
  } catch {
    return `${commitment.dueDate} ${commitment.dueTime}`
  }
}

function buildAssistantPrompts(chatLabel: string, topCommitment?: Commitment, overdueCount = 0) {
  const subject = topCommitment?.text ?? 'the open commitments in this chat'
  return [
    {
      label: 'Plan next steps',
      prompt: `Act like my personal assistant for ${chatLabel}. Review the uploaded chat and tell me the clearest next steps for ${subject}.`,
    },
    {
      label: 'Draft follow-up',
      prompt: `Act like my personal assistant for ${chatLabel}. Draft a warm, clear follow-up message that moves ${subject} forward.`,
    },
    {
      label: overdueCount > 0 ? 'Recover overdue items' : 'Spot hidden loose ends',
      prompt:
        overdueCount > 0
          ? `Act like my personal assistant for ${chatLabel}. I have ${overdueCount} overdue commitments. Help me prioritise them and write the best recovery message.`
          : `Act like my personal assistant for ${chatLabel}. Review the uploaded chat and tell me if there are any implied follow-ups or unspoken commitments I should handle.`,
    },
  ]
}

// ─── Fulfillment check panel ─────────────────────────────────────────────────

function FulfillmentPanel({
  commitment,
  onClose,
  onResult,
  activeChatContext,
}: {
  commitment: Commitment
  onClose: () => void
  onResult: (check: FulfillmentCheck) => void
  activeChatContext?: string
}) {
  const [evidence, setEvidence] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<FulfillmentCheck | null>(commitment.fulfillmentCheck ?? null)
  const [error, setError] = useState('')

  async function runCheck() {
    setLoading(true)
    setError('')
    try {
      const waContext = activeChatContext || loadWaContext()
      const res = await fetch('/api/check-fulfillment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commitment: commitment.text,
          evidence: evidence || undefined,
          waContext: waContext || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const data = (await res.json()) as {
        fulfilled: boolean
        confidence: number
        reasoning: string
        suggestion: string | null
      }
      const check: FulfillmentCheck = {
        checkedAt: new Date().toISOString(),
        fulfilled: data.fulfilled,
        confidence: data.confidence,
        reasoning: data.reasoning,
        suggestion: data.suggestion,
        evidence: evidence || undefined,
      }
      setResult(check)
      onResult(check)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed')
    } finally {
      setLoading(false)
    }
  }

  const confidencePct = result ? Math.round(result.confidence * 100) : 0

  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">AI Fulfillment Check</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!result && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">
              Evidence (optional) — paste any message, note, or proof of completion
            </label>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={3}
              placeholder="Paste relevant messages or notes here… or leave blank to check against your loaded WhatsApp chat"
              className="mt-1 w-full resize-none rounded-[7px] border border-border bg-white px-3 py-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
            />
          </div>
          {error && (
            <p className="text-xs text-red-500">
              {error}
              {error.includes('ANTHROPIC_API_KEY') && (
                <span className="ml-1 text-red-400">
                  — add ANTHROPIC_API_KEY to .env and restart
                </span>
              )}
            </p>
          )}
          <button
            type="button"
            onClick={runCheck}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-[7px] bg-foreground px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {loading ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Checking…
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5" />
                Check with AI
              </>
            )}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                result.fulfilled
                  ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                  : 'bg-red-100 text-red-600 ring-1 ring-red-200'
              }`}
            >
              {result.fulfilled ? 'Fulfilled' : 'Not fulfilled'}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between text-[10px] text-[#86868b]">
                <span>Confidence</span>
                <span>{confidencePct}%</span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[#d2d2d7]">
                <div
                  className={`h-full rounded-full transition-all ${
                    result.fulfilled ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{result.reasoning}</p>
          {result.suggestion && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              <span className="font-semibold">Next step: </span>
              {result.suggestion}
            </p>
          )}
          <p className="text-[10px] text-[#86868b]">
            Checked {new Date(result.checkedAt).toLocaleString()}
          </p>
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setEvidence('')
              setError('')
            }}
            className="text-xs text-[#86868b] hover:text-[#1d1d1f]"
          >
            Re-check
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function CommitmentsPage() {
  const { activeChat, importChat, refreshCommitments, chatCommitments } = useChatContext()
  const [items, setItems] = useState(() => reconcileStatuses(loadCommitments()))
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadNotificationPrefs)
  const [message, setMessage] = useState(
    "I'll send the revised proposal by Thursday EOD. Can you review the contract ASAP?",
  )
  const [feedback, setFeedback] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [waLoading, setWaLoading] = useState(false)
  const [scanAllLoading, setScanAllLoading] = useState(false)
  const [apiHealth, setApiHealth] = useState<Awaited<ReturnType<typeof checkApiHealth>>>(null)

  const [newText, setNewText] = useState('')
  const [newDueLocal, setNewDueLocal] = useState('')
  const [newUrgency, setNewUrgency] = useState<Urgency>('medium')
  const [newNotifyBefore, setNewNotifyBefore] = useState(60)
  const [newTags, setNewTags] = useState('')

  const itemsRef = useRef(items)
  const prefsRef = useRef(prefs)
  itemsRef.current = items
  prefsRef.current = prefs

  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  const notifReady = perm === 'granted'

  const { toasts, dismissToast } = useNotifications(items, {
    browserNotifications: notifReady && prefs.masterEnabled,
  })

  useEffect(() => {
    checkApiHealth().then(setApiHealth)
  }, [])

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    const p = loadNotificationPrefs()
    if (p.permissionPromptShown) return
    const next = { ...p, permissionPromptShown: true }
    saveNotificationPrefs(next)
    setPrefs(next)
  }, [])

  const hasApiKey = Boolean(import.meta.env.VITE_OPENAI_API_KEY?.trim())

  // Default to chat-only view when a chat is loaded
  const [showChatOnly, setShowChatOnly] = useState(() => Boolean(activeChat))

  // When activeChat changes (new import or switch), switch to chat view automatically
  useEffect(() => {
    if (activeChat) setShowChatOnly(true)
  }, [activeChat?.id])

  const displayItems = showChatOnly && activeChat ? chatCommitments : items

  const grouped = useMemo(() => {
    const active = displayItems.filter((c) => c.status === 'pending' || c.status === 'in-progress')
    const overdue = displayItems.filter((c) => c.status === 'overdue')
    const done = displayItems.filter((c) => c.status === 'completed')
    return { active, overdue, done }
  }, [displayItems])

  const assistantState = useMemo(() => {
    const open = displayItems.filter((c) => c.status !== 'completed')
    const overdue = open.filter((c) => c.status === 'overdue')
    const inProgress = open.filter((c) => c.status === 'in-progress')
    const topPriority = overdue[0] ?? open.find((c) => c.urgency === 'emergency')
      ?? open.find((c) => c.urgency === 'high')
      ?? inProgress[0]
      ?? open[0]

    const headline = activeChat
      ? `${activeChat.label}'s assistant view`
      : 'Your assistant view'

    const summary = topPriority
      ? overdue.length > 0
        ? `${overdue.length} overdue item${overdue.length === 1 ? '' : 's'} need attention first.`
        : `${open.length} active commitment${open.length === 1 ? '' : 's'} currently being tracked.`
      : activeChat
      ? `The imported chat is loaded and ready for extraction, follow-ups, and reply help.`
      : 'Add or import commitments to start building a personal follow-up system.'

    const nextStep = topPriority
      ? topPriority.status === 'overdue'
        ? `Follow up on "${topPriority.text}" first. It was due ${getDueLabel(topPriority)}.`
        : topPriority.status === 'in-progress'
        ? `Keep momentum on "${topPriority.text}" and send an update before ${getDueLabel(topPriority)}.`
        : `Your best next move is "${topPriority.text}" before ${getDueLabel(topPriority)}.`
      : activeChat
      ? `Ask the assistant to scan ${activeChat.label}'s chat for hidden obligations and a reply strategy.`
      : 'Import a chat or add a commitment manually to generate next-step guidance.'

    return {
      headline,
      summary,
      nextStep,
      topPriority,
      overdueCount: overdue.length,
      openCount: open.length,
      doneCount: displayItems.filter((c) => c.status === 'completed').length,
    }
  }, [activeChat, displayItems])

  const assistantPrompts = useMemo(
    () => (activeChat ? buildAssistantPrompts(activeChat.label, assistantState.topPriority, assistantState.overdueCount) : []),
    [activeChat, assistantState.overdueCount, assistantState.topPriority],
  )

  function persist(next: Commitment[]) {
    const r = reconcileStatuses(next)
    saveCommitments(r)
    setItems(r)
  }

  function patchPrefs(patch: Partial<NotificationPrefs>) {
    const next = { ...prefs, ...patch }
    saveNotificationPrefs(next)
    setPrefs(next)
  }

  function toggleComplete(c: Commitment) {
    const wasOpen = c.status !== 'completed'
    const next = items.map((x) => {
      if (x.id !== c.id) return x
      const status: CommitmentStatus = x.status === 'completed' ? 'pending' : 'completed'
      return { ...x, status }
    })
    const reconciled = reconcileStatuses(next)
    persist(next)
    if (wasOpen) {
      const updated = reconciled.find((x) => x.id === c.id)
      if (updated?.status === 'completed') {
        notifyAfterMarkFulfilled(updated, reconciled, prefs)
      }
    }
  }

  function setInProgress(c: Commitment, inProgress: boolean) {
    persist(
      items.map((x) =>
        x.id === c.id
          ? { ...x, status: inProgress ? ('in-progress' as const) : ('pending' as const) }
          : x,
      ),
    )
  }

  function removeCommitment(id: string) {
    persist(items.filter((x) => x.id !== id))
  }

  function saveFulfillmentCheck(id: string, check: FulfillmentCheck) {
    persist(items.map((x) => (x.id === id ? { ...x, fulfillmentCheck: check } : x)))
  }

  function addManual() {
    const text = newText.trim()
    if (!text) {
      setFeedback('Add a description first.')
      return
    }
    const now = new Date()
    let dueDate = format(now, 'yyyy-MM-dd')
    let dueTime = '17:00'
    let status: CommitmentStatus = 'pending'
    if (newDueLocal) {
      const d = parseISO(newDueLocal)
      if (!Number.isNaN(d.getTime())) {
        dueDate = format(d, 'yyyy-MM-dd')
        dueTime = format(d, 'HH:mm')
        if (d < now) status = 'overdue'
      }
    }
    const tags = newTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const row: Commitment = {
      id: crypto.randomUUID(),
      text,
      person: 'Unknown',
      action: text,
      urgency: newUrgency,
      status,
      dueDate,
      dueTime,
      source: 'Manual',
      createdAt: now.toISOString(),
      notifyBefore: Math.max(5, newNotifyBefore),
      notified: false,
      tags: tags.length ? tags : ['Clarity'],
    }
    persist([row, ...items])
    setNewText('')
    setNewDueLocal('')
    setNewUrgency('medium')
    setNewNotifyBefore(60)
    setNewTags('')
    setFeedback('Commitment added.')
  }

  async function runAiExtract() {
    setFeedback('')
    setAiLoading(true)
    try {
      const extracted = await extractCommitmentsWithAI(message)
      if (!extracted.length) {
        setFeedback('AI found no clear commitments in this text.')
      } else {
        persist([...extracted, ...items])
        setFeedback(`Added ${extracted.length} commitment(s) from AI.`)
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'AI extraction failed.')
    } finally {
      setAiLoading(false)
    }
  }

  async function runServerExtract() {
    if (!message.trim()) return
    setFeedback('')
    setAiLoading(true)
    try {
      const res = await fetch('/api/extract-commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Server error ${res.status}`)
      }
      const data = (await res.json()) as { commitments: Commitment[]; method: string }
      if (!data.commitments.length) {
        setFeedback('No commitments found.')
      } else {
        persist([...data.commitments, ...items])
        setFeedback(`Added ${data.commitments.length} item(s) via ${data.method}.`)
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Server extraction failed.')
    } finally {
      setAiLoading(false)
    }
  }

  async function runWhatsAppImport(file: File | null) {
    if (!file) {
      setFeedback('Choose a WhatsApp export .txt file.')
      return
    }
    setWaLoading(true)
    setFeedback('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/whatsapp-import', { method: 'POST', body: fd })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Import failed (${res.status})`)
      }
      const data = await res.json() as {
        commitments: Commitment[]
        messages: import('../lib/whatsappImport').WhatsAppMessage[]
        meta: { messageCount: number; usedOpenAI: boolean; usedClaude: boolean; method: string }
      }
      const msgs = data.messages ?? []
      const plainText = msgs.map((m) => `${m.author}: ${m.text}`).join('\n')
      const label = msgs[0]?.author ?? file.name.replace('.txt', '')
      // Import into multi-chat store + merge commitments
      importChat(label, msgs, plainText, data.commitments ?? [])
      refreshCommitments()
      // Also persist locally for the page's state
      const imported = data.commitments ?? []
      if (imported.length) {
        persist([...imported, ...items])
      }
      const methodLabel = data.meta.usedClaude ? 'Claude' : data.meta.usedOpenAI ? 'OpenAI' : 'rules'
      setFeedback(
        `Imported ${msgs.length} messages${imported.length ? `, ${imported.length} commitments` : ''} from "${label}" (${methodLabel}). Chat visible in Viewer & Chat pages.`,
      )
      // Request notification permission if not already granted
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission()
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'WhatsApp import failed.')
    } finally {
      setWaLoading(false)
    }
  }

  async function scanAllWhatsAppCommitments() {
    setScanAllLoading(true)
    setFeedback('')
    try {
      const res = await fetch('/api/whatsapp/commitments/all')
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error || `Scan failed (${res.status})`)
      }
      const data = await res.json() as { commitments: Commitment[]; totalChatsScanned: number }
      const incoming = data.commitments ?? []
      if (incoming.length) {
        persist([...incoming, ...items])
        refreshCommitments()
      }
      setFeedback(
        `Scanned ${data.totalChatsScanned} WhatsApp chats — found ${incoming.length} commitment${incoming.length !== 1 ? 's' : ''}.`,
      )
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'WhatsApp scan failed.')
    } finally {
      setScanAllLoading(false)
    }
  }

  function runRulesExtract() {
    setRulesLoading(true)
    setFeedback('')
    try {
      const extracted = extractCommitmentsFromText(message, 'Rules')
      persist([...extracted, ...items])
      setFeedback(
        extracted.length
          ? `Added ${extracted.length} item(s) via rules.`
          : 'No rule-based matches — try server AI or rephrase.',
      )
    } finally {
      setRulesLoading(false)
    }
  }

  function requestNotificationPermissionOnce() {
    if (!('Notification' in window)) {
      setFeedback('Notifications are not supported in this browser.')
      return
    }
    if (prefs.permissionPromptShown) {
      setFeedback('Permission was already requested. Change access in browser settings if needed.')
      return
    }
    Notification.requestPermission().then((p) => {
      patchPrefs({
        permissionPromptShown: true,
        masterEnabled: p === 'granted' ? true : false,
      })
      setFeedback(
        p === 'granted'
          ? 'Notifications enabled.'
          : 'Notifications blocked. Enable in site settings.',
      )
    })
  }

  function pingOverdue() {
    const err = sendOverdueDigest(items, prefs)
    setFeedback(err ?? 'Sent overdue digest.')
  }

  function pingPending() {
    const err = sendPendingDigest(items, prefs)
    setFeedback(err ?? 'Sent pending digest.')
  }

  function pingCompleted() {
    const err = sendCompletedDigest(items, prefs)
    setFeedback(err ?? 'Sent completed digest.')
  }

  useEffect(() => {
    if (!prefs.autoRemindEvery15Min || !prefs.masterEnabled) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

    const id = window.setInterval(() => {
      const p = prefsRef.current
      const list = reconcileStatuses(itemsRef.current)
      if (!p.autoRemindEvery15Min || !p.masterEnabled) return
      if (Notification.permission !== 'granted') return

      const overdue = list.filter((c) => c.status === 'overdue')
      const active = list.filter((c) => c.status === 'pending' || c.status === 'in-progress')
      const done = list.filter((c) => c.status === 'completed')

      const od = overdue.map((c) => c.id).sort().join(',')
      const pe = active.map((c) => c.id).sort().join(',')
      const co = done.map((c) => c.id).sort().join(',')

      const last = readAutoFp()
      const next = { ...last }

      if (p.notifyOverdue && od !== last.overdue && overdue.length) {
        sendOverdueDigest(list, p)
        next.overdue = od
      }
      if (p.notifyPending && pe !== last.pending && active.length) {
        sendPendingDigest(list, p)
        next.pending = pe
      }
      if (p.notifyCompleted && co !== last.completed && done.length) {
        sendCompletedDigest(list, p)
        next.completed = co
      }
      writeAutoFp(next)
    }, 15 * 60 * 1000)

    return () => window.clearInterval(id)
  }, [prefs.autoRemindEvery15Min, prefs.masterEnabled])

  const hasAnthropicServer = apiHealth?.anthropic
  const hasAnyAI = apiHealth?.openai || apiHealth?.anthropic

  // ── Test notifications handler ─────────────────────────────────────────────
  async function runTestNotifications() {
    if (typeof Notification === 'undefined') {
      setFeedback('Notifications are not supported in this browser.')
      return
    }
    let perm = Notification.permission
    if (perm === 'default') {
      perm = await Notification.requestPermission()
      patchPrefs({ permissionPromptShown: true, masterEnabled: perm === 'granted' })
    }
    if (perm !== 'granted') {
      setFeedback('Notifications blocked. Enable in browser site settings → Notifications.')
      return
    }
    try {
      new Notification('VAC — Test', { body: 'Notifications are working!', icon: '/favicon.ico', requireInteraction: false })
    } catch (e) {
      setFeedback('Notification failed: ' + String(e))
      return
    }
    const overdueFire = displayItems.filter((c) => c.status === 'overdue')
    overdueFire.slice(0, 3).forEach((c, i) => {
      setTimeout(() => {
        try {
          new Notification(`VAC — Overdue`, { body: c.text.slice(0, 100), icon: '/favicon.ico', requireInteraction: false })
        } catch {}
      }, 600 + i * 400)
    })
    const pendingFire = displayItems.filter((c) => c.status === 'pending' || c.status === 'in-progress')
    pendingFire.slice(0, 3).forEach((c, i) => {
      setTimeout(() => {
        try {
          new Notification(`VAC — Pending`, { body: c.text.slice(0, 100), icon: '/favicon.ico', requireInteraction: false })
        } catch {}
      }, 1800 + i * 1000)
    })
    setFeedback(`Test notifications fired${overdueFire.length ? ` · ${overdueFire.length} overdue` : ''}${pendingFire.length ? ` · ${pendingFire.length} pending` : ''}.`)
  }

  // ── Re-extract from active chat ────────────────────────────────────────────
  function reExtractFromChat() {
    if (!activeChat?.plainText) {
      setFeedback('No active chat loaded.')
      return
    }
    setRulesLoading(true)
    setFeedback('')
    try {
      const extracted = extractCommitmentsFromText(activeChat.plainText, 'WhatsApp')
      // Tag them to this chat
      const tagged = extracted.map((c) => ({
        ...c,
        tags: Array.from(new Set([...c.tags, `chat:${activeChat.id}`, activeChat.label.toLowerCase(), 'whatsapp'])),
        source: `${activeChat.label} (WhatsApp)`,
      }))
      const existing = reconcileStatuses(loadCommitments()).filter(
        (c) => !c.tags.includes(`chat:${activeChat.id}`),
      )
      const merged = [...tagged, ...existing]
      saveCommitments(merged)
      setItems(reconcileStatuses(merged))
      refreshCommitments()
      setFeedback(`Re-extracted ${extracted.length} commitment(s) from "${activeChat.label}" using rules.`)
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Re-extraction failed.')
    } finally {
      setRulesLoading(false)
    }
  }

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">

      {/* ── Toast overlay ──────────────────────────────────────────────── */}
      <div
        className="pointer-events-none fixed right-4 top-4 z-[100] flex max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="notif-enter pointer-events-auto rounded-2xl border border-border bg-background p-3 shadow-lg"
          >
            <div className="flex justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t.message}</p>
          </div>
        ))}
      </div>

      {/* ── Emergent-style header ─────────────────────────────────────────── */}
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Commitments.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Promises and follow-ups from your conversations. Focus first on the overdue,
          then what's due today.
        </p>
      </section>

      <div className="max-w-4xl space-y-6">
      {/* ── Actions bar ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex-1" />

        <div className="flex flex-wrap items-center gap-2">
          {/* Chat filter pill */}
          {activeChat && (
            <button
              type="button"
              onClick={() => setShowChatOnly((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-medium transition-colors ${
                showChatOnly
                  ? 'bg-foreground text-white'
                  : 'border border-border text-muted-foreground hover:bg-secondary'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {showChatOnly ? `Showing: ${activeChat.label}` : `Filter: ${activeChat.label}`}
            </button>
          )}

          {/* Notify all button */}
          <button
            type="button"
            onClick={runTestNotifications}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
            title="Test notifications"
          >
            <Bell className="h-3.5 w-3.5" />
            Test notifications
          </button>

          {/* Re-extract button when chat is loaded */}
          {activeChat && (
            <button
              type="button"
              onClick={reExtractFromChat}
              disabled={rulesLoading}
              className="inline-flex items-center gap-1.5 rounded-[7px] bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-[#333333] disabled:opacity-40 transition-colors"
            >
              <ListChecks className="h-3.5 w-3.5" />
              {rulesLoading ? 'Extracting…' : 'Re-extract from chat'}
            </button>
          )}
        </div>
      </header>

      {/* ── Active chat banner ────────────────────────────────────────────── */}
      {activeChat && showChatOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-border bg-secondary px-4 py-3">
          <div className="flex items-center gap-2.5">
            <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Showing commitments from <span className="font-semibold">{activeChat.label}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {chatCommitments.length} commitment{chatCommitments.length !== 1 ? 's' : ''} found in this chat
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-white px-2.5 py-1 text-xs text-muted-foreground">
              {chatCommitments.filter((c) => c.status === 'overdue').length} overdue
            </span>
            <span className="rounded-full border border-border bg-white px-2.5 py-1 text-xs text-muted-foreground">
              {chatCommitments.filter((c) => c.status === 'pending' || c.status === 'in-progress').length} pending
            </span>
          </div>
        </div>
      )}

      {/* ── Summary stats (when no chat filter) ──────────────────────────── */}
      {(!showChatOnly || !activeChat) && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-[12px] border border-border bg-white px-4 py-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Open</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{assistantState.openCount}</p>
          </div>
          <div className="rounded-[12px] border border-[#fecaca] bg-[#fff5f5] px-4 py-3">
            <p className="text-xs text-[#dc2626] uppercase tracking-wide">Overdue</p>
            <p className="mt-1 text-2xl font-semibold text-[#dc2626]">{assistantState.overdueCount}</p>
          </div>
          <div className="rounded-[12px] border border-border bg-white px-4 py-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Done</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{assistantState.doneCount}</p>
          </div>
        </div>
      )}

      {/* ── Top priority card ─────────────────────────────────────────────── */}
      {assistantState.topPriority && (
        <div className="rounded-[12px] border border-border bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Top priority</p>
          <p className="mt-2 text-base font-semibold text-foreground">{assistantState.topPriority.text}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Due {getDueLabel(assistantState.topPriority)}
            {assistantState.topPriority.source && ` · ${assistantState.topPriority.source}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { if (assistantState.topPriority) toggleComplete(assistantState.topPriority) }}
              className="inline-flex items-center gap-2 rounded-[7px] bg-foreground px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#333333] transition-colors"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark handled
            </button>
            {assistantPrompts.length > 0 && assistantPrompts.map((item) => (
              <Link
                key={item.label}
                to={`/chat?prompt=${encodeURIComponent(item.prompt)}`}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors"
              >
                {item.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Import section ────────────────────────────────────────────────── */}
      <section className="rounded-[12px] border border-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Import WhatsApp export</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {apiHealth?.ok
                ? `API connected · ${apiHealth.anthropic ? 'Claude AI' : apiHealth.ollama ? 'Ollama AI' : apiHealth.openai ? 'OpenAI' : 'rules only'}`
                : 'API not reachable — run npm run dev'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(waLoading || scanAllLoading) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                {scanAllLoading ? 'Scanning…' : 'Importing…'}
              </span>
            )}
            <button
              type="button"
              onClick={() => void scanAllWhatsAppCommitments()}
              disabled={scanAllLoading || waLoading}
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-white px-3 py-2 text-xs font-medium text-foreground hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              title="Scan all connected WhatsApp chats for your commitments"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Scan all WhatsApp chats
            </button>
            <label className="cursor-pointer rounded-[7px] bg-foreground px-4 py-2 text-xs font-medium text-white hover:bg-[#333333] transition-colors">
              <input
                type="file"
                accept=".txt,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  e.target.value = ''
                  void runWhatsAppImport(f)
                }}
              />
              Choose .txt file
            </label>
          </div>
        </div>
      </section>

      {/* ── Feedback banner ───────────────────────────────────────────────── */}
      {feedback && (
        <p className="rounded-[7px] border border-border bg-secondary px-4 py-3 text-sm text-foreground">
          {feedback}
        </p>
      )}

      {/* ── Three-column commitment grid ──────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CommitColumn
          title="Overdue"
          icon={<AlertTriangle className="h-4 w-4 text-[#dc2626]" />}
          empty="Nothing overdue."
          commitments={grouped.overdue}
          onToggle={toggleComplete}
          onInProgress={setInProgress}
          onDelete={removeCommitment}
          onSaveFulfillment={saveFulfillmentCheck}
          hasAnthropicServer={Boolean(hasAnthropicServer)}
          activeChatContext={activeChat?.plainText}
        />
        <CommitColumn
          title="Active"
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          empty="No active items."
          commitments={grouped.active}
          onToggle={toggleComplete}
          onInProgress={setInProgress}
          onDelete={removeCommitment}
          onSaveFulfillment={saveFulfillmentCheck}
          hasAnthropicServer={Boolean(hasAnthropicServer)}
          activeChatContext={activeChat?.plainText}
        />
        <CommitColumn
          title="Completed"
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          empty="No completed yet."
          commitments={grouped.done}
          onToggle={toggleComplete}
          onInProgress={setInProgress}
          onDelete={removeCommitment}
          onSaveFulfillment={saveFulfillmentCheck}
          hasAnthropicServer={Boolean(hasAnthropicServer)}
          activeChatContext={activeChat?.plainText}
        />
      </div>

      {/* ── Add commitment ────────────────────────────────────────────────── */}
      <section className="rounded-[12px] border border-border bg-white p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Add commitment manually</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              className="mt-1 w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
              placeholder="What you need to do"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Urgency</label>
            <select
              value={newUrgency}
              onChange={(e) => setNewUrgency(e.target.value as Urgency)}
              className="mt-1 w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
            >
              {URGENCIES.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Due (optional)</label>
            <input
              type="datetime-local"
              value={newDueLocal}
              onChange={(e) => setNewDueLocal(e.target.value)}
              className="mt-1 w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Remind before (min)</label>
            <input
              type="number"
              min={5}
              value={newNotifyBefore}
              onChange={(e) => setNewNotifyBefore(Number(e.target.value) || 60)}
              className="mt-1 w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              className="mt-1 w-full rounded-[7px] border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
              placeholder="email, client"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={addManual}
          className="mt-4 rounded-[7px] bg-foreground px-5 py-2 text-sm font-semibold text-white hover:bg-[#333333] transition-colors"
        >
          Add commitment
        </button>
      </section>

      {/* ── Extract from message ──────────────────────────────────────────── */}
      <section className="rounded-[12px] border border-border bg-white p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Extract from text</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasAnthropicServer
            ? 'Claude ready — AI extracts implicit deadlines and obligations.'
            : hasAnyAI
            ? 'AI ready — extraction enabled.'
            : 'No AI key — rule-based extraction active.'}
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-[7px] border border-border bg-secondary px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-[#000000]/10"
          placeholder="Paste any message, email, or chat…"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={runServerExtract}
            disabled={aiLoading || !message.trim()}
            className="inline-flex items-center gap-2 rounded-[7px] bg-foreground px-4 py-2 text-xs font-semibold text-white hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {aiLoading ? 'Extracting…' : 'Extract with AI'}
          </button>
          <button
            type="button"
            onClick={runRulesExtract}
            disabled={rulesLoading || !message.trim()}
            className="inline-flex items-center gap-2 rounded-[7px] border border-border bg-white px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            <ListChecks className="h-3.5 w-3.5" />
            {rulesLoading ? 'Scanning…' : 'Extract with rules'}
          </button>
          {hasApiKey && (
            <button
              type="button"
              onClick={runAiExtract}
              disabled={aiLoading || !message.trim()}
              className="inline-flex items-center gap-2 rounded-[7px] border border-border bg-white px-4 py-2 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              OpenAI (client)
            </button>
          )}
        </div>
      </section>

      {/* ── Notification settings (collapsible) ──────────────────────────── */}
      <NotificationSettings
        prefs={prefs}
        notifReady={notifReady}
        perm={perm}
        onPatchPrefs={patchPrefs}
        onRequestPermission={requestNotificationPermissionOnce}
        onPingOverdue={pingOverdue}
        onPingPending={pingPending}
        onPingCompleted={pingCompleted}
      />

      </div>{/* end max-w-4xl */}
    </div>
  )
}

function NotifRow({
  label,
  description,
  toggleOn,
  onToggle,
  onSend,
  sendDisabled,
}: {
  label: string
  description: string
  toggleOn: boolean
  onToggle: (v: boolean) => void
  onSend: () => void
  sendDisabled: boolean
}) {
  const id = `notif-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <li className="flex flex-col gap-3 rounded-[7px] border border-border bg-secondary p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Enabled</span>
          <Toggle id={id} on={toggleOn} onChange={onToggle} />
        </div>
        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className="rounded-[7px] border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35 transition-colors"
        >
          Send now
        </button>
      </div>
    </li>
  )
}

// ── Collapsible Notification Settings ────────────────────────────────────────

function NotificationSettings({
  prefs,
  notifReady,
  perm,
  onPatchPrefs,
  onRequestPermission,
  onPingOverdue,
  onPingPending,
  onPingCompleted,
}: {
  prefs: NotificationPrefs
  notifReady: boolean
  perm: string
  onPatchPrefs: (p: Partial<NotificationPrefs>) => void
  onRequestPermission: () => void
  onPingOverdue: () => void
  onPingPending: () => void
  onPingCompleted: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="rounded-[12px] border border-border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          {prefs.masterEnabled && notifReady
            ? <Bell className="h-4 w-4 text-muted-foreground" />
            : <BellOff className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-semibold text-foreground">Notification settings</span>
          {notifReady && prefs.masterEnabled && (
            <span className="rounded-full bg-secondary border border-border px-2 py-0.5 text-xs text-muted-foreground">on</span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-foreground">
                {perm === 'granted'
                  ? 'Browser notifications are allowed.'
                  : perm === 'default' && !prefs.permissionPromptShown
                  ? 'Enable browser notifications to get alerts.'
                  : 'Enable notifications in your browser site settings.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {perm === 'default' && !prefs.permissionPromptShown && (
                <button
                  type="button"
                  onClick={onRequestPermission}
                  className="rounded-[7px] bg-foreground px-4 py-2 text-xs font-semibold text-white hover:bg-[#333333] transition-colors"
                >
                  Enable notifications
                </button>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Master switch</span>
                <Toggle
                  id="master-notif"
                  on={prefs.masterEnabled}
                  onChange={(v) => onPatchPrefs({ masterEnabled: v })}
                />
              </div>
            </div>
          </div>

          <ul className="space-y-2">
            <NotifRow
              label="Overdue"
              description="Digest when overdue items exist."
              toggleOn={prefs.notifyOverdue}
              onToggle={(v) => onPatchPrefs({ notifyOverdue: v })}
              onSend={onPingOverdue}
              sendDisabled={!notifReady || !prefs.masterEnabled || !prefs.notifyOverdue}
            />
            <NotifRow
              label="Pending / active"
              description="Digest for pending & in-progress items."
              toggleOn={prefs.notifyPending}
              onToggle={(v) => onPatchPrefs({ notifyPending: v })}
              onSend={onPingPending}
              sendDisabled={!notifReady || !prefs.masterEnabled || !prefs.notifyPending}
            />
            <NotifRow
              label="Completed"
              description="Ping when you mark an item fulfilled."
              toggleOn={prefs.notifyCompleted}
              onToggle={(v) => onPatchPrefs({ notifyCompleted: v })}
              onSend={onPingCompleted}
              sendDisabled={!notifReady || !prefs.masterEnabled || !prefs.notifyCompleted}
            />
          </ul>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Toggle
              id="auto-remind"
              on={prefs.autoRemindEvery15Min}
              onChange={(v) => onPatchPrefs({ autoRemindEvery15Min: v })}
              disabled={!notifReady || !prefs.masterEnabled}
            />
            <label htmlFor="auto-remind" className="text-sm text-muted-foreground">
              Auto-check every 15 min (while tab is open)
            </label>
          </div>
        </div>
      )}
    </section>
  )
}

function CommitColumn({
  title,
  icon,
  empty,
  commitments,
  onToggle,
  onInProgress,
  onDelete,
  onSaveFulfillment,
  hasAnthropicServer,
  activeChatContext,
}: {
  title: string
  icon: ReactNode
  empty: string
  commitments: Commitment[]
  onToggle: (c: Commitment) => void
  onInProgress: (c: Commitment, v: boolean) => void
  onDelete: (id: string) => void
  onSaveFulfillment: (id: string, check: FulfillmentCheck) => void
  hasAnthropicServer: boolean
  activeChatContext?: string
}) {
  return (
    <div className="flex max-h-[min(75vh,44rem)] flex-col rounded-[12px] border border-border bg-white p-4">
      {/* Column header */}
      <div className="flex shrink-0 items-center gap-2 pb-3 border-b border-border">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-auto rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {commitments.length}
        </span>
      </div>
      <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {commitments.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted-foreground">{empty}</li>
        ) : (
          commitments.map((c) => (
            <CommitCard
              key={c.id}
              commitment={c}
              onToggle={onToggle}
              onInProgress={onInProgress}
              onDelete={onDelete}
              onSaveFulfillment={onSaveFulfillment}
              hasAnthropicServer={hasAnthropicServer}
              activeChatContext={activeChatContext}
            />
          ))
        )}
      </ul>
    </div>
  )
}

function CommitCard({
  commitment: c,
  onToggle,
  onInProgress,
  onDelete,
  onSaveFulfillment,
  hasAnthropicServer,
  activeChatContext,
}: {
  commitment: Commitment
  onToggle: (c: Commitment) => void
  onInProgress: (c: Commitment, v: boolean) => void
  onDelete: (id: string) => void
  onSaveFulfillment: (id: string, check: FulfillmentCheck) => void
  hasAnthropicServer: boolean
  activeChatContext?: string
}) {
  const [showFulfillPanel, setShowFulfillPanel] = useState(false)

  const hasPrevCheck = Boolean(c.fulfillmentCheck)
  const prevFulfilled = c.fulfillmentCheck?.fulfilled

  // Use the dedicated person field; fall back to legacy source-string parsing
  const author =
    c.person && c.person !== 'Unknown'
      ? c.person
      : (() => {
          const m = c.source.match(/^(?:WhatsApp|Claude|OpenAI)\s*[–-]\s*(.+)$/)
          return m ? m[1].trim() : null
        })()

  const urgencyStyles: Record<string, string> = {
    emergency: 'bg-red-50 text-[#dc2626] border-red-100',
    high: 'bg-orange-50 text-orange-700 border-orange-100',
    medium: 'bg-secondary text-muted-foreground border-border',
    low: 'bg-secondary text-muted-foreground border-border',
  }

  return (
    <li className="rounded-[10px] border border-border bg-background p-3 text-sm">
      {/* Text + delete */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-foreground leading-snug">{c.text}</p>
        <button
          type="button"
          onClick={() => onDelete(c.id)}
          className="shrink-0 rounded-[6px] p-1 text-muted-foreground hover:bg-secondary hover:text-[#dc2626] transition-colors"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Due + author */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <p className="text-xs text-muted-foreground">
          {getDueLabel(c)}
        </p>
        {author && (
          <span className="text-xs text-muted-foreground">· {author}</span>
        )}
      </div>

      {/* Badges */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-[5px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${urgencyStyles[c.urgency] ?? urgencyStyles.medium}`}>
          {c.urgency}
        </span>
        {c.status === 'in-progress' && (
          <span className="rounded-[5px] border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            In progress
          </span>
        )}
        {hasPrevCheck && (
          <span className={`text-[10px] font-medium ${prevFulfilled ? 'text-emerald-600' : 'text-[#dc2626]'}`}>
            AI: {prevFulfilled ? 'fulfilled' : 'not done'}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {c.status !== 'completed' && (
          <>
            {c.status === 'pending' && (
              <button
                type="button"
                onClick={() => onInProgress(c, true)}
                className="inline-flex items-center gap-1 rounded-[6px] border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                <Play className="h-3 w-3" />
                Start
              </button>
            )}
            {c.status === 'in-progress' && (
              <button
                type="button"
                onClick={() => onInProgress(c, false)}
                className="rounded-[6px] border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
              >
                Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggle(c)}
              className="ml-auto inline-flex items-center gap-1 rounded-[6px] bg-foreground px-2.5 py-1 text-xs font-medium text-white hover:bg-[#333333] transition-colors"
            >
              <CheckCheck className="h-3 w-3" />
              Done
            </button>
          </>
        )}
        {c.status === 'completed' && (
          <button
            type="button"
            onClick={() => onToggle(c)}
            className="rounded-[6px] border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
          >
            Reopen
          </button>
        )}
        {hasAnthropicServer && (
          <button
            type="button"
            onClick={() => setShowFulfillPanel((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-xs transition-colors ${
              showFulfillPanel
                ? 'border-[#000000]/20 bg-secondary text-foreground'
                : 'border-border text-muted-foreground hover:bg-secondary'
            }`}
            title="Check if this commitment was fulfilled using AI"
          >
            <ShieldCheck className="h-3 w-3" />
            {showFulfillPanel ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>

      {showFulfillPanel && (
        <FulfillmentPanel
          commitment={c}
          onClose={() => setShowFulfillPanel(false)}
          onResult={(check) => onSaveFulfillment(c.id, check)}
          activeChatContext={activeChatContext}
        />
      )}
    </li>
  )
}
