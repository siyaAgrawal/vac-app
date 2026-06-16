/**
 * VAC Test Run Mode — Control Room
 *
 * Real-time mission-control interface for the parallel auto-reply test loop.
 * Displays:
 *  - START / STOP toggle with live status badge
 *  - Session stats (scans, sent, skipped, errors)
 *  - Terminal-style live activity log (auto-scroll)
 *  - Sent replies panel with inline feedback (👍/—/👎)
 *  - Explanation panels ("why this reply?")
 *  - Collapsible configuration panel
 */

import { useEffect, useRef, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestRunStatus {
  running:       boolean
  startedAt:     number | null
  stoppedAt:     number | null
  scanCount:     number
  totalSent:     number
  totalSkipped:  number
  totalErrors:   number
  currentChatId: string | null
  options:       TestRunOptions
}

interface TestRunOptions {
  minPendingAgeMs:   number
  perChatCooldownMs: number
  scanIntervalMs:    number
  maxRepliesPerScan: number
  skipGroups:        boolean
  analysisTimeoutMs: number
}

interface LogEntry {
  ts:         number
  type:       string
  message:    string
  chatId?:    string
  senderName?: string
  replyId?:   string
  reply?:     string
  incomingMsg?: string
  confidence?: number
  urgency?:   string
  scanNum?:   number
  pendingCount?: number
  totalChats?:  number
  sentThisScan?: number
  totalSent?:   number
}

interface SentReply {
  replyId:       string
  chatId:        string
  senderName:    string
  incomingMsg:   string
  generatedReply: string
  sentAt:        number
  confidence:    number
  urgencyLevel:  string
  emotion:       string
  explanation?: {
    summary?:          string
    intent?:           string
    context_used?:     string
    style_notes?:      string[]
    recipient_style_read?: string
    confidenceScore?:  number
  }
  feedback: 'good' | 'neutral' | 'bad' | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts: number) {
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  return `${Math.floor(d / 3_600_000)}h ago`
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

const LOG_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  started:       { bg: '#dbeafe', text: '#1e40af', dot: '#3b82f6' },
  stopped:       { bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
  scan_info:     { bg: '#f0f9ff', text: '#0369a1', dot: '#38bdf8' },
  scan_start:    { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  scan_complete: { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  zero_pending:  { bg: '#fff7ed', text: '#92400e', dot: '#f59e0b' },
  processing:    { bg: '#fefce8', text: '#a16207', dot: '#eab308' },
  sent:          { bg: '#f0fdf4', text: '#166534', dot: '#16a34a' },
  skipped:       { bg: '#f9fafb', text: '#9ca3af', dot: '#d1d5db' },
  error:         { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' },
  waiting:       { bg: '#f9fafb', text: '#6b7280', dot: '#d1d5db' },
  cap:           { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  queue_error:   { bg: '#fef2f2', text: '#b91c1c', dot: '#ef4444' },
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color = 'hsl(var(--foreground))' }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 100, padding: '14px 18px',
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
    </div>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  const style = LOG_COLORS[entry.type] || LOG_COLORS.skipped
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      padding: '5px 12px',
      background: style.bg,
      borderLeft: `3px solid ${style.dot}`,
      marginBottom: 2,
      borderRadius: '0 6px 6px 0',
    }}>
      <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap', paddingTop: 2, fontFamily: 'monospace' }}>
        {new Date(entry.ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span style={{ fontSize: 12, color: style.text, lineHeight: '1.5', wordBreak: 'break-word' }}>
        {entry.message}
      </span>
    </div>
  )
}

function ReplyCard({
  reply,
  onRate,
}: {
  reply: SentReply
  onRate: (replyId: string, chatId: string, rating: 'good' | 'neutral' | 'bad') => void
}) {
  const [expl, setExpl] = useState(false)

  const urgencyColor: Record<string, string> = {
    low: '#22c55e', medium: '#f97316', high: '#ef4444', critical: '#7f1d1d',
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: '14px 16px', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>
            {reply.senderName}
          </span>
          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8 }}>
            {relTime(reply.sentAt)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {reply.urgencyLevel && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 20,
              background: urgencyColor[reply.urgencyLevel] ?? '#6b7280',
              color: 'hsl(var(--background))', fontWeight: 600,
            }}>
              {reply.urgencyLevel}
            </span>
          )}
          {reply.confidence != null && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 20,
              background: '#f3f4f6', color: '#6b7280', fontWeight: 600,
            }}>
              {Math.round(reply.confidence * 100)}%
            </span>
          )}
          {reply.emotion && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 20,
              background: '#ede9fe', color: '#6d28d9', fontWeight: 600,
            }}>
              {reply.emotion}
            </span>
          )}
        </div>
      </div>

      {/* Incoming message */}
      <div style={{
        padding: '8px 12px', background: '#f3f4f6', borderRadius: '10px 10px 10px 2px',
        marginBottom: 6, fontSize: 13, color: '#374151', lineHeight: '1.5',
      }}>
        {reply.incomingMsg}
      </div>

      {/* Generated reply */}
      <div style={{
        padding: '8px 12px', background: 'hsl(var(--foreground))', borderRadius: '10px 10px 2px 10px',
        marginBottom: 10, fontSize: 13, color: 'hsl(var(--background))', lineHeight: '1.5',
      }}>
        {reply.generatedReply}
      </div>

      {/* Actions row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {/* Feedback */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['good', 'neutral', 'bad'] as const).map((r) => (
            <button
              key={r}
              onClick={() => onRate(reply.replyId, reply.chatId, r)}
              title={r}
              style={{
                border: '1px solid',
                borderColor: reply.feedback === r
                  ? (r === 'good' ? '#22c55e' : r === 'bad' ? '#ef4444' : '#f97316')
                  : '#e5e7eb',
                background: reply.feedback === r
                  ? (r === 'good' ? '#dcfce7' : r === 'bad' ? '#fee2e2' : '#fff7ed')
                  : '#fff',
                borderRadius: 7, padding: '3px 8px', fontSize: 14,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {r === 'good' ? '👍' : r === 'bad' ? '👎' : '—'}
            </button>
          ))}
        </div>

        {/* Why this? */}
        {reply.explanation?.summary && (
          <button
            onClick={() => setExpl((x) => !x)}
            style={{
              fontSize: 11, color: '#6b7280', background: 'none',
              border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            {expl ? '▲ hide' : '▼ why this?'}
          </button>
        )}
      </div>

      {/* Explanation panel */}
      {expl && reply.explanation && (
        <div style={{
          marginTop: 10, padding: '10px 12px', background: '#f9fafb',
          border: '1px solid #e5e7eb', borderRadius: 8,
          fontSize: 11, color: '#6b7280', lineHeight: '1.6',
        }}>
          {reply.explanation.summary && (
            <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#111827', fontSize: 12 }}>
              {reply.explanation.summary}
            </p>
          )}
          {reply.explanation.intent && (
            <p style={{ margin: '0 0 3px' }}>
              Intent: <strong style={{ color: '#374151' }}>{reply.explanation.intent}</strong>
            </p>
          )}
          {reply.explanation.context_used && (
            <p style={{ margin: '0 0 3px' }}>
              Context: {reply.explanation.context_used}
            </p>
          )}
          {reply.explanation.style_notes && reply.explanation.style_notes.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {reply.explanation.style_notes.map((n, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: '2px 8px',
                  background: '#dbeafe', borderRadius: 12, color: '#1d4ed8',
                }}>
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfigPanel({
  opts,
  onChange,
}: {
  opts: Partial<TestRunOptions>
  onChange: (patch: Partial<TestRunOptions>) => void
}) {
  const row = (label: string, sublabel: string, key: keyof TestRunOptions, divisor: number, unit: string) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#111827', display: 'block', marginBottom: 2 }}>
        {label}
      </label>
      <p style={{ margin: '0 0 6px', fontSize: 11, color: '#9ca3af' }}>{sublabel}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={divisor}
          max={divisor * 30}
          step={divisor}
          value={(opts[key] as number) ?? divisor * 5}
          onChange={(e) => onChange({ [key]: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', minWidth: 50, textAlign: 'right' }}>
          {Math.round(((opts[key] as number) ?? divisor * 5) / divisor)}{unit}
        </span>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Skip groups toggle */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          onClick={() => onChange({ skipGroups: !opts.skipGroups })}
          style={{
            width: 40, height: 22, borderRadius: 11, position: 'relative', cursor: 'pointer',
            background: opts.skipGroups ? 'hsl(var(--foreground))' : '#d1d5db', transition: 'background 0.2s', flexShrink: 0,
          }}
        >
          <div style={{
            position: 'absolute', top: 3, left: opts.skipGroups ? 21 : 3,
            width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
          }} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>Skip group chats</p>
          <p style={{ margin: 0, fontSize: 11, color: '#9ca3af' }}>
            Recommended ON — prevents auto-replies to school/work groups. Turn off only for testing.
          </p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
        {row('Pending age threshold', 'Messages younger than this are handled by the main system, not Test Run', 'minPendingAgeMs', 60_000, 'min')}
        {row('Scan interval', 'How often Test Run re-scans all chats for new pending replies', 'scanIntervalMs', 60_000, 'min')}
        {row('Per-chat cooldown', 'Minimum time between two Test Run replies to the same contact', 'perChatCooldownMs', 60_000, 'min')}
        {row('Max replies per scan', 'Safety cap — limits how many replies can be sent in a single scan cycle', 'maxRepliesPerScan', 1, ' msg')}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TestRunPage() {
  const [status,   setStatus]   = useState<TestRunStatus | null>(null)
  const [logs,     setLogs]     = useState<LogEntry[]>([])
  const [replies,  setReplies]  = useState<SentReply[]>([])
  const [configOpen, setConfigOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [elapsed,  setElapsed]  = useState(0)
  const [opts, setOpts] = useState<TestRunOptions>({
    minPendingAgeMs:   60_000,
    perChatCooldownMs: 300_000,
    scanIntervalMs:    60_000,
    maxRepliesPerScan: 20,
    skipGroups:        true,
    analysisTimeoutMs: 35_000,
  })

  const logRef = useRef<HTMLDivElement>(null)

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/whatsapp/test-run/status').then((r) => r.json()),
      fetch('/api/whatsapp/test-run/logs?limit=200').then((r) => r.json()),
      fetch('/api/whatsapp/test-run/replies?limit=100').then((r) => r.json()),
    ]).then(([s, l, r]) => {
      setStatus(s)
      if (s.options?.minPendingAgeMs) setOpts(s.options)
      setLogs(Array.isArray(l) ? l : [])
      setReplies(Array.isArray(r) ? r : [])
    }).catch(() => {})
  }, [])

  // ── Elapsed timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!status?.running || !status.startedAt) return
    const tick = () => setElapsed(Date.now() - (status.startedAt ?? 0))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [status?.running, status?.startedAt])

  // ── SSE stream ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/whatsapp/events')

    const patch = (data: Partial<TestRunStatus>) =>
      setStatus((prev) => prev ? { ...prev, ...data } : (data as TestRunStatus))

    es.addEventListener('testrun_started', (e) => {
      const d = JSON.parse(e.data)
      patch({ running: true, startedAt: d.startedAt, options: d.options,
              scanCount: 0, totalSent: 0, totalSkipped: 0, totalErrors: 0 })
    })

    es.addEventListener('testrun_stopped', (e) => {
      const d = JSON.parse(e.data)
      patch({ running: false, stoppedAt: d.stoppedAt,
              scanCount: d.scanCount, totalSent: d.totalSent,
              totalSkipped: d.totalSkipped, totalErrors: d.totalErrors })
    })

    es.addEventListener('testrun_scan_start', (e) => {
      const d = JSON.parse(e.data)
      patch({ scanCount: d.scanNum, currentChatId: null })
    })

    es.addEventListener('testrun_scan_complete', (e) => {
      const d = JSON.parse(e.data)
      patch({ totalSent: d.totalSent, totalSkipped: d.totalSkipped, totalErrors: d.totalErrors })
    })

    es.addEventListener('testrun_processing', (e) => {
      const d = JSON.parse(e.data)
      patch({ currentChatId: d.chatId })
    })

    es.addEventListener('testrun_sent', (e) => {
      const d = JSON.parse(e.data)
      setStatus((prev) => prev ? { ...prev, totalSent: (prev.totalSent ?? 0) + 1 } : prev)
      const newReply: SentReply = {
        replyId:       d.replyId,
        chatId:        d.chatId,
        senderName:    d.senderName,
        incomingMsg:   d.incomingMsg,
        generatedReply: d.reply,
        sentAt:        Date.now(),
        confidence:    d.confidence,
        urgencyLevel:  d.urgencyLevel,
        emotion:       d.emotion,
        explanation:   d.explanation,
        feedback:      null,
      }
      setReplies((prev) => [newReply, ...prev.slice(0, 499)])
    })

    es.addEventListener('testrun_log', (e) => {
      const d = JSON.parse(e.data)
      setLogs((prev) => [...prev.slice(-999), d])
    })

    return () => es.close()
  }, [])

  // ── Auto-scroll log ───────────────────────────────────────────────────────────
  const lastLogTs = logs[logs.length - 1]?.ts
  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [lastLogTs])

  // ── Actions ───────────────────────────────────────────────────────────────────
  const startRun = useCallback(async () => {
    setStarting(true)
    try {
      await fetch('/api/whatsapp/test-run/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
    } finally {
      setStarting(false)
    }
  }, [opts])

  const stopRun = useCallback(async () => {
    setStopping(true)
    try {
      await fetch('/api/whatsapp/test-run/stop', { method: 'POST' })
    } finally {
      setStopping(false)
    }
  }, [])

  const rateReply = useCallback(async (replyId: string, chatId: string, rating: 'good' | 'neutral' | 'bad') => {
    // Optimistic
    setReplies((prev) => prev.map((r) => r.replyId === replyId ? { ...r, feedback: rating } : r))
    try {
      await fetch('/api/whatsapp/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyId, chatId, rating }),
      })
    } catch {
      setReplies((prev) => prev.map((r) => r.replyId === replyId ? { ...r, feedback: null } : r))
    }
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────────
  const isRunning = status?.running ?? false
  const goodRate  = replies.filter((r) => r.feedback === 'good').length
  const badRate   = replies.filter((r) => r.feedback === 'bad').length

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Test Run.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Simulate the auto-reply engine against your imported conversations without sending real messages.
        </p>
      </section>
      <div className="max-w-5xl">

      {/* ── Controls header ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, marginBottom: 28,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Test Run Mode
            </h3>
            {/* Status badge */}
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
              background: isRunning ? '#dcfce7' : '#f3f4f6',
              color:      isRunning ? '#166534' : '#6b7280',
              border:     `1px solid ${isRunning ? '#86efac' : '#e5e7eb'}`,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: isRunning ? '#22c55e' : '#9ca3af',
                display: 'inline-block',
                animation: isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
              }} />
              {isRunning
                ? `Running · ${fmtDuration(elapsed)}`
                : status?.stoppedAt ? 'Stopped' : 'Idle'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            Scans all pending conversations and auto-replies using your full AI stack
          </p>
        </div>

        {/* START / STOP */}
        <div style={{ display: 'flex', gap: 8 }}>
          {!isRunning ? (
            <button
              onClick={startRun}
              disabled={starting}
              style={{
                padding: '11px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: starting ? '#6b7280' : 'linear-gradient(135deg, #09f 0%, #0077ff 100%)',
                color: 'hsl(var(--background))', fontWeight: 700, fontSize: 14,
                boxShadow: '0 8px 24px rgba(0,119,255,0.28)',
                transition: 'all 0.2s',
              }}
            >
              {starting ? 'Starting…' : '▶ Start Test Run'}
            </button>
          ) : (
            <button
              onClick={stopRun}
              disabled={stopping}
              style={{
                padding: '11px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
                background: stopping ? '#6b7280' : '#ef4444',
                color: 'hsl(var(--background))', fontWeight: 700, fontSize: 14,
                boxShadow: '0 8px 24px rgba(239,68,68,0.28)',
                transition: 'all 0.2s',
              }}
            >
              {stopping ? 'Stopping…' : '⏹ Stop Test Run'}
            </button>
          )}
          <button
            onClick={() => setConfigOpen((x) => !x)}
            style={{
              padding: '11px 18px', borderRadius: 12, border: '1px solid #e5e7eb',
              background: configOpen ? '#f3f4f6' : '#fff', cursor: 'pointer',
              fontWeight: 600, fontSize: 13, color: '#374151',
            }}
          >
            ⚙ Config
          </button>
        </div>
      </div>

      {/* ── Config accordion ──────────────────────────────────────────────────── */}
      {configOpen && !isRunning && (
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
          marginBottom: 20, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#111827' }}>
              Test Run Configuration
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>
              These settings take effect on the next Start. Adjust while stopped.
            </p>
          </div>
          <ConfigPanel opts={opts} onChange={(patch) => setOpts((prev) => ({ ...prev, ...patch }))} />
        </div>
      )}

      {/* ── Stats strip ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Scans"    value={status?.scanCount   ?? 0} />
        <StatCard label="Sent"     value={status?.totalSent   ?? 0} color="#16a34a" />
        <StatCard label="Skipped"  value={status?.totalSkipped ?? 0} color="#9ca3af" />
        <StatCard label="Errors"   value={status?.totalErrors  ?? 0} color="#dc2626" />
        <StatCard label="Rated 👍"  value={goodRate} color="#16a34a" />
        <StatCard label="Rated 👎"  value={badRate}  color="#dc2626" />
        {status?.currentChatId && (
          <div style={{
            flex: 2, minWidth: 160, padding: '14px 18px',
            background: '#fefce8', border: '1px solid #fde68a', borderRadius: 12,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <span style={{ fontSize: 11, color: '#a16207', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Processing now
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#78350f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status.currentChatId.split('@')[0]}
            </span>
          </div>
        )}
      </div>

      {/* ── Main two-column grid ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, alignItems: 'start' }}>

        {/* Left — Live log terminal */}
        <div style={{
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14,
          overflow: 'hidden',
        }}>
          {/* Terminal chrome */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155',
          }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#eab308', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
              vac — test-run log
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>
              {logs.length} entries
            </span>
          </div>

          {/* Log entries */}
          <div
            ref={logRef}
            style={{
              height: 480, overflowY: 'auto', padding: '10px 8px',
              display: 'flex', flexDirection: 'column',
              fontFamily: 'monospace',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ color: '#475569', fontSize: 13, textAlign: 'center' }}>
                  {isRunning ? 'Scanning…' : 'Start Test Run to see live activity here'}
                </p>
              </div>
            ) : (
              logs.map((entry, i) => (
                <LogLine key={`${entry.ts}-${i}`} entry={entry} />
              ))
            )}
          </div>
        </div>

        {/* Right — Sent replies */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>
              Replies Sent
            </h3>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              Rate to train the AI
            </span>
          </div>

          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {replies.length === 0 ? (
              <div style={{
                padding: '40px 24px', textAlign: 'center',
                background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12,
              }}>
                <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>
                  Sent replies will appear here with feedback buttons
                </p>
              </div>
            ) : (
              replies.map((r) => (
                <ReplyCard key={r.replyId} reply={r} onRate={rateReply} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Safety note ───────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 20, padding: '12px 16px',
        background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{ fontSize: 16, marginTop: 1 }}>🛡</span>
        <div style={{ fontSize: 12, color: '#166534', lineHeight: '1.6' }}>
          <strong>Safety guarantees:</strong> Each message is replied to at most once per session (dedup by timestamp).
          Per-chat cooldown prevents flooding. Reply cap limits max sends per scan.
          The main auto-reply system runs independently — Test Run only targets messages{' '}
          older than the pending-age threshold (default 1 min).
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
      </div>
    </div>
  )
}
