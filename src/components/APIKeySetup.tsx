import { useState } from 'react'
import { Key, ArrowRight, X, CheckCircle2 } from 'lucide-react'

interface Props {
  onDismiss: () => void
}

export function APIKeySetup({ onDismiss }: Props) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  async function save() {
    const trimmed = key.trim()
    if (!trimmed) { setError('Paste your API key first'); return }
    if (!trimmed.startsWith('sk-ant-')) { setError('Anthropic keys start with sk-ant-…'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: trimmed }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSaved(true)
      setTimeout(onDismiss, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  if (saved) {
    return (
      <div className="flex items-center gap-3 px-5 py-3 bg-green-50 dark:bg-green-900/20 border-b border-green-100 dark:border-green-800/40">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" strokeWidth={1.6} />
        <p className="text-[13px] text-green-700 dark:text-green-400 font-medium">Claude API key saved — VAC is now running on the best model.</p>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className="flex items-center gap-3 px-5 py-2.5 bg-secondary/50 border-b border-border">
        <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.6} />
        <p className="text-[12px] text-muted-foreground flex-1 min-w-0">
          Running on local AI (Ollama).{' '}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2 hover:opacity-75"
          >
            Add a Claude API key
          </a>{' '}
          for best intelligence.
        </p>
        <button
          onClick={() => setExpanded(true)}
          className="text-[12px] font-medium text-foreground hover:opacity-75 flex items-center gap-1 shrink-0"
        >
          Add key <ArrowRight className="h-3 w-3" />
        </button>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground shrink-0 ml-1">
          <X className="h-3.5 w-3.5" strokeWidth={1.6} />
        </button>
      </div>
    )
  }

  return (
    <div className="px-5 py-4 bg-secondary/50 border-b border-border">
      <div className="max-w-lg">
        <p className="text-[13px] font-semibold mb-1">Add your Claude API key</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Get one free at{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-75">
            console.anthropic.com
          </a>{' '}
          → Settings → API Keys. Stored locally on your Mac, never sent anywhere.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={key}
            onChange={e => { setKey(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="sk-ant-api03-…"
            autoFocus
            className="flex-1 h-9 rounded-xl bg-background border border-border px-3 text-[13px] font-mono outline-none focus:ring-2 focus:ring-foreground/10"
          />
          <button
            onClick={save}
            disabled={saving || !key.trim()}
            className="h-9 px-4 rounded-xl bg-foreground text-background text-[13px] font-medium disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setExpanded(false)} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" strokeWidth={1.6} />
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}
