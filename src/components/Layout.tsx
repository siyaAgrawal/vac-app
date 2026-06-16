import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMemo, useState } from 'react'
import {
  LayoutGrid, MessageSquareText, Sparkles, ListTodo, Activity,
  Brain, Clock, Wifi, Settings as SettingsIcon, Search, Bot,
  FlaskConical, Keyboard, Radio, Sun, Moon, PanelRight, PanelRightClose,
  Command as CmdIcon,
} from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { useChatContext } from '../context/ChatContext'

const NAV = [
  { to: '/',            label: 'Overview',     icon: LayoutGrid       },
  { to: '/keyboard',    label: 'Keyboard',     icon: Keyboard         },
  { to: '/viewer',      label: 'Conversations',icon: MessageSquareText},
  { to: '/chat',        label: 'Assistant',    icon: Sparkles         },
  { to: '/commitments', label: 'Commitments',  icon: ListTodo         },
  { to: '/tone',        label: 'Tone',         icon: Activity         },
  { to: '/psychology',  label: 'Psychology',   icon: Brain            },
  { to: '/schedule',    label: 'Scheduling',   icon: Clock            },
  { to: '/live',        label: 'Live Bridge',  icon: Wifi             },
  { to: '/auto-reply',  label: 'Auto-Reply',   icon: Bot              },
  { to: '/test-run',    label: 'Test Run',     icon: FlaskConical     },
]

const PAGE_TITLES: Record<string, string> = {
  '/':            'Overview',
  '/keyboard':    'Keyboard',
  '/viewer':      'Conversations',
  '/chat':        'Assistant',
  '/commitments': 'Commitments',
  '/tone':        'Tone',
  '/psychology':  'Psychology',
  '/schedule':    'Scheduling',
  '/live':        'Live Bridge',
  '/auto-reply':  'Auto-Reply',
  '/test-run':    'Test Run',
  '/settings':    'Settings',
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export function Layout() {
  const { pathname } = useLocation()
  const { theme, toggle } = useTheme()
  const { chats, activeId, setActiveId } = useChatContext()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [q, setQ] = useState('')

  const title = useMemo(() => PAGE_TITLES[pathname] || 'Overview', [pathname])

  const chatList = useMemo(() => {
    const entries = Object.entries(chats).map(([id, chat]) => ({
      id,
      name: chat.label,
      lastMessage: chat.messages[chat.messages.length - 1]?.body?.slice(0, 50) || '',
      count: chat.messages.length,
    }))
    if (!q.trim()) return entries
    const lower = q.toLowerCase()
    return entries.filter(e =>
      e.name.toLowerCase().includes(lower) || e.lastMessage.toLowerCase().includes(lower)
    )
  }, [chats, q])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">

      {/* ── Left Sidebar ───────────────────────────────────────── */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-background">

        {/* Brand */}
        <div className="flex h-16 items-center px-6">
          <p className="text-[16px] font-semibold tracking-tight select-none">VĀC</p>
        </div>

        {/* Primary nav */}
        <nav className="px-3 pb-2">
          <ul className="space-y-0.5">
            {NAV.map((n) => {
              const Icon = n.icon
              const active = pathname === n.to
              return (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors duration-150',
                      active
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                    )}
                  >
                    <Icon
                      className={cn('h-[16px] w-[16px] shrink-0', active && 'text-foreground')}
                      strokeWidth={1.6}
                    />
                    <span className="flex-1 truncate">{n.label}</span>
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Conversations */}
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <div className="flex items-center justify-between px-6 pb-3">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Conversations
            </p>
            <span className="text-[12px] text-muted-foreground">
              {Object.keys(chats).length}
            </span>
          </div>

          <div className="px-3 pb-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.6}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                className="h-9 w-full rounded-lg border-0 bg-secondary pl-9 pr-3 text-[14px] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
            {chatList.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 hover:bg-secondary',
                  c.id === activeId && 'bg-secondary',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center text-[11px] font-semibold">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{c.name}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{c.lastMessage || `${c.count} messages`}</p>
                  </div>
                </div>
              </button>
            ))}
            {chatList.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                {q ? 'No matches.' : 'No conversations yet.'}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-3 py-2">
          <NavLink
            to="/settings"
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors',
              pathname === '/settings'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
            )}
          >
            <SettingsIcon className="h-[16px] w-[16px]" strokeWidth={1.6} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────── */}
      <div className="flex flex-1 min-w-0 flex-col border-l border-border">

        {/* Top Bar */}
        <header className="flex h-16 shrink-0 items-center gap-4 px-8 border-b border-border">
          <h1 className="text-[15px] font-medium tracking-tight text-foreground">
            {title}
          </h1>
          <div className="flex-1" />

          {/* Search hint */}
          <button
            className="hidden md:inline-flex items-center gap-2 rounded-full bg-secondary px-3.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.6} />
            <span>Search</span>
            <span className="ml-1 flex items-center gap-0.5 text-[10px] opacity-70">
              <CmdIcon className="h-3 w-3" strokeWidth={1.8} />K
            </span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span className="relative block h-4 w-4">
              <Sun
                className={cn(
                  'absolute inset-0 h-4 w-4 transition-all duration-300',
                  theme === 'dark' ? 'opacity-0 -rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100',
                )}
                strokeWidth={1.6}
              />
              <Moon
                className={cn(
                  'absolute inset-0 h-4 w-4 transition-all duration-300',
                  theme === 'dark' ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-75',
                )}
                strokeWidth={1.6}
              />
            </span>
          </button>

          {/* Inspector toggle */}
          <button
            onClick={() => setInspectorOpen(v => !v)}
            aria-label="Toggle inspector"
            className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {inspectorOpen
              ? <PanelRightClose className="h-4 w-4" strokeWidth={1.6} />
              : <PanelRight className="h-4 w-4" strokeWidth={1.6} />
            }
          </button>
        </header>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          <main className="flex-1 min-w-0 overflow-hidden">
            <div className="h-full overflow-y-auto">
              <Outlet />
            </div>
          </main>

          {/* Right inspector panel */}
          {inspectorOpen && (
            <aside className="hidden lg:block w-[300px] border-l border-border bg-background overflow-y-auto p-6">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Context
              </p>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Select a conversation to see insights here.
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
