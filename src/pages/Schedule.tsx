import { useMemo } from 'react'
import { useChatContext } from '../context/ChatContext'
import { suggestSendWindow, recipientLocalParts } from '../lib/schedule'
import { CONTACTS } from '../data/contacts'

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

// Engagement probability by hour (0–23) — mirrors Emergent's WINDOW
const ENGAGEMENT_BY_HOUR = Array.from({ length: 24 }, (_, h) => {
  if (h < 7)  return 0.05
  if (h < 9)  return 0.35
  if (h < 11) return 0.90
  if (h < 13) return 0.75
  if (h < 14) return 0.55
  if (h < 17) return 0.85
  if (h < 19) return 0.65
  if (h < 21) return 0.35
  return 0.10
})

export function SchedulePage() {
  const { activeChat } = useChatContext()
  const currentHour = new Date().getHours()

  const contact = useMemo(() => {
    if (!activeChat) return null
    return CONTACTS.find(c =>
      c.name.toLowerCase().includes(activeChat.label.toLowerCase()) ||
      activeChat.label.toLowerCase().includes(c.name.toLowerCase())
    ) ?? CONTACTS[0]
  }, [activeChat])

  const { localTime, tzLabel } = useMemo(() => {
    if (!contact?.timezone) return { localTime: '', tzLabel: 'Unknown timezone' }
    const parts = recipientLocalParts(contact.timezone)
    return { localTime: parts.label, tzLabel: contact.timezone }
  }, [contact])

  const window = useMemo(() => {
    if (!contact) return null
    return suggestSendWindow(contact.timezone)
  }, [contact])

  const contactName = activeChat?.label?.split(' ')[0] ?? 'them'

  // Build hourly bars — adjust WINDOW to contact's timezone offset if available
  const bars = ENGAGEMENT_BY_HOUR

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Scheduling.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          The best time to reply to {contactName} isn't always now. VĀC reads
          their timezone and activity patterns to suggest a considerate window.
        </p>
      </section>

      <div className="max-w-4xl">
        <div className="border-t border-border py-10">
          <p className="text-[13px] text-muted-foreground mb-2">Send window</p>
          <p className="text-[15px] text-foreground mb-10">
            {contact ? tzLabel : 'No contact loaded — import a conversation to see scheduling'}
            {localTime && ` · Currently ${localTime} for them`}
          </p>

          {/* Hour bar chart */}
          <div className="flex items-end gap-[2px] h-32">
            {bars.map((v, i) => (
              <div key={i} className="relative flex-1" style={{ height: '100%' }}>
                <div
                  className={cn(
                    'absolute bottom-0 w-full rounded-sm transition-all duration-500',
                    i === currentHour
                      ? 'bg-accent'
                      : v > 0.7
                        ? 'bg-foreground'
                        : v > 0.4
                          ? 'bg-foreground/35'
                          : 'bg-secondary',
                  )}
                  style={{ height: `${v * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-muted-foreground">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 mr-4">
              <span className="h-2 w-2 rounded-sm bg-accent inline-block" /> Now
            </span>
            <span className="inline-flex items-center gap-1 mr-4">
              <span className="h-2 w-2 rounded-sm bg-foreground inline-block" /> High engagement
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-secondary inline-block border border-border" /> Low engagement
            </span>
          </p>
        </div>

        <div className="border-t border-border py-10">
          <p className="text-[13px] text-muted-foreground mb-4">Recommendation</p>
          <p className="text-[20px] leading-[1.45] text-foreground max-w-2xl">
            {window?.recommendation
              ?? (currentHour >= 9 && currentHour <= 17
                ? `Send now — it's within their likely active window and you have open context.`
                : `Wait until morning. Their replies cluster in the 9–11 AM window when they're most responsive.`)}
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {[
              'Send now',
              window?.suggestedTime ? `Send at ${window.suggestedTime}` : 'Send at 10:00 AM',
              'Remind me later',
            ].map((opt, i) => (
              <button
                key={i}
                className="btn-pill bg-secondary text-foreground hover:opacity-80"
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* All loaded contacts */}
        {CONTACTS.length > 0 && (
          <div className="border-t border-border py-10">
            <p className="text-[13px] text-muted-foreground mb-6">Contact timezones</p>
            <div className="space-y-0">
              {CONTACTS.slice(0, 8).map(c => {
                const parts = recipientLocalParts(c.timezone)
                const inconvenient = parts.hour < 8 || parts.hour > 21
                return (
                  <div key={c.name} className="flex items-center justify-between border-b border-border py-4 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-[11px] font-semibold shrink-0">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-[14px] font-medium">{c.name}</p>
                        <p className="text-[12px] text-muted-foreground">{c.timezone}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-[14px]', inconvenient ? 'text-destructive' : 'text-foreground')}>
                        {parts.label}
                      </p>
                      <p className="text-[12px] text-muted-foreground">{inconvenient ? 'Not ideal' : 'Good window'}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
