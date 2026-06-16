import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface KeyboardVariant {
  id: string
  text: string
  tone: string
  intent: string
  why: string
}

export interface KeyboardAssistPayload {
  shouldReply: boolean
  noReplyReason: string | null
  variants: KeyboardVariant[]
  deepCompose: {
    draft: string
    tone: string
    intent: string
    why: string
  } | null
  inline: {
    completion: string
    rewrite: string
    toneAdjustment: string
  }
  context: {
    topic: string
    relationship: string
    emotionalState: string
  }
  commitments: { label: string; text: string }[]
  sendTiming: {
    shouldDelay: boolean
    label: string
    reason: string
  }
}

interface KeyboardComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (text?: string) => void
  onRequestAssist: (draft: string) => Promise<KeyboardAssistPayload | null>
  disabled?: boolean
  sending?: boolean
  activeChatName?: string
  activeChatId?: string | null
}

export function KeyboardComposer({
  value,
  onChange,
  onSend,
  onRequestAssist,
  disabled,
  sending,
  activeChatName,
  activeChatId,
}: KeyboardComposerProps) {
  const [assist, setAssist] = useState<KeyboardAssistPayload | null>(null)
  const [loadingAssist, setLoadingAssist] = useState(false)
  const [deepComposeOpen, setDeepComposeOpen] = useState(false)
  const [composeDraft, setComposeDraft] = useState('')
  const [composeMetaOpen, setComposeMetaOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const longPressRef = useRef<number | null>(null)

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      setLoadingAssist(true)
      try {
        const next = await onRequestAssist(value)
        setAssist(next)
        if (!deepComposeOpen && next?.deepCompose?.draft && !value.trim()) {
          setComposeDraft(next.deepCompose.draft)
        }
      } finally {
        setLoadingAssist(false)
      }
    }, value.trim() ? 260 : 120)

    return () => window.clearTimeout(timeout)
  }, [deepComposeOpen, onRequestAssist, value])

  const toneBadge = useMemo(() => {
    const tone = assist?.deepCompose?.tone || 'natural'
    return tone
  }, [assist?.deepCompose?.tone])

  // Fire-and-forget feedback — trains the preference engine
  const trackUsed = useCallback((variant: KeyboardVariant, wasEdited = false) => {
    if (!activeChatId) return
    fetch('/api/whatsapp/feedback/suggestion-used', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: activeChatId, tone: variant.tone, text: variant.text, wasEdited }),
    }).catch(() => {})
  }, [activeChatId])

  function useVariant(variant: KeyboardVariant, mode: 'replace' | 'compose') {
    if (mode === 'replace') {
      onChange(variant.text)
      textareaRef.current?.focus()
      return
    }
    setDeepComposeOpen(true)
    setComposeDraft(variant.text)
  }

  function startLongPress(variant: KeyboardVariant) {
    stopLongPress()
    longPressRef.current = window.setTimeout(() => {
      useVariant(variant, 'compose')
    }, 420)
  }

  function stopLongPress() {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  const canSend = Boolean(value.trim())

  return (
    <div
      style={{
        borderTop: '1px solid rgba(155,188,232,0.45)',
        padding: '12px 14px 14px',
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#55708f' }}>
            VAC Keyboard
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#7f9ab8' }}>
            {activeChatName ? `Replying in ${activeChatName}` : 'Live reply intelligence'}
          </p>
        </div>
        {loadingAssist && (
          <span style={{ fontSize: 11, color: '#55708f' }}>Thinking…</span>
        )}
      </div>

      {assist && !assist.shouldReply && (
        <div style={{ marginBottom: 10, border: '1px solid rgba(155,188,232,0.45)', background: '#edf4ff', borderRadius: 18, padding: '10px 12px' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#10233d' }}>No reply needed</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#55708f' }}>{assist.noReplyReason || 'The conversation looks complete for now.'}</p>
        </div>
      )}

      {assist?.variants?.length ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {assist.variants.map((variant) => (
              <div
                key={variant.id}
                onContextMenu={(e) => {
                  e.preventDefault()
                  useVariant(variant, 'compose')
                }}
                onMouseDown={() => startLongPress(variant)}
                onMouseUp={stopLongPress}
                onMouseLeave={stopLongPress}
                onTouchStart={() => startLongPress(variant)}
                onTouchEnd={stopLongPress}
                style={{
                  minWidth: 220,
                  maxWidth: 260,
                  border: '1px solid rgba(155,188,232,0.45)',
                  background: 'rgba(255,255,255,0.92)',
                  borderRadius: 22,
                  padding: '10px 12px',
                  boxShadow: '0 14px 28px rgba(0,102,204,0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0077ff' }}>
                    {variant.tone}
                  </span>
                  <span style={{ fontSize: 10, color: '#7f9ab8' }}>{variant.intent}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: '#10233d' }}>{variant.text}</p>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: '#55708f' }}>{variant.why}</p>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn-primary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => {
                    trackUsed(variant)
                    onSend(variant.text)
                  }}>
                    Send
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => {
                    trackUsed(variant)
                    useVariant(variant, 'replace')
                  }}>
                    Use
                  </button>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => useVariant(variant, 'compose')}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: deepComposeOpen ? '1.2fr 0.8fr' : '1fr' }}>
          <div style={{ border: '1px solid rgba(155,188,232,0.55)', borderRadius: 24, background: '#fff', padding: 10, boxShadow: '0 16px 32px rgba(0,102,204,0.08)' }}>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={3}
              disabled={disabled}
              placeholder="Type with VAC assistance…"
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                outline: 'none',
                fontSize: 14,
                color: '#10233d',
                background: 'transparent',
                minHeight: 72,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {assist?.inline?.completion ? (
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => onChange(assist.inline.completion)}>
                    Complete phrase
                  </button>
                ) : null}
                {assist?.inline?.rewrite && assist.inline.rewrite !== value.trim() ? (
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => onChange(assist.inline.rewrite)}>
                    Rewrite smarter
                  </button>
                ) : null}
                <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => {
                  setDeepComposeOpen((open) => !open)
                  if (!deepComposeOpen && assist?.deepCompose?.draft) setComposeDraft(assist.deepCompose.draft)
                }}>
                  {deepComposeOpen ? 'Hide deep compose' : 'Open deep compose'}
                </button>
              </div>
              <button className="btn-primary" style={{ fontSize: 12, padding: '8px 16px' }} onClick={() => onSend()} disabled={disabled || sending || !canSend}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          {deepComposeOpen && (
            <div style={{ border: '1px solid rgba(155,188,232,0.55)', borderRadius: 24, background: 'rgba(255,255,255,0.96)', padding: 12, boxShadow: '0 16px 32px rgba(0,102,204,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#10233d' }}>Deep Compose</p>
                  <p style={{ margin: '4px 0 0', fontSize: 11, color: '#55708f' }}>Tone: {toneBadge} · Intent: {assist?.deepCompose?.intent || 'reply'}</p>
                </div>
                <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 10px' }} onClick={() => setComposeMetaOpen((open) => !open)}>
                  {composeMetaOpen ? 'Hide why' : 'Why this works'}
                </button>
              </div>
              <textarea
                value={composeDraft}
                onChange={(e) => setComposeDraft(e.target.value)}
                rows={6}
                style={{
                  width: '100%',
                  resize: 'none',
                  border: '1px solid rgba(155,188,232,0.45)',
                  borderRadius: 18,
                  padding: 12,
                  fontSize: 13,
                  color: '#10233d',
                  background: '#f8fbff',
                  marginTop: 10,
                  outline: 'none',
                }}
              />
              {composeMetaOpen && assist?.deepCompose && (
                <div style={{ marginTop: 10, borderRadius: 18, background: '#edf4ff', padding: 10 }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#55708f' }}>{assist.deepCompose.why}</p>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => onChange(composeDraft)}>
                  Use in input
                </button>
                <button className="btn-primary" style={{ fontSize: 11, padding: '6px 12px' }} onClick={() => onSend(composeDraft)}>
                  Send draft
                </button>
              </div>
            </div>
          )}
        </div>

        {(assist?.inline?.toneAdjustment || assist?.sendTiming || assist?.commitments?.length || assist?.context) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            <div style={{ border: '1px solid rgba(155,188,232,0.45)', borderRadius: 20, background: '#fff', padding: '10px 12px' }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7f9ab8' }}>Tone coach</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#10233d' }}>{assist?.inline?.toneAdjustment || 'Tone looks good.'}</p>
            </div>
            <div style={{ border: '1px solid rgba(155,188,232,0.45)', borderRadius: 20, background: assist?.sendTiming?.shouldDelay ? '#fff7ed' : '#fff', padding: '10px 12px' }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7f9ab8' }}>Send timing</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 700, color: '#10233d' }}>{assist?.sendTiming?.label || 'Good to send'}</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#55708f' }}>{assist?.sendTiming?.reason || 'Timing is fine.'}</p>
            </div>
            <div style={{ border: '1px solid rgba(155,188,232,0.45)', borderRadius: 20, background: '#fff', padding: '10px 12px' }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7f9ab8' }}>Context</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#10233d' }}>
                {assist?.context?.topic || 'general'} · {assist?.context?.relationship || 'unknown'}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#55708f' }}>{assist?.context?.emotionalState || 'neutral'}</p>
            </div>
          </div>
        )}

        {assist?.commitments?.length ? (
          <div style={{ border: '1px solid rgba(255,190,92,0.55)', background: '#fffaf0', borderRadius: 20, padding: '10px 12px' }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9a6700' }}>
              Commitment awareness
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {assist.commitments.map((item, index) => (
                <div key={`${item.text}-${index}`}>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#9a6700' }}>{item.label}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#7c5b00' }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
