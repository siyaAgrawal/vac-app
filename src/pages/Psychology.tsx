import { useMemo } from 'react'
import { useChatContext } from '../context/ChatContext'

const DEFAULT_PATTERNS = [
  {
    label: 'Warm opener, firm close',
    detail: "Messages open softly and end with a specific ask. That's a sign of clarity, not coldness.",
  },
  {
    label: 'Asymmetric response time',
    detail: "You reply quickly; they take longer. If you feel anxious, the asymmetry is the cause, not the relationship.",
  },
  {
    label: 'Commitments phrased as questions',
    detail: "Both sides soften commitments by phrasing them as questions. Easier on the relationship, harder on accountability.",
  },
]

function derivePsychology(messages: any[], participants: string[]) {
  if (!messages.length) return null

  // Count messages per participant
  const counts: Record<string, number> = {}
  messages.forEach(m => { counts[m.author] = (counts[m.author] || 0) + 1 })
  const total = messages.length
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const top = sorted[0]
  const second = sorted[1]

  // Detect question frequency
  const questions = messages.filter(m => m.body?.includes('?')).length
  const questionPct = Math.round((questions / total) * 100)

  // Message length patterns
  const avgLen = messages.reduce((n, m) => n + (m.body?.length ?? 0), 0) / total

  const patterns = [
    top && second ? {
      label: `${top[0]} leads the conversation`,
      detail: `${top[0]} sends ${Math.round((top[1] / total) * 100)}% of messages. ${second[0]} is more considered in their replies.`,
    } : null,
    {
      label: questionPct > 20 ? 'Highly inquisitive thread' : 'Statement-heavy thread',
      detail: questionPct > 20
        ? `${questionPct}% of messages contain questions — this is a curious, engaged conversation.`
        : `Most messages are statements, not questions. The dynamic is informational rather than exploratory.`,
    },
    {
      label: avgLen > 120 ? 'Long-form communication style' : 'Brief, direct messages',
      detail: avgLen > 120
        ? `Average message length is ${Math.round(avgLen)} characters. Both sides invest in explaining themselves.`
        : `Short messages (avg ${Math.round(avgLen)} chars) suggest efficiency and directness over elaboration.`,
    },
    ...DEFAULT_PATTERNS.slice(2),
  ].filter(Boolean) as { label: string; detail: string }[]

  const leadName = top?.[0] ?? participants[0] ?? 'one participant'
  const relationalRead = `${leadName} drives more of the conversation, but the thread shows balanced engagement. The communication style is ${avgLen > 150 ? 'thoughtful and detailed' : 'direct and efficient'}, with ${questionPct > 20 ? 'strong curiosity on both sides' : 'more statement-driven exchanges'}.`

  return { patterns, relationalRead }
}

export function PsychologyPage() {
  const { activeChat } = useChatContext()

  const analysis = useMemo(() => {
    if (!activeChat?.messages?.length) return null
    return derivePsychology(activeChat.messages, activeChat.participants ?? [])
  }, [activeChat])

  const patterns        = analysis?.patterns ?? DEFAULT_PATTERNS
  const relationalRead  = analysis?.relationalRead
    ?? (activeChat
      ? `You and ${activeChat.label} have a clear communication dynamic. Import more context to deepen the analysis.`
      : 'Import a conversation to see the psychological patterns within it.')
  const contactName = activeChat?.label ?? 'your contact'

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Psychology.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          What's happening between you and {contactName}. Not the tone of a single
          message — the shape of the relationship across the thread.
        </p>
      </section>

      <div className="max-w-3xl">

        {/* Relational read */}
        <div className="border-t border-border py-10">
          <p className="text-[13px] text-muted-foreground mb-4">Relational read</p>
          <p className="text-[20px] leading-[1.45] text-foreground max-w-2xl">
            {relationalRead}
          </p>
        </div>

        {/* Patterns */}
        <div>
          {patterns.slice(0, 5).map((p, i) => (
            <div key={i} className="border-t border-border py-8">
              <p className="text-[15px] font-medium tracking-tight">{p.label}</p>
              <p className="mt-3 text-[15px] leading-[1.55] text-muted-foreground">{p.detail}</p>
            </div>
          ))}
        </div>

        {/* Thread stats */}
        {activeChat && (
          <div className="border-t border-border py-10">
            <p className="text-[13px] text-muted-foreground mb-6">Thread stats</p>
            <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-4">
              {(() => {
                const msgs = activeChat.messages
                const oldest = msgs[0]?.timestamp ? new Date(msgs[0].timestamp) : new Date()
                const daySpan = Math.max(1, Math.ceil((Date.now() - oldest.getTime()) / 86400000))
                const today = new Date().toDateString()
                return [
                  { label: 'Total messages',  value: msgs.length.toLocaleString() },
                  { label: 'Participants',    value: String(activeChat.participants?.length ?? 2) },
                  { label: 'Avg per day',     value: String(Math.round(msgs.length / daySpan)) },
                  { label: 'Messages today',  value: String(msgs.filter(m => new Date(m.timestamp).toDateString() === today).length) },
                ]
              })().map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[12px] text-muted-foreground mb-1">{label}</p>
                  <p className="text-[32px] font-semibold tracking-tight leading-none">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Before you reply */}
        <div className="border-t border-border py-10">
          <p className="text-[13px] text-muted-foreground mb-4">Before you reply</p>
          <p className="text-[20px] leading-[1.45] text-foreground">
            Pause three seconds. If you still want to send it, send it.
          </p>
        </div>

      </div>
    </div>
  )
}
