/**
 * Keyboard Companion — laptop version of the VAC AI keyboard.
 * Paste or type any incoming message, get 4 context-aware reply suggestions.
 * Click to copy, or click ↑ to auto-insert into the focused field (if supported).
 * Shows tone of incoming message, best reply time, and rash message warning.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Sparkles, Copy, Send, AlertTriangle, Clock, Smile,
  LoaderCircle, ChevronDown, ChevronUp, Keyboard,
} from 'lucide-react'

interface Suggestion {
  tone:  string
  text:  string
  why:   string
}

interface SuggestResponse {
  ok:              boolean
  suggestions:     Suggestion[]
  toneOfIncoming?: { label: string; emoji: string; score: number }
  bestReplyWindow?:{ label: string; emoji: string; delayMinutes: number }
  rashWarning?:    boolean
  rashReason?:     string
  sendingContext?: string
}

const TONE_COLORS: Record<string, string> = {
  Natural:    'bg-[#e8eaf6] text-[#3949ab]',
  Diplomatic: 'bg-[#e8f5e9] text-[#2e7d32]',
  Persuasive: 'bg-[#fff3e0] text-[#e65100]',
  Warm:       'bg-[#fce4ec] text-[#c62828]',
  Thoughtful: 'bg-[#e3f2fd] text-[#1565c0]',
  Smart:      'bg-[#f3e5f5] text-[#6a1b9a]',
  Funny:      'bg-[#fffde7] text-[#f57f17]',
}

const GOAL_MODES = [
  { id: 'auto',      label: '✦ Auto',       desc: 'Let VAC decide' },
  { id: 'persuade',  label: '🎯 Persuade',   desc: 'Convince them' },
  { id: 'reconnect', label: '💙 Reconnect',  desc: 'Rebuild trust' },
  { id: 'impress',   label: '⚡ Impress',    desc: 'Look sharp' },
  { id: 'firm',      label: '🔒 Firm',       desc: 'Hold your ground' },
  { id: 'funny',     label: '😄 Funny',      desc: 'Lighten the mood' },
]

export function KeyboardCompanion() {
  const [incoming, setIncoming]   = useState('')
  const [draft, setDraft]         = useState('')
  const [goalMode, setGoalMode]   = useState('auto')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState<SuggestResponse | null>(null)
  const [copied, setCopied]       = useState<string | null>(null)
  const [showModes, setShowModes] = useState(false)
  const [autoFetch, setAutoFetch] = useState(true)
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSuggestions = useCallback(async (msg: string, dr: string, mode: string) => {
    if (!msg.trim() && !dr.trim()) { setSuggestions([]); setResult(null); return }
    setLoading(true)
    try {
      const res = await fetch('/api/keyboard/suggest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contextBefore: msg,
          draft:         dr,
          appContext:    'laptop',
          profileKey:    'laptop-global',
          platform:      'laptop',
          goalMode:      mode,
        }),
      })
      if (!res.ok) throw new Error('Server error')
      const data: SuggestResponse = await res.json()
      setResult(data)
      setSuggestions(data.suggestions ?? [])
    } catch {
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced auto-fetch when incoming/draft changes
  useEffect(() => {
    if (!autoFetch) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void fetchSuggestions(incoming, draft, goalMode)
    }, 700)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [incoming, draft, goalMode, autoFetch, fetchSuggestions])

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text)
      setTimeout(() => setCopied(null), 1800)
    })
  }

  function pasteIntoFocused(text: string) {
    // Try to insert into the last-focused editable element via execCommand
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
        active.isContentEditable)) {
      document.execCommand('insertText', false, text)
    } else {
      copyText(text)
    }
  }

  const toneIn   = result?.toneOfIncoming
  const timing   = result?.bestReplyWindow
  const rash     = result?.rashWarning
  const rashMsg  = result?.rashReason
  const sendCtx  = result?.sendingContext

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Keyboard.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Laptop companion for the VAC iOS keyboard — paste any incoming message and get instant AI reply suggestions.
        </p>
      </section>
      <div className="max-w-2xl flex flex-col gap-6">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div>
          <p className="text-[13px] font-medium">VAC Keyboard Companion</p>
          <p className="text-[12px] text-muted-foreground">AI replies for any conversation</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto</span>
          <button
            type="button"
            onClick={() => setAutoFetch(v => !v)}
            className={`relative h-5 w-9 rounded-full transition-colors ${autoFetch ? 'bg-[#000]' : 'bg-[#d1d1d6]'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoFetch ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Incoming message */}
      <div className="rounded-[12px] border border-border bg-white p-4 shadow-sm">
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Their message
        </label>
        <textarea
          value={incoming}
          onChange={e => setIncoming(e.target.value)}
          placeholder="Paste what they sent you…"
          rows={3}
          className="w-full resize-none text-sm text-[#000] placeholder:text-[#b0b0b5] outline-none"
        />
      </div>

      {/* Context chips (tone + timing) */}
      {(toneIn || timing || sendCtx) && (
        <div className="flex flex-wrap items-center gap-2">
          {toneIn && (
            <span className="flex items-center gap-1 rounded-full bg-[#f0f0f5] px-2.5 py-1 text-xs font-medium text-[#3a3a3c]">
              <Smile className="h-3 w-3" />
              {toneIn.emoji} {toneIn.label}
            </span>
          )}
          {timing && (
            <span className="flex items-center gap-1 rounded-full bg-[#f0f0f5] px-2.5 py-1 text-xs font-medium text-[#3a3a3c]">
              <Clock className="h-3 w-3" />
              {timing.emoji} {timing.label}
            </span>
          )}
          {sendCtx && (
            <span className="text-xs text-muted-foreground">{sendCtx}</span>
          )}
        </div>
      )}

      {/* Rash warning */}
      {rash && rashMsg && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="font-semibold">Heads up:</span> {rashMsg} — consider using one of the suggestions below.</span>
        </div>
      )}

      {/* Draft (optional) */}
      <div className="rounded-[12px] border border-border bg-white p-4 shadow-sm">
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Your draft <span className="font-normal normal-case text-muted-foreground">(optional — VAC improves it)</span>
        </label>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Start typing your reply… or leave blank for fresh suggestions"
          rows={2}
          className="w-full resize-none text-sm text-[#000] placeholder:text-[#b0b0b5] outline-none"
        />
      </div>

      {/* Goal mode selector */}
      <div className="rounded-[12px] border border-border bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setShowModes(v => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm"
        >
          <span className="font-medium text-[#000]">
            Goal: {GOAL_MODES.find(m => m.id === goalMode)?.label ?? goalMode}
          </span>
          {showModes ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {showModes && (
          <div className="grid grid-cols-3 gap-2 border-t border-[#f0f0f5] p-3">
            {GOAL_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => { setGoalMode(m.id); setShowModes(false) }}
                className={`rounded-[8px] px-2 py-2 text-left text-xs transition-colors ${
                  goalMode === m.id
                    ? 'bg-[#000] text-white'
                    : 'bg-[#f5f5f7] text-[#3a3a3c] hover:bg-[#eaeaec]'
                }`}
              >
                <div className="font-semibold">{m.label}</div>
                <div className="mt-0.5 opacity-70">{m.desc}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Manual fetch button */}
      {!autoFetch && (
        <button
          type="button"
          onClick={() => void fetchSuggestions(incoming, draft, goalMode)}
          disabled={loading || (!incoming.trim() && !draft.trim())}
          className="flex items-center justify-center gap-2 rounded-[10px] bg-[#000] py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? 'Thinking…' : 'Get suggestions'}
        </button>
      )}

      {/* Loading shimmer */}
      {loading && suggestions.length === 0 && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-[12px] bg-[#f0f0f5]" />
          ))}
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {loading ? 'Refreshing…' : 'Suggestions'}
          </p>
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              suggestion={s}
              copied={copied === s.text}
              onCopy={() => copyText(s.text)}
              onInsert={() => pasteIntoFocused(s.text)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && suggestions.length === 0 && (incoming.trim() || draft.trim()) && (
        <div className="rounded-[12px] border border-border bg-[#fafafa] px-4 py-8 text-center text-sm text-muted-foreground">
          <Sparkles className="mx-auto mb-2 h-6 w-6 opacity-30" />
          No suggestions yet — make sure the VAC server is running
        </div>
      )}

      {!loading && !incoming.trim() && !draft.trim() && suggestions.length === 0 && (
        <div className="rounded-[12px] border border-dashed border-[#d1d1d6] bg-[#fafafa] px-4 py-10 text-center">
          <Keyboard className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-[14px] font-medium text-muted-foreground">Paste any message to get started</p>
          <p className="mt-1 text-[13px] text-muted-foreground">VAC reads the context and suggests replies that sound like you</p>
        </div>
      )}
      </div>{/* end max-w-2xl */}
    </div>
  )
}

