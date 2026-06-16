import { useNavigate, Link } from 'react-router-dom'
import { ArrowUpRight, AlertTriangle, Clock, Users, ArrowRight } from 'lucide-react'
import { loadToneHistory } from '../lib/toneHistory'
import { monthlyTrendFromHistory } from '../lib/tone'
import { useChatContext } from '../context/ChatContext'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-muted-foreground mb-2">{label}</p>
      <p className="text-[40px] font-semibold tracking-tight leading-none">{value}</p>
      {hint && <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const history = loadToneHistory()
  const trend   = monthlyTrendFromHistory(history)
  const { activeChat, chatCommitments, allCommitments, chats } = useChatContext()

  const commitments = activeChat ? chatCommitments : allCommitments
  const overdue     = commitments.filter((c) => c.status === 'overdue').length
  const pending     = commitments.filter((c) => c.status === 'pending' || c.status === 'in-progress').length
  const done        = commitments.filter((c) => c.status === 'completed').length
  const chatCount   = Object.keys(chats).length

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning.'
    if (h < 18) return 'Good afternoon.'
    return 'Good evening.'
  })()

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="max-w-3xl pt-10 pb-20">
        <p className="text-[13px] text-muted-foreground mb-6">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h2 className="display-xl text-foreground">
          {greeting}
          <br />
          <span className="text-muted-foreground">
            {activeChat ? `Working with ${activeChat.label}.` : 'A calm day is ahead.'}
          </span>
        </h2>
        <p className="mt-8 max-w-xl text-[17px] leading-[1.55] text-muted-foreground">
          {activeChat
            ? `${activeChat.messages.length.toLocaleString()} messages · ${pending} open commitments${overdue > 0 ? ` · ${overdue} overdue` : ''}.`
            : `${chatCount} conversations loaded. ${allCommitments.filter(c => c.status !== 'completed').length} open commitments tracked.`
          }
        </p>
        <div className="mt-10 flex items-center gap-3">
          <button
            onClick={() => navigate('/chat')}
            className="btn-pill bg-accent text-accent-foreground hover:opacity-90"
          >
            Open Assistant
          </button>
          <button
            onClick={() => navigate('/commitments')}
            className="btn-pill text-accent hover:opacity-75"
          >
            Review commitments
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </section>

      {/* ── Stats row ─────────────────────────────────────────── */}
      <section className="border-t border-border py-16">
        <div className="grid grid-cols-2 gap-x-16 gap-y-12 md:grid-cols-4">
          <Stat
            label="Conversations"
            value={String(chatCount)}
            hint={chatCount > 0 ? 'Loaded' : 'Import a chat to start'}
          />
          <Stat
            label="Total messages"
            value={Object.values(chats).reduce((n, c) => n + c.messages.length, 0).toLocaleString()}
            hint="Across all chats"
          />
          <Stat
            label="Open commitments"
            value={String(pending + overdue)}
            hint={overdue > 0 ? `${overdue} overdue` : 'All on track'}
          />
          <Stat
            label="Tone analyses"
            value={String(trend.total)}
            hint="This session"
          />
        </div>
      </section>

      {/* ── Active chat focus card ────────────────────────────── */}
      {activeChat && (
        <section className="border-t border-border py-16">
          <p className="text-[13px] text-muted-foreground mb-6">In focus</p>
          <div className="max-w-2xl">
            <h3 className="text-[28px] font-semibold tracking-tight leading-tight">
              {activeChat.label}
            </h3>
            <p className="mt-4 text-[17px] leading-[1.55] text-muted-foreground">
              {activeChat.messages.length.toLocaleString()} messages
              {activeChat.participants?.length > 0 && ` · ${activeChat.participants.join(', ')}`}
              {overdue > 0 && ` · ${overdue} commitment${overdue > 1 ? 's' : ''} overdue`}
            </p>

            {/* Overdue commitments */}
            {overdue > 0 && (
              <div className="mt-6 space-y-2">
                {commitments.filter(c => c.status === 'overdue').slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-xl bg-destructive/8 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" strokeWidth={1.6} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{c.text}</p>
                      <p className="text-[12px] text-muted-foreground mt-0.5">Overdue · {c.dueDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pending commitments */}
            {pending > 0 && (
              <div className="mt-3 space-y-2">
                {commitments.filter(c => c.status === 'pending' || c.status === 'in-progress').slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-start gap-3 rounded-xl bg-secondary px-4 py-3">
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" strokeWidth={1.6} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">{c.text}</p>
                      <p className="text-[12px] text-muted-foreground mt-0.5">Pending · {c.dueDate}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={() => navigate('/chat')}
                className="inline-flex items-center gap-1 text-[15px] font-medium text-accent transition-opacity hover:opacity-75"
              >
                Open assistant
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </button>
              <button
                onClick={() => navigate('/commitments')}
                className="inline-flex items-center gap-1 text-[15px] font-medium text-muted-foreground transition-opacity hover:opacity-75 ml-4"
              >
                View commitments
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Quick access ──────────────────────────────────────── */}
      <section className="border-t border-border py-16">
        <p className="text-[13px] text-muted-foreground mb-8">Quick access</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 max-w-4xl">
          {[
            { to: '/viewer',      label: 'Conversations', desc: 'Import & browse chats' },
            { to: '/chat',        label: 'Assistant',     desc: 'Ask about any chat'    },
            { to: '/commitments', label: 'Commitments',   desc: `${pending + overdue} open` },
            { to: '/tone',        label: 'Tone',          desc: 'Analyse message tone'  },
            { to: '/psychology',  label: 'Psychology',    desc: 'Relationship patterns' },
            { to: '/schedule',    label: 'Scheduling',    desc: 'Time intelligence'     },
            { to: '/live',        label: 'Live Bridge',   desc: 'Real-time WhatsApp'    },
            { to: '/auto-reply',  label: 'Auto-Reply',    desc: 'Automated responses'   },
          ].map(({ to, label, desc }) => (
            <Link
              key={to}
              to={to}
              className="group flex flex-col gap-2 rounded-xl bg-secondary/60 p-4 transition-colors hover:bg-secondary"
            >
              <p className="text-[14px] font-medium">{label}</p>
              <p className="text-[12px] text-muted-foreground">{desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Participants (when active chat) ───────────────────── */}
      {activeChat && activeChat.participants?.length > 0 && (
        <section className="border-t border-border py-16">
          <div className="flex items-center gap-2 mb-6">
            <Users className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
            <p className="text-[13px] text-muted-foreground">Participants in {activeChat.label}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {activeChat.participants.map((name: string) => {
              const count = activeChat.messages.filter((m: any) => m.author === name).length
              return (
                <div key={name} className="flex items-center gap-2.5 rounded-xl bg-secondary px-4 py-2.5">
                  <div className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center text-[11px] font-semibold shrink-0">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium">{name}</p>
                    <p className="text-[11px] text-muted-foreground">{count} messages</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Import CTA (when no chats) ────────────────────────── */}
      {chatCount === 0 && (
        <section className="border-t border-border py-16 text-center">
          <div className="max-w-md mx-auto">
            <h3 className="text-[24px] font-semibold tracking-tight mb-4">
              Start with your last conversation.
            </h3>
            <p className="text-[16px] leading-relaxed text-muted-foreground mb-8">
              Export any WhatsApp chat and import it. Takes 30 seconds.
            </p>
            <Link to="/viewer" className="btn-pill bg-foreground text-background hover:opacity-90 mx-auto">
              Import a chat
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <p className="text-[12px] text-muted-foreground mt-4">
              WhatsApp → open chat → ⋮ → More → Export chat (without media)
            </p>
          </div>
        </section>
      )}

    </div>
  )
}
