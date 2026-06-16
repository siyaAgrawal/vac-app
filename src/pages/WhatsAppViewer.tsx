import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ArrowUp, Paperclip, Upload } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'
import { importWhatsAppExportFile } from '../lib/whatsappImport'
import type { WhatsAppMessage } from '../lib/whatsappImport'

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-8 flex items-center justify-center">
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

function Bubble({ m, myName }: { m: WhatsAppMessage; myName: string }) {
  const mine = m.author === myName
  return (
    <div className={cn('flex gap-3 animate-fade-in', mine ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[65%]">
        <div
          className={cn(
            'rounded-[20px] px-4 py-2.5 text-[14px] leading-[1.45]',
            mine ? 'bg-accent text-accent-foreground' : 'bg-secondary text-foreground',
          )}
        >
          {m.body}
        </div>
        <p className={cn('mt-1.5 text-[11px] text-muted-foreground', mine ? 'text-right' : 'text-left')}>
          {m.author !== myName && <span className="font-medium mr-1">{m.author} ·</span>}
          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

export function WhatsAppViewer() {
  const { activeChat, importChat } = useChatContext()
  const [q, setQ] = useState('')
  const [composer, setComposer] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef  = useRef<HTMLInputElement>(null)

  const messages: WhatsAppMessage[] = useMemo(
    () => activeChat?.messages ?? [],
    [activeChat],
  )

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const myName = useMemo(() => {
    if (!activeChat?.participants?.length) return ''
    // Heuristic: the participant who sends most is "me"
    const counts: Record<string, number> = {}
    messages.forEach(m => { counts[m.author] = (counts[m.author] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, [messages, activeChat])

  const filtered = useMemo(() => {
    if (!q.trim()) return messages
    const lower = q.toLowerCase()
    return messages.filter(m => m.body.toLowerCase().includes(lower))
  }, [messages, q])

  // Group messages by date
  const grouped = useMemo(() => {
    const out: Array<{ type: 'date'; label: string } | { type: 'msg'; m: WhatsAppMessage }> = []
    let lastDate = ''
    for (const m of filtered) {
      const d = new Date(m.timestamp).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      if (d !== lastDate) { out.push({ type: 'date', label: d }); lastDate = d }
      out.push({ type: 'msg', m })
    }
    return out
  }, [filtered])

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = await importWhatsAppExportFile(file)
      if (result) importChat(result.label, result.messages, result.plainText)
    } catch (err) {
      console.error('Import failed', err)
    }
    e.target.value = ''
  }

  if (!activeChat) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-12 animate-fade-in">
        <div className="max-w-md text-center">
          <h2 className="display-lg mb-4">No conversation loaded.</h2>
          <p className="text-[17px] leading-[1.55] text-muted-foreground mb-10">
            Export a WhatsApp chat and import it to get started.
          </p>
          <label className="btn-pill bg-foreground text-background hover:opacity-90 cursor-pointer">
            <Upload className="h-4 w-4" strokeWidth={2} />
            Import .txt file
            <input ref={fileRef} type="file" accept=".txt,.zip" className="hidden" onChange={onFileChange} />
          </label>
          <p className="mt-4 text-[12px] text-muted-foreground">
            WhatsApp → open chat → ⋮ → More → Export chat (without media)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-6 px-12 pt-6 pb-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center text-[14px] font-semibold shrink-0">
            {activeChat.label.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[15px] font-medium tracking-tight">{activeChat.label}</p>
            <p className="text-[12px] text-muted-foreground">
              {messages.length.toLocaleString()} messages
              {activeChat.participants?.length > 0 && ` · ${activeChat.participants.slice(0, 2).join(', ')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="btn-pill bg-secondary text-foreground hover:opacity-80 cursor-pointer text-[12px]">
            <Upload className="h-3.5 w-3.5" />
            Import
            <input type="file" accept=".txt,.zip" className="hidden" onChange={onFileChange} />
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.6} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search in conversation"
              className="h-9 w-72 rounded-full bg-secondary pl-9 pr-4 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30"
            />
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-12 pb-6">
        <div className="mx-auto max-w-3xl space-y-3 pt-4">
          {grouped.map((g, i) =>
            g.type === 'date'
              ? <DateDivider key={`d-${i}`} label={g.label} />
              : <Bubble key={g.m.id} m={g.m} myName={myName} />
          )}
          {filtered.length === 0 && q && (
            <p className="mt-24 text-center text-[13px] text-muted-foreground">
              No messages match "{q}".
            </p>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="px-12 pb-8 border-t border-border pt-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl bg-secondary px-4 py-3">
          <button aria-label="Attach" className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <Paperclip className="h-4 w-4" strokeWidth={1.6} />
          </button>
          <textarea
            value={composer}
            onChange={e => setComposer(e.target.value)}
            placeholder={`Message ${activeChat.label.split(' ')[0]}`}
            rows={1}
            className="flex-1 resize-none bg-transparent py-1 text-[14px] outline-none placeholder:text-muted-foreground"
          />
          <button
            aria-label="Send"
            disabled={!composer.trim()}
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded-full transition-opacity',
              composer.trim() ? 'bg-accent text-accent-foreground hover:opacity-90' : 'text-muted-foreground',
            )}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
