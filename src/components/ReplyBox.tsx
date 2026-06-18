import { useState, useCallback } from 'react'
import { ArrowUp, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import type { SendDecision, Draft, DraftMode, RashWarning } from '../types'

function cn(...c: (string | boolean | undefined)[]) { return c.filter(Boolean).join(' ') }

interface ReplyBoxProps {
  threadId: string
  placeholder?: string
  decision?: SendDecision | null
  loading?: boolean
  onSend?: (text: string, mode: DraftMode) => void
  onRefresh?: () => void
}

const MODE_LABELS: Record<DraftMode, string> = {
  natural:      'Natural',
  professional: 'Professional',
  warm:         'Warm',
  persuasive:   'Persuasive',
  boundary:     'Boundary',
}

function WarningBadge({ w }: { w: RashWarning }) {
  const icon = w.severity === 'critical'
    ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
    : w.severity === 'warning'
      ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      : <Clock className="h-3.5 w-3.5 text-muted-foreground" />
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
      {icon}
      <span>{w.message}</span>
    </div>
  )
}

export function ReplyBox({ threadId, placeholder, decision, loading, onSend, onRefresh }: ReplyBoxProps) {
  const [selectedMode, setSelectedMode] = useState<DraftMode>('natural')
  const [text, setText] = useState('')
  const [showStrategy, setShowStrategy] = useState(false)

  const selectedDraft = decision?.drafts.find(d => d.mode === selectedMode)

  const handleModeSelect = useCallback((mode: DraftMode) => {
    setSelectedMode(mode)
    const draft = decision?.drafts.find(d => d.mode === mode)
    if (draft) setText(draft.text)
  }, [decision])

  const handleSend = useCallback(() => {
    if (!text.trim()) return
    onSend?.(text.trim(), selectedMode)
    setText('')
  }, [text, selectedMode, onSend])

  // No reply recommended
  if (decision && !decision.noReply.shouldReply && !decision.drafts.length) {
    return (
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-secondary px-5 py-4">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.6} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium">No reply needed.</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {decision.noReply.reason ?? 'Conversation appears complete.'}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="text-[12px] text-accent hover:opacity-75 shrink-0"
          >
            Override
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-border">
      {/* Warnings */}
      {decision?.warnings && decision.warnings.length > 0 && (
        <div className="px-5 pt-3 space-y-1.5">
          {decision.warnings.map((w, i) => <WarningBadge key={i} w={w} />)}
        </div>
      )}

      {/* Draft mode chips */}
      {decision?.drafts && decision.drafts.length > 0 && (
        <div className="flex items-center gap-2 px-5 pt-3 pb-2 overflow-x-auto scrollbar-none">
          {decision.drafts.map(d => (
            <button
              key={d.mode}
              onClick={() => handleModeSelect(d.mode)}
              className={cn(
                'btn-pill text-[12px] shrink-0 transition-all',
                selectedMode === d.mode
                  ? 'bg-foreground text-background'
                  : 'bg-secondary text-foreground hover:opacity-80',
              )}
            >
              {MODE_LABELS[d.mode]}
            </button>
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="px-4 pb-2 pt-1">
        <div className="flex items-end gap-3 rounded-2xl bg-secondary px-4 py-3 focus-within:ring-2 focus-within:ring-foreground/10">
          <textarea
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={loading ? 'VAC is thinking…' : (placeholder ?? 'Write a reply…')}
            disabled={loading}
            className="flex-1 resize-none bg-transparent text-[14px] leading-[1.5] placeholder:text-muted-foreground focus:outline-none max-h-36"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <div className="flex items-center gap-2 shrink-0">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <button
              onClick={handleSend}
              disabled={!text.trim() || loading}
              className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center text-background disabled:opacity-30 transition-opacity"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>

      {/* Strategy explanation */}
      {decision?.explanation && (
        <div className="px-5 pb-3">
          <button
            onClick={() => setShowStrategy(v => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showStrategy ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {decision.explanation.summary}
          </button>
          {showStrategy && (
            <div className="mt-2 space-y-1.5 text-[12px] text-muted-foreground">
              <p><span className="font-medium text-foreground">Intent:</span> {decision.explanation.intent}</p>
              <p><span className="font-medium text-foreground">Tone read:</span> {decision.explanation.toneRead}</p>
              <p><span className="font-medium text-foreground">Strategy:</span> {decision.explanation.whyThisStrategy}</p>
              {selectedDraft && (
                <>
                  <p><span className="font-medium text-foreground">Expected:</span> {selectedDraft.expectedOutcome}</p>
                  {selectedDraft.risks.length > 0 && (
                    <p><span className="font-medium text-foreground">Risks:</span> {selectedDraft.risks.join(', ')}</p>
                  )}
                </>
              )}
              {decision.sendHint && (
                <p className={decision.sendHint.canSendNow ? 'text-foreground/60' : 'text-amber-500'}>
                  {decision.sendHint.reason}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
