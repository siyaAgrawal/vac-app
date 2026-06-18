import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, AlertTriangle, Clock, Zap } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'
import { importWhatsAppExportFile } from '../lib/whatsappImport'

function timeAgo(ts: string | number): string {
  const ms = Date.now() - new Date(ts).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d === 1) return 'yesterday'
  return `${d}d ago`
}

function PulseDot({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
    </span>
  )
}

function ToneTag({ score }: { score: number }) {
  if (score >= 70) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">stressed</span>
  if (score >= 50) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 font-medium shrink-0">tense</span>
  if (score >= 30) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground font-medium shrink-0">neutral</span>
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 font-medium shrink-0">warm</span>
}

export function InboxPage() {
  const navigate = useNavigate()
  const { chats, allCommitments, setActiveId, importChat } = useChatContext()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning.'
    if (h < 18) return 'Good afternoon.'
    return 'Good evening.'
  }, [])

  // Detect user's WhatsApp display name (non-numeric participant common across chats)
  const userName = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const chat of Object.values(chats)) {
      for (const p of (chat.participants ?? [])) {
        if (!/^\d+$/.test(p)) counts[p] = (counts[p] ?? 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Me'
  }, [chats])

  const threads = useMemo(() => {
    return Object.values(chats).map(chat => {
      const msgs = chat.messages
      const lastMsg = msgs[msgs.length - 1]
      const commitments = allCommitments.filter(c =>
        c.conversationId === chat.id || c.madeToPersonName === chat.label
      )
      const overdue = commitments.filter(c => c.status === 'overdue').length
      const pending = commitments.filter(c => c.status === 'pending' || c.status === 'in-progress').length

      const recentText = msgs.slice(-8).map(m => m.text ?? m.body ?? '').join(' ')
      const stressScore =
        /urgent|asap|please|help|worried|need now|angry|frustrated|upset|hate/i.test(recentText) ? 72
        : /stressed|anxious|not okay|important|serious/i.test(recentText) ? 56
        : /thanks|love|great|excited|happy|awesome|appreciate/i.test(recentText) ? 20
        : 35

      const lastTs = lastMsg?.timestamp ? new Date(lastMsg.timestamp).getTime() : 0
      const ageMs = Date.now() - lastTs
      const lastAuthor = lastMsg?.author ?? ''
      const lastIsInbound = lastMsg && lastAuthor !== 'Me' && lastAuthor !== userName
      const closureRe = /^(ok|okay|k|sure|👍|✅|noted|done|will do|alright|sounds good|perfect|haha|lol|😂|🙏|got it)\.?!?$/i
      const isClosed = lastMsg && closureRe.test((lastMsg.text ?? '').trim())
      const needsReply = Boolean(lastIsInbound && !isClosed)
      const waitingTooLong = needsReply && ageMs > 2 * 3600000
      const priority = overdue * 4 + (waitingTooLong ? 3 : 0) + (needsReply ? 1 : 0) + (pending > 0 ? 1 : 0)

      return { chat, lastMsg, overdue, pending, stressScore, needsReply, waitingTooLong, priority, lastTs }
    }).sort((a, b) => b.priority - a.priority || b.lastTs - a.lastTs)
  }, [chats, allCommitments, userName])

  const needsReplyCount = threads.filter(t => t.needsReply).length
  const overdueCount = threads.reduce((n, t) => n + t.overdue, 0)

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const result = await importWhatsAppExportFile(file)
      if (result) importChat(result.label, result.messages, result.plainText)
    } catch (err) { console.error('Import failed', err) }
    finally { setImporting(false); e.target.value = '' }
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-10 pt-10 pb-7 border-b border-border">
        <p className="text-[11px] text-muted-foreground mb-2.5 uppercase tracking-wider">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-[38px] font-semibold tracking-[-0.02em] leading-none">{greeting}</h1>
        <div className="mt-4">
          {needsReplyCount > 0 ? (
            <p className="text-[15px] text-muted-foreground">
              <span className="font-semibold text-foreground">{needsReplyCount} {needsReplyCount === 1 ? 'person' : 'people'}</span> waiting
              {overdueCount > 0 && <> · <span className="text-destructive font-medium">{overdueCount} overdue</span></>}
            </p>
          ) : threads.length > 0 ? (
            <p className="text-[15px] text-muted-foreground">All caught up.</p>
          ) : (
            <p className="text-[15px] text-muted-foreground">Import a conversation to start.</p>
          )}
        </div>
        <div className="mt-5">
          <input ref={fileRef} type="file" accept=".txt,.zip" className="hidden" onChange={onFileChange} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[12px] font-medium hover:opacity-75 transition-opacity disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {importing ? 'Importing…' : 'Import conversation'}
          </button>
        </div>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-12 text-center">
            <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center mb-6">
              <Zap className="h-7 w-7 text-muted-foreground/50" strokeWidth={1} />
            </div>
            <h2 className="text-[20px] font-semibold tracking-tight mb-3">Your inbox is empty.</h2>
            <p className="text-[14px] text-muted-foreground mb-8 max-w-xs leading-relaxed">
              Export a WhatsApp chat and import it. VAC reads the full context and starts helping immediately.
            </p>
            <p className="text-[11px] text-muted-foreground">
              WhatsApp → open chat → ⋮ → More → Export chat (without media)
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {threads.map(({ chat, lastMsg, overdue, pending, stressScore, needsReply, waitingTooLong }) => (
              <button
                key={chat.id}
                onClick={() => { setActiveId(chat.id); navigate(`/c/${chat.id}`) }}
                className="w-full flex items-center gap-4 px-10 py-[18px] text-left hover:bg-secondary/30 transition-colors group"
              >
                <div className={`h-11 w-11 rounded-full flex items-center justify-center text-[15px] font-semibold shrink-0 transition-transform group-hover:scale-[1.03] ${needsReply ? 'bg-foreground text-background' : 'bg-secondary text-foreground/70'}`}>
                  {(chat.label ?? '?').charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`text-[14px] font-medium truncate ${needsReply ? 'text-foreground' : 'text-foreground/60'}`}>
                      {chat.label}
                    </p>
                    <PulseDot active={waitingTooLong} />
                  </div>
                  <p className="text-[12px] text-muted-foreground truncate leading-snug">
                    {(lastMsg?.text ?? lastMsg?.body ?? 'No messages').slice(0, 75)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0 ml-2">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {lastMsg?.timestamp ? timeAgo(lastMsg.timestamp) : ''}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {overdue > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-destructive font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        {overdue}
                      </span>
                    )}
                    {pending > 0 && overdue === 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {pending}
                      </span>
                    )}
                    <ToneTag score={stressScore} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
