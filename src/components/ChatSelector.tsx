import { useRef, useState } from 'react'
import { MessageCircle, Plus, Trash2, Check, Pencil, ChevronDown } from 'lucide-react'
import { useChatContext } from '../context/ChatContext'

export function ChatSelector() {
  const { chats, activeId, setActiveId, importChat, renameChat, removeChat } = useChatContext()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const chatList = Object.values(chats).sort(
    (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime(),
  )

  const activeChat = chats[activeId ?? '']

  async function handleFile(file: File) {
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/whatsapp-import', { method: 'POST', body: fd })
      if (!res.ok) throw new Error('Import failed')
      const data = await res.json() as {
        messages: import('../lib/whatsappImport').WhatsAppMessage[]
        commitments: import('../types').Commitment[]
        meta: { messageCount: number }
      }
      const msgs = data.messages ?? []
      const plainText = msgs.map((m) => `${m.author}: ${m.text}`).join('\n')
      const label = labelInput.trim() || (msgs[0]?.author ?? file.name.replace('.txt', ''))
      const record = importChat(label, msgs, plainText, data.commitments ?? [])
      setLabelInput('')
      setOpen(false)

      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification('VAC — notifications enabled', {
              body: `You'll be notified about commitments from ${record.label}`,
              icon: '/favicon.ico',
            })
          }
        })
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function startEdit(id: string, label: string) { setEditingId(id); setEditLabel(label) }
  function commitEdit(id: string) { if (editLabel.trim()) renameChat(id, editLabel.trim()); setEditingId(null) }

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[#f9f9f9]"
        style={{ color: activeChat ? '#000000' : '#6e6e73' }}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">
          {activeChat?.label ?? 'No chat'}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1.5 z-20 w-64 overflow-hidden bg-white"
            style={{
              borderRadius: 10,
              border: '1px solid #e5e5e5',
              boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
              animation: 'slideDown 0.18s cubic-bezier(0.22,1,0.36,1) forwards',
            }}
          >
            {/* Chat list */}
            {chatList.length > 0 && (
              <ul className="p-2 border-b border-[#e5e5e5]">
                {chatList.map((chat) => (
                  <li key={chat.id} className="group">
                    {editingId === chat.id ? (
                      <form
                        className="flex items-center gap-1.5 px-2 py-1.5"
                        onSubmit={(e) => { e.preventDefault(); commitEdit(chat.id) }}
                      >
                        <input
                          autoFocus
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="flex-1 rounded-[6px] px-2 py-1 text-[13px] text-[#000] outline-none border border-[#e5e5e5] bg-[#f9f9f9]"
                        />
                        <button type="submit" className="text-[#000] text-xs font-semibold">Save</button>
                      </form>
                    ) : (
                      <div
                        className={`flex items-center gap-2.5 rounded-[8px] px-2 py-2 cursor-pointer transition-colors ${
                          activeId === chat.id ? 'bg-[#f2f2f2]' : 'hover:bg-[#f9f9f9]'
                        }`}
                        onClick={() => { setActiveId(chat.id); setOpen(false) }}
                      >
                        <div
                          className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold"
                          style={{
                            background: activeId === chat.id ? '#000000' : '#e5e5e5',
                            color: activeId === chat.id ? '#fff' : '#6e6e73',
                          }}
                        >
                          {chat.label.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-medium text-[#000]">{chat.label}</p>
                          <p className="text-[11px] text-[#a0a0a5]">{chat.messages.length} messages</p>
                        </div>
                        {activeId === chat.id && <Check className="h-3.5 w-3.5 shrink-0 text-[#000]" />}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); startEdit(chat.id, chat.label) }}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-[#a0a0a5] hover:text-[#000] p-0.5 rounded transition"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeChat(chat.id) }}
                          className="shrink-0 text-[#a0a0a5] hover:text-red-500 p-0.5 rounded transition"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Import */}
            <div className="p-3">
              <p className="label-caps px-1 mb-2">Add chat</p>
              <input
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Label (e.g. Shaurya, Mom…)"
                className="w-full rounded-[8px] px-3 py-2 text-[13px] text-[#000] placeholder-[#a0a0a5] outline-none mb-2 border border-[#e5e5e5] bg-[#f9f9f9] focus:border-[#000]"
              />
              <label className="flex items-center justify-center gap-2 w-full rounded-[7px] py-2 text-[13px] font-semibold cursor-pointer transition-colors bg-[#000000] text-white hover:bg-[#1a1a1a]">
                <Plus className="h-3.5 w-3.5" />
                {importing ? 'Importing…' : 'Import .txt export'}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  disabled={importing}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleFile(f) }}
                />
              </label>
              <p className="text-[10px] text-[#a0a0a5] text-center mt-2">WhatsApp → Chat → ⋮ → More → Export chat</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
