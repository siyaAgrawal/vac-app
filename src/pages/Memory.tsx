import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brain, ArrowRight } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'

export function MemoryPage() {
  const { chats, allCommitments, setActiveId } = useChatContext()
  const navigate = useNavigate()

  const people = useMemo(() => {
    return Object.values(chats).map(chat => {
      const commitments = allCommitments.filter(c =>
        c.chatId === chat.id || c.person === chat.label
      )
      const messageCount = chat.messages.length
      const lastMessage = chat.messages[chat.messages.length - 1]

      // Compute rough relationship stats
      const questionCount = chat.messages.filter(m => (m.body ?? '').includes('?')).length
      const questionRatio = messageCount > 0 ? questionCount / messageCount : 0

      const myMessages = chat.messages.filter(m => m.author === 'Me' || m.isFromUser)
      const myRatio = messageCount > 0 ? myMessages.length / messageCount : 0.5

      return {
        chat,
        commitments,
        messageCount,
        lastMessage,
        questionRatio,
        myRatio,
        openCommitments: commitments.filter(c => c.status !== 'completed').length,
      }
    }).sort((a, b) => b.openCommitments - a.openCommitments || b.messageCount - a.messageCount)
  }, [chats, allCommitments])

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Memory.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          What VAC knows about your relationships. Patterns, commitments, communication styles, and history.
        </p>
      </section>

      {people.length === 0 ? (
        <div className="max-w-3xl border-t border-border py-16 text-center">
          <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto mb-4" strokeWidth={1} />
          <p className="text-[17px] font-medium mb-2">Memory builds over time.</p>
          <p className="text-[14px] text-muted-foreground">
            Import conversations to start building relationship intelligence.
          </p>
        </div>
      ) : (
        <div className="max-w-3xl space-y-0">
          {people.map(({ chat, messageCount, myRatio, questionRatio, openCommitments }) => (
            <div key={chat.id} className="border-t border-border py-8">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center text-[14px] font-semibold shrink-0 mt-0.5">
                    {chat.label?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[15px] font-medium">{chat.label}</p>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {messageCount.toLocaleString()} messages
                      {openCommitments > 0 && ` · ${openCommitments} open commitment${openCommitments > 1 ? 's' : ''}`}
                    </p>

                    {/* Relationship insights */}
                    <div className="mt-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground mt-2 shrink-0" />
                        <p className="text-[13px] text-muted-foreground">
                          {myRatio > 0.6
                            ? `You send ${Math.round(myRatio * 100)}% of messages — you drive this conversation.`
                            : myRatio < 0.4
                              ? `They send ${Math.round((1 - myRatio) * 100)}% of messages — they drive this conversation.`
                              : 'Balanced message exchange — mutual engagement.'}
                        </p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground mt-2 shrink-0" />
                        <p className="text-[13px] text-muted-foreground">
                          {questionRatio > 0.25
                            ? 'Highly inquisitive — lots of questions on both sides.'
                            : 'Statement-driven — mostly informational exchanges.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setActiveId(chat.id); navigate(`/c/${chat.id}`) }}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
                >
                  <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