// MARK: - SuggestionCard

function SuggestionCard({
  suggestion, copied, onCopy, onInsert,
}: {
  suggestion: Suggestion
  copied:     boolean
  onCopy:     () => void
  onInsert:   () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = suggestion.text.length > 120
  const display = isLong && !expanded
    ? suggestion.text.slice(0, 120) + '…'
    : suggestion.text

  const toneCls = TONE_COLORS[suggestion.tone] ?? 'bg-[#f0f0f5] text-[#3a3a3c]'

  return (
    <div className="group rounded-[12px] border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${toneCls}`}>
          {suggestion.tone}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs text-muted-foreground hover:bg-[#f5f5f7] transition-colors"
            title="Copy to clipboard"
          >
            <Copy className="h-3 w-3" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={onInsert}
            className="flex items-center gap-1 rounded-[6px] bg-[#000] px-2 py-1 text-xs font-medium text-white hover:bg-[#333] transition-colors"
            title="Insert into focused text field"
          >
            <Send className="h-3 w-3" />
            Use
          </button>
        </div>
      </div>
      <p className="text-sm text-[#000] leading-relaxed">{display}</p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-[#000] transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Show less' : 'Show full message'}
        </button>
      )}
      {suggestion.why && (
        <p className="mt-1.5 text-xs text-muted-foreground">✦ {suggestion.why}</p>
      )}
    </div>
  )
}
