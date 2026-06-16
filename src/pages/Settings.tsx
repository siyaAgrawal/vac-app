/**
 * Settings — API key management + WhatsApp connection controls.
 * Enter your Anthropic key once here; it's saved to macOS Keychain
 * and .env automatically. No manual file editing required.
 */
import { useEffect, useState, useCallback } from 'react'
import {
  KeyRound, CheckCircle2, XCircle, AlertCircle, Loader2,
  Wifi, WifiOff, RefreshCw, QrCode, Bot, Trash2,
  Smartphone, Chrome, Monitor,
} from 'lucide-react'

interface KeyStatus {
  set: boolean
  preview: string | null
  length?: number
}

interface WhatsAppStatus {
  status: 'disconnected' | 'qr_pending' | 'connecting' | 'ready' | 'auth_failure'
  qrDataUrl?: string | null
  info?: { name: string; phone: string } | null
}

interface WaConfig {
  autoReply: boolean
  replyDelay: { min: number; max: number }
  maxQueuePerChat: number
}

interface SettingsData {
  apiKey: KeyStatus
  provider: 'anthropic' | 'ollama' | null
  ollama: boolean
  whatsapp: WhatsAppStatus
  config: WaConfig
}

// ── Small reusable components ─────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        ok
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-red-50 text-red-600 border border-red-200'
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {label}
    </span>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-white shadow-[0_2px_20px_rgba(0,0,0,0.06)] p-6">
      <h2 className="font-display text-base font-semibold text-[#1d1d1f] mb-5">{title}</h2>
      {children}
    </div>
  )
}

// ── VAC Keyboard Section ──────────────────────────────────────────────────────

type KeyboardTab = 'chrome' | 'ios' | 'android'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-xs text-[#55708f]">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#0071e3] text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="bg-white px-1.5 py-0.5 rounded border border-border font-mono text-[11px] text-[#1d1d1f]">{children}</code>
}

