import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUp, Trash2, Bot } from 'lucide-react'
import type { ChatMessage } from '../types'
import { loadChatHistory, saveChatHistory, clearChatHistory } from '../lib/chatHistory'
import { streamChat } from '../lib/chatClient'
import { useChatContext } from '../context/ChatContext'

const STARTERS = [
  'Summarise key topics and themes',
  'What commitments were made and by whom?',
  'Describe the overall tone of this conversation',
  'What should I reply to the last message?',
  'Are there any unresolved issues or tension?',
  'Draft a professional follow-up message',
  'Analyse the relationship dynamic',
  'What does this person actually want from me?',
]

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

function Msg({ msg, streaming = false }: { msg?: ChatMessage; streaming?: boolean }) {
  const isUser = msg?.role === 'user'
  const text   = msg?.content ?? ''
  return (
    <div className={cn('flex animate-fade-in', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-[20px] px-4 py-2.5 text-[14px] leading-[1.5]',
          isUser
            ? 'bg-accent text-accent-foreground rounded-tr-sm'
            : 'bg-secondary text-foreground rounded-tl-sm',
        )}
      >
        {streaming ? (
          <span className="inline-flex items-center gap-0.5">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        ) : (
          <p className="whitespace-pre-wrap break-words">{text}</p>
        )}
        {msg && (
          <p className={cn('mt-1 text-[10px]', isUser ? 'text-right text-accent-foreground/60' : 'text-muted-foreground')}>
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  )
}

export function ChatPage() {
  const { activeChat, chatCommitments } = useChatContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const [messages, setMessages]         = useState<ChatMessage[]>(() => loadChatHistory())
  const [input, setInput]               = useState('')
  const [streaming, setStreaming]       = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [error, setError]               = useState('')
  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const abortRef   = useRef<AbortController | null>(null)
  const handledRef = useRef('')

  useEffect(() => {
    const p = searchParams.get('prompt')?.trim()
    if (!p || streaming || handledRef.current === p) return
    handledRef.current = p
    void sendMessage(p)
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('prompt'); return n }, { replace: true })
  }, [searchParams])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer, streaming])

  function persist(msgs: ChatMessage[]) {
    setMessages(msgs); saveChatHistory(msgs)
  }

  async function sendMessage(text: string) {
    const t = text.trim()
    if (!t || streaming) return
    setError('')
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', content: t, timestamp: new Date().toISOString(),
    }
    const next = [...messages, userMsg]
    persist(next)
    setInput('')
    setStreaming(true)
    setStreamBuffer('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let acc = ''
    try {
      await streamChat({
        messages: next.slice(-30).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        waContext: activeChat?.plainText ?? undefined,
        activeChatLabel: activeChat?.label ?? undefined,
        signal: ctrl.signal,
        onChunk: (chunk) => { acc += chunk; setStreamBuffer(acc) },
      })
      persist([...next, { id: crypto.randomUUID(), role: 'assistant', content: acc || '(no response)', timestamp: new Date().toISOString() }])
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setStreaming(false)
      setStreamBuffer('')
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(input) }
  }

  const openCount = chatCommitments.filter(c => c.status !== 'completed').length

  return (
    <div className="flex h-full flex-col">

      {/* Empty state */}
      {messages.length === 0 && !streaming && (
        <div className="flex-1 overflow-y-auto px-12">
          <div className="mx-auto max-w-2xl pt-20 pb-10 animate-fade-in">
            <h2 className="display-lg">
              {activeChat
                ? <>What would you like to know about{' '}<span className="text-muted-foreground">{activeChat.label}</span>?</>
                : 'Ask me anything.'
              }
            </h2>
            <p className="mt-5 max-w-xl text-[15px] leading-[1.55] text-muted-foreground">
              {activeChat
                ? `I have the full conversation in context — ${activeChat.messages.length} messages, ${openCount} open commitments. Ask about tone, drafts, or unresolved threads.`
                : 'Import a WhatsApp chat from Conversations, or ask general communication questions.'
              }
            </p>
            <div className="mt-12 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => void sendMessage(s)}
                  className="btn-pill bg-secondary text-foreground hover:opacity-80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      {(messages.length > 0 || streaming) && (
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
          {messages.map(msg => <Msg key={msg.id} msg={msg} />)}
          {streaming && (
            streamBuffer
              ? <Msg msg={{ id: 'stream', role: 'assistant', content: streamBuffer, timestamp: new Date().toISOString() }} />
              : <Msg streaming />
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mx-8 mb-2 rounded-xl bg-destructive/10 px-4 py-2 text-[13px] text-destructive">
          {error}
        </p>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border px-8 py-4">
        <div className="mx-auto max-w-3xl flex items-end gap-3 rounded-2xl border border-border bg-background px-4 py-3 focus-within:ring-2 focus-within:ring-ring/30">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={activeChat ? `Ask about ${activeChat.label}…` : 'Ask anything…'}
            className="flex-1 resize-none bg-transparent text-[14px] leading-[1.5] placeholder:text-muted-foreground focus:outline-none max-h-40"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
            disabled={streaming}
          />
          <div className="flex items-center gap-2 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={() => { clearChatHistory(); setMessages([]) }}
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {streaming ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="h-8 w-8 rounded-full bg-destructive flex items-center justify-center text-white"
              >
                <span className="h-3 w-3 rounded-sm bg-white" />
              </button>
            ) : (
              <button
                onClick={() => void sendMessage(input)}
                disabled={!input.trim()}
                className="h-8 w-8 rounded-full bg-foreground flex items-center justify-center text-background disabled:opacity-30 transition-opacity"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
