import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, CheckCircle2, ArrowRight, MessageCircle } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'

export function ActionsPage() {
  const { allCommitments, chats, setActiveId } = useChatContext()
  const navigate = useNavigate()

  const overdue = useMemo(() =>
    allCommitments.filter(c => c.status === 'overdue').sort((a, b) =>
      (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    ), [allCommitments])

  const pending = useMemo(() =>
    allCommitments.filter(c => c.status === 'pending' || c.status === 'in-progress')
      .sort((a, b) => {
        const urgencyOrder: Record<string, number> = { emergency: 0, high: 1, medium: 2, low: 3 }
        return (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
      }), [allCommitments])

  const done = allCommitments.filter(c => c.status === 'completed').length

  function goToConversation(c: typeof allCommitments[0]) {
    const chat = Object.values(chats).find(ch =>
      ch.id === c.chatId || ch.label === c.person
    )
    if (chat) { setActiveId(chat.id); navigate(`/c/${chat.id}`) }
  }

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Actions.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          Every open commitment, follow-up, and obligation across all your conversations. Sorted by urgency.
        </p>
      </section>

      <div className="max-w-3xl space-y-0">
        {overdue.length === 0 && pending.length === 0 && (
          <div className="border-t border-border py-16 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-4" strokeWidth={1} />
            <p className="text-[17px] font-medium mb-2">All clear.</p>
            <p className="text-[14px] text-muted-foreground">No open commitments right now.</p>
            {done > 0 && <p className="mt-2 text-[12px] text-muted-foreground">{done} completed this session.</p>}
          </div>
        )}

        {overdue.length > 0 && (
          <>
            <div className="border-t border-border pt-10 pb-4">
              <p className="text-[12px] font-medium text-destructive uppercase tracking-wider">
                Overdue · {overdue.length}
              </p>
            </div>
            {overdue.map(c => (
              <div key={c.id} className="border-t border-border py-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" strokeWidth={1.6} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-snug">{c.text}</p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      {c.person} · Due {c.dueDate ?? 'unknown'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => goToConversation(c)}
                  className="btn-pill bg-secondary text-foreground hover:opacity-80 text-[12px] shrink-0"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Draft reply
                </button>
              </div>
            ))}
          </>
        )}

        {pending.length > 0 && (
          <>
            <div className="border-t border-border pt-10 pb-4">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Pending · {pending.length}
              </p>
            </div>
            {pending.map(c => (
              <div key={c.id} className="border-t border-border py-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.6} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-snug">{c.text}</p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      {c.person}
                      {c.dueDate ? ` · Due ${c.dueDate}` : ''}
                      {' · '}
                      <span className={`font-medium ${c.urgency === 'high' || c.urgency === 'emergency' ? 'text-foreground' : ''}`}>
                        {c.urgency}
                      </span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => goToConversation(c)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