function VACKeyboardSection({ localIp }: { localIp: string | null }) {
  const [tab, setTab] = useState<KeyboardTab>('chrome')
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)

  const testConnection = useCallback(async () => {
    setTesting(true)
    setConnectionOk(null)
    try {
      const res = await fetch('/api/health')
      setConnectionOk(res.ok)
    } catch {
      setConnectionOk(false)
    } finally {
      setTesting(false)
    }
  }, [])

  const ip = localIp ?? '192.168.1.x'

  const tabs: { id: KeyboardTab; label: string; icon: React.ReactNode }[] = [
    { id: 'chrome',  label: 'Chrome',  icon: <Monitor  className="h-3.5 w-3.5" /> },
    { id: 'ios',     label: 'iPhone',  icon: <Smartphone className="h-3.5 w-3.5" /> },
    { id: 'android', label: 'Android', icon: <Smartphone className="h-3.5 w-3.5" /> },
  ]

  return (
    <SectionCard title="VAC Keyboard — AI Suggestions Everywhere">
      {/* Intro */}
      <p className="text-sm text-muted-foreground mb-5">
        Get 4 smart reply suggestions while you type — in every app, on every device.
        VAC learns your style over time and improves with every suggestion you use.
      </p>

      {/* Pill tabs */}
      <div className="flex gap-1.5 mb-5 p-1 bg-[#f5f5f7] rounded-[12px] w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-[9px] text-xs font-semibold transition-all ${
              tab === t.id
                ? 'bg-white shadow-sm text-[#1d1d1f]'
                : 'text-muted-foreground hover:text-[#1d1d1f]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Chrome tab */}
      {tab === 'chrome' && (
        <div className="space-y-4">
          {/* How it works */}
          <div className="rounded-[14px] bg-gradient-to-br from-[#f0f6ff] to-[#eaf4ff] border border-[rgba(0,113,227,0.12)] px-4 py-3">
            <p className="text-xs font-semibold text-[#0071e3] mb-1">What you get</p>
            <p className="text-xs text-[#344e6e] leading-relaxed">
              A floating VAC suggestion bar appears automatically when you click any text field on Gmail, Twitter, WhatsApp Web, LinkedIn, Telegram, Discord, Slack, Instagram, and more. Tap a chip to insert the suggestion.
            </p>
          </div>

          {/* Steps */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Install (30 seconds)</p>
            <ol className="space-y-2.5">
              <Step n={1}>Open Chrome and go to <Code>chrome://extensions</Code></Step>
              <Step n={2}>Enable <strong>Developer mode</strong> — toggle in the top-right corner</Step>
              <Step n={3}>Click <strong>Load unpacked</strong> → select the <Code>extension/</Code> folder inside your VAC project folder</Step>
              <Step n={4}>The VAC icon appears in your Chrome toolbar — you're done ✓</Step>
            </ol>
          </div>

          {/* Phone URL */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">VAC on phone browser</p>
            <div className="flex items-center gap-3 rounded-[12px] bg-[#f5f5f7] border border-[rgba(0,0,0,0.06)] px-4 py-3">
              <Wifi className="h-4 w-4 text-[#0071e3] shrink-0" />
              <div>
                <p className="font-mono text-sm font-bold text-[#0071e3]">http://{ip}:5173</p>
                <p className="text-xs text-[#55708f] mt-0.5">Open in Safari on your phone — both devices must be on the same Wi-Fi</p>
              </div>
            </div>
          </div>

          {/* Test */}
          <div className="flex items-center gap-3">
            <button
              onClick={testConnection}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#0071e3] text-white text-xs font-semibold hover:bg-[#0077ed] disabled:opacity-50 transition-colors"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Test connection
            </button>
            {connectionOk === true  && <span className="text-xs text-green-600 font-medium">✓ VAC server reachable</span>}
            {connectionOk === false && <span className="text-xs text-red-500 font-medium">✗ Server not found — is it running?</span>}
          </div>
        </div>
      )}

      {/* iOS tab */}
      {tab === 'ios' && (
        <div className="space-y-4">
          {/* What you get */}
          <div className="rounded-[14px] bg-gradient-to-br from-[#f0f6ff] to-[#eaf4ff] border border-[rgba(0,113,227,0.12)] px-4 py-3">
            <p className="text-xs font-semibold text-[#0071e3] mb-1">What you get</p>
            <ul className="mt-1 space-y-1">
              {[
                '4 contextual reply chips above every keyboard — WhatsApp, iMessage, Instagram, Gmail and more',
                'Tap a chip to insert it · tap ↑ to insert and send in one tap',
                'WhatsApp ↑ sends via the bridge — actually sends the message in the background',
                'Powered by Claude AI directly on your phone when API key is set, Ollama otherwise',
                'Gets smarter per contact — learns your tone over time',
              ].map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-[#344e6e]">
                  <span className="text-[#0071e3] shrink-0">✦</span><span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Build steps */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Build & install (requires Xcode)</p>
            <ol className="space-y-2.5">
              <Step n={1}>Open Xcode → open the <Code>keyboard-ios/VACKeyboard.xcodeproj</Code> project (already created)</Step>
              <Step n={2}>In both targets (VACKeyboard + VACKeyboardExt) → Signing & Capabilities → set your <strong>Team</strong> (Apple ID)</Step>
              <Step n={3}>In both targets → Signing & Capabilities → add <strong>App Groups</strong> → <Code>group.com.vac.keyboard</Code></Step>
              <Step n={4}>
                Set your Mac's IP in <Code>VACConfig.swift</Code> (the <Code>vacServerURL</Code> default):
                <span className="block mt-1 font-mono text-[10px] bg-[#1d1d1f] text-[#a8d8a8] px-2 py-1.5 rounded-[7px]">
                  {`"http://${ip}:8787"`}
                </span>
              </Step>
              <Step n={5}>
                <strong>Optional but recommended — Claude AI direct:</strong> enter your Anthropic API key in the <strong>AI Provider</strong> section above, then open the VAC app on your iPhone and go to Settings → paste the same key there. The keyboard reads it via App Groups and calls Claude directly — no Mac needed.
              </Step>
              <Step n={6}>iPhone connected by USB → select it in Xcode → <strong>⌘R</strong> to build and install</Step>
              <Step n={7}>On iPhone: Settings → General → Keyboard → Keyboards → Add New Keyboard → <strong>VACKeyboard</strong></Step>
              <Step n={8}>Tap it → enable <strong>Allow Full Access</strong> (required for network requests)</Step>
            </ol>
          </div>

          {/* Send behaviour */}
          <div className="rounded-[12px] bg-[#f0fdf4] border border-[rgba(22,163,74,0.2)] px-4 py-3">
            <p className="text-xs font-semibold text-[#15803d] mb-1">How ↑ Send works</p>
            <p className="text-xs text-[#166534] leading-relaxed">
              In <strong>WhatsApp</strong>: tapping ↑ sends the message via the WhatsApp bridge on your Mac — it actually appears as sent in WhatsApp. In <strong>iMessage, Telegram, Signal</strong>: ↑ inserts the text and presses Return, which sends the message. Both devices must be on the same Wi-Fi (or bridge enabled).
            </p>
          </div>

          <div className="rounded-[12px] bg-[#fffbeb] border border-[rgba(245,158,11,0.2)] px-4 py-3">
            <p className="text-xs font-semibold text-[#b45309] mb-1">Switching keyboards while typing</p>
            <p className="text-xs text-[#78530a]">Long-press the 🌐 globe icon on any keyboard → select VAC. Tap 🌐 to switch back anytime.</p>
          </div>

          <p className="text-[11px] text-[#9e9ea8]">Full guide: <Code>keyboard-ios/README.md</Code></p>
        </div>
      )}

      {/* Android tab */}
      {tab === 'android' && (
        <div className="space-y-4">
          <div className="rounded-[14px] bg-gradient-to-br from-[#f0f6ff] to-[#eaf4ff] border border-[rgba(0,113,227,0.12)] px-4 py-3">
            <p className="text-xs font-semibold text-[#0071e3] mb-1">What you get</p>
            <p className="text-xs text-[#344e6e] leading-relaxed">
              A VAC suggestion bar above your Android keyboard in every app. Tap a suggestion to replace your draft instantly.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Build & install (requires Android Studio)</p>
            <ol className="space-y-2.5">
              <Step n={1}>Open Android Studio → New Project → Empty Activity. Package: <Code>com.vac.keyboard</Code></Step>
              <Step n={2}>Copy files from <Code>keyboard-android/</Code> into the project (see README)</Step>
              <Step n={3}>
                In <Code>VACInputMethodService.java</Code>, set your Mac's IP:
                <span className="block mt-1 font-mono text-[10px] bg-[#1d1d1f] text-[#a8d8a8] px-2 py-1.5 rounded-[7px]">
                  {`DEFAULT_URL = "http://${ip}:8787"`}
                </span>
              </Step>
              <Step n={4}>Connect your Android device → Run → install APK</Step>
              <Step n={5}>Settings → General Management → Keyboard → Add keyboard → <strong>VAC Keyboard</strong></Step>
            </ol>
          </div>

          <p className="text-[11px] text-[#9e9ea8]">Full build guide: <Code>keyboard-android/README.md</Code></p>
        </div>
      )}

      {/* Self-learning callout */}
      <div className="mt-5 rounded-[12px] bg-[#f5f5f7] border border-[rgba(0,0,0,0.05)] px-4 py-3 flex gap-3">
        <span className="text-lg mt-0.5">🧠</span>
        <div>
          <p className="text-xs font-semibold text-[#1d1d1f]">Gets smarter with every use</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Every time you pick a suggestion, VAC records your preference. After a few uses it starts weighting suggestions toward your style — the tone you pick most often gets prioritised automatically.
          </p>
        </div>
      </div>
    </SectionCard>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [localIp, setLocalIp] = useState<string | null>(null)

  // API key form
  const [keyInput, setKeyInput] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [keyFeedback, setKeyFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  // WhatsApp
  const [waAction, setWaAction] = useState(false)
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  // ── Load settings ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (res.ok) setData(await res.json())
    } catch {/* server not up yet */}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setLocalIp(d.localIp ?? null)).catch(() => {})
  }, [])

  // Poll WhatsApp status while connecting
  useEffect(() => {
    if (!data) return
    const st = data.whatsapp?.status
    if (st === 'connecting' || st === 'qr_pending') {
      const t = setTimeout(load, 3000)
      return () => clearTimeout(t)
    }
  }, [data, load])

  // ── SSE for QR code ──────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/whatsapp/events')
    es.addEventListener('qr', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setQrUrl(d.qrDataUrl)
      setData((prev) => prev ? { ...prev, whatsapp: { ...prev.whatsapp, status: 'qr_pending', qrDataUrl: d.qrDataUrl } } : prev)
    })
    es.addEventListener('bridge_status', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (d.status === 'ready') setQrUrl(null)
      setData((prev) => prev ? { ...prev, whatsapp: { status: d.status, qrDataUrl: d.qrDataUrl, info: d.info } } : prev)
    })
    es.addEventListener('ready', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      setQrUrl(null)
      setData((prev) => prev ? { ...prev, whatsapp: { status: 'ready', qrDataUrl: null, info: d.info } } : prev)
    })
    return () => es.close()
  }, [])

  // ── Save API key ─────────────────────────────────────────────────────────────
  const saveKey = async () => {
    if (!keyInput.trim()) return
    setKeySaving(true)
    setKeyFeedback(null)
    try {
      const res = await fetch('/api/settings/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim() }),
      })
      const json = await res.json()
      if (res.ok) {
        setKeyFeedback({ ok: true, msg: 'API key saved — AI features are now active.' })
        setKeyInput('')
        await load()
      } else {
        setKeyFeedback({ ok: false, msg: json.error ?? 'Failed to save' })
      }
    } catch {
      setKeyFeedback({ ok: false, msg: 'Server unreachable' })
    } finally {
      setKeySaving(false)
    }
  }

  // ── Clear API key ────────────────────────────────────────────────────────────
  const clearKey = async () => {
    if (!confirm('Remove the saved API key? AI features will stop working until you add a new one.')) return
    await fetch('/api/settings/apikey', { method: 'DELETE' })
    setKeyFeedback(null)
    await load()
  }

  // ── WhatsApp bridge start/stop ────────────────────────────────────────────────
  const startBridge = async () => {
    setWaAction(true)
    try {
      await fetch('/api/whatsapp/start', { method: 'POST' })
      await load()
    } finally { setWaAction(false) }
  }

  const stopBridge = async () => {
    setWaAction(true)
    try {
      await fetch('/api/whatsapp/stop', { method: 'POST' })
      setQrUrl(null)
      await load()
    } finally { setWaAction(false) }
  }

  // ── Toggle auto-reply ────────────────────────────────────────────────────────
  const toggleAutoReply = async () => {
    if (!data) return
    const next = !data.config.autoReply
    setData((d) => d ? { ...d, config: { ...d.config, autoReply: next } } : d)
    await fetch('/api/whatsapp/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoReply: next }),
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const waSt = data?.whatsapp?.status ?? 'disconnected'
  const waReady = waSt === 'ready'
  const waConnecting = waSt === 'connecting' || waSt === 'qr_pending'

  const waStatusLabel: Record<string, string> = {
    disconnected: 'Disconnected',
    qr_pending:   'Waiting for QR scan',
    connecting:   'Connecting…',
    ready:        'Connected',
    auth_failure: 'Auth failed',
  }

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Settings.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Configure your AI provider and WhatsApp connection. Set it once — it's saved automatically.
        </p>
      </section>
      <div className="max-w-4xl space-y-8">

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">

          {/* ── API Key section ── */}
          <SectionCard title="AI Provider — Anthropic Claude">
            {/* Current status */}
            <div className="mb-5 flex items-center gap-3">
              {data?.apiKey?.set ? (
                <>
                  <StatusBadge ok label="Active" />
                  <span className="font-mono text-xs text-muted-foreground">{data.apiKey.preview}</span>
                  <button
                    onClick={clearKey}
                    className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[#dc2626] hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </>
              ) : (
                <>
                  <StatusBadge ok={false} label="Not set" />
                  {data?.ollama && (
                    <span className="text-xs text-muted-foreground">Ollama fallback active</span>
                  )}
                </>
              )}
            </div>

            {/* Input */}
            <div className="space-y-3">
              <label className="block text-sm font-medium text-[#1d1d1f]">
                {data?.apiKey?.set ? 'Replace key' : 'Enter your Anthropic API key'}
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                placeholder="sk-ant-api03-…"
                className="w-full rounded-xl border border-[#d2d2d7]/50 bg-[#f5f5f7] px-4 py-2.5 text-sm font-mono text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/20 placeholder:text-muted-foreground"
              />
              <button
                onClick={saveKey}
                disabled={keySaving || !keyInput.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#0077ed] transition-colors"
              >
                {keySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {keySaving ? 'Saving…' : 'Save API Key'}
              </button>
              {keyFeedback && (
                <p className={`flex items-center gap-1.5 text-sm ${keyFeedback.ok ? 'text-green-700' : 'text-red-600'}`}>
                  {keyFeedback.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {keyFeedback.msg}
                </p>
              )}
            </div>

            <div className="mt-5 rounded-xl bg-[#f5f5f7] p-3 text-xs text-muted-foreground space-y-1">
              <p><strong className="text-[#1d1d1f]">Where is it saved?</strong></p>
              <p>1. macOS Keychain (most secure — survives reboots)</p>
              <p>2. .env file in the project (picked up on next start)</p>
              <p className="mt-1">
                Get a key at{' '}
                <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-[#0071e3] underline">
                  console.anthropic.com
                </a>
              </p>
            </div>
          </SectionCard>

          {/* ── WhatsApp section ── */}
          <SectionCard title="WhatsApp Bridge">
            {/* Status */}
            <div className="mb-5 flex items-center gap-3">
              <StatusBadge ok={waReady} label={waStatusLabel[waSt] ?? waSt} />
              {data?.whatsapp?.info && (
                <span className="text-xs text-muted-foreground">
                  {data.whatsapp.info.name} · +{data.whatsapp.info.phone}
                </span>
              )}
            </div>

            {/* QR code */}
            {(qrUrl ?? data?.whatsapp?.qrDataUrl) && (
              <div className="mb-5 flex flex-col items-center gap-2 rounded-xl border border-[#d2d2d7]/50 p-4 bg-[#f5f5f7]">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[#1d1d1f]">
                  <QrCode className="h-3.5 w-3.5" />
                  Scan with WhatsApp
                </div>
                <img
                  src={qrUrl ?? data?.whatsapp?.qrDataUrl ?? ''}
                  alt="WhatsApp QR"
                  className="h-48 w-48 rounded-lg border border-[#d2d2d7]/50"
                />
                <p className="text-xs text-muted-foreground">WhatsApp → Linked Devices → Link a Device</p>
              </div>
            )}

            {/* Start / Stop */}
            <div className="space-y-2">
              {!waReady && !waConnecting && (
                <button
                  onClick={startBridge}
                  disabled={waAction}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#000] transition-colors"
                >
                  {waAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                  {waAction ? 'Starting…' : 'Start WhatsApp Bridge'}
                </button>
              )}
              {waConnecting && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-[#d2d2d7]/50 px-4 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {waSt === 'qr_pending' ? 'Waiting for QR scan…' : 'Connecting to WhatsApp…'}
                </div>
              )}
              {waReady && (
                <button
                  onClick={stopBridge}
                  disabled={waAction}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d2d2d7]/50 px-4 py-2.5 text-sm font-semibold text-[#1d1d1f] disabled:opacity-40 hover:bg-[#f5f5f7] transition-colors"
                >
                  {waAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
                  Disconnect
                </button>
              )}
              <button
                onClick={load}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d2d2d7]/50 px-4 py-2.5 text-sm text-muted-foreground hover:bg-[#f5f5f7] transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh status
              </button>
            </div>

            {/* Auto-reply toggle */}
            {data?.config && (
              <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-[#d2d2d7]/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[#1d1d1f]">Auto-reply</p>
                  <p className="text-xs text-muted-foreground">
                    {data.config.autoReply
                      ? 'VAC will automatically send AI-generated replies'
                      : 'VAC will suggest replies but wait for your approval'}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={data.config.autoReply}
                  onClick={toggleAutoReply}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                    data.config.autoReply ? 'bg-[#000]' : 'bg-[#d2d2d7]'
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      data.config.autoReply ? 'left-[calc(100%-22px)]' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            )}
          </SectionCard>

          {/* ── VAC Keyboard ── */}
          <VACKeyboardSection localIp={localIp} />

          {/* ── AI status card ── */}
          <div className="rounded-[18px] border border-[#d2d2d7]/50 bg-[#f5f5f7] p-5 text-sm lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="h-4 w-4 text-[#0071e3]" />
              <span className="font-semibold text-[#1d1d1f]">AI Status</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              {[
                { label: 'Tone analysis', ok: Boolean(data?.provider) },
                { label: 'Smart replies', ok: Boolean(data?.provider) },
                { label: 'Commitment extraction', ok: Boolean(data?.provider) },
                { label: 'Conversation analysis', ok: Boolean(data?.provider) },
              ].map(({ label, ok }) => (
                <div key={label} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 ${ok ? 'bg-green-50 text-green-700' : 'bg-white text-muted-foreground'}`}>
                  {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                  {label}
                </div>
              ))}
            </div>
            {!data?.provider && (
              <div className="mt-3 rounded-xl bg-[#1c1c1e] border border-[#2c2c2e] p-4">
                <p className="text-[13px] font-semibold text-white mb-1">No API key needed</p>
                <p className="text-[12px] text-muted-foreground mb-3">
                  VAC works fully with <strong className="text-white">Ollama</strong> running locally on your Mac — no account, no cost.
                </p>
                <div className="bg-[#111] rounded-lg p-3 font-mono text-[12px] text-green-400 mb-2">
                  brew install ollama<br/>
                  ollama pull llama3.2:3b<br/>
                  ollama serve
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Run these three commands in Terminal, then refresh this page. All AI features activate instantly.
                </p>
              </div>
            )}
          </div>

        </div>
      )}
      </div>{/* end max-w-4xl */}
    </div>
  )
}
