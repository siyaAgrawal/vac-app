import { ExternalLink, BookOpen, BarChart3, Mic, FolderGit2 } from 'lucide-react'

const links = [
  {
    title: 'LinkedIn',
    desc: 'Professional posts and commentary on communication norms.',
    href: 'https://www.linkedin.com',
    icon: ExternalLink,
  },
  {
    title: 'Medium',
    desc: 'Long-form articles on messaging psychology and productivity.',
    href: 'https://medium.com',
    icon: BookOpen,
  },
  {
    title: 'YouTube / Instagram',
    desc: 'Short explainers and visual summaries of research insights.',
    href: 'https://youtube.com',
    icon: ExternalLink,
  },
]

const siteSections = [
  {
    title: 'Ideation repository',
    text: 'Capture message ideas, audience segments, and experiment backlog — mirror in your team wiki or Notion.',
    icon: BookOpen,
  },
  {
    title: 'Survey results & analysis',
    text: 'Aggregate reader polls on reply anxiety, tone preferences, and channel fatigue.',
    icon: BarChart3,
  },
  {
    title: 'Learning resources',
    text: 'Curated papers and books on interpersonal communication, async work, and decision fatigue.',
    icon: BookOpen,
  },
  {
    title: 'Interview insights',
    text: 'Practitioner notes from operators, therapists, and community managers.',
    icon: Mic,
  },
]

export function PresencePage() {
  return (
    <div className="space-y-10 text-left">
      <header>
        <h1 className="font-display text-2xl font-semibold text-white md:text-3xl">
          Multi-platform presence
        </h1>
        <p className="mt-2 max-w-2xl text-slate-400">
          Placeholder hub for blogs, digital zine, and public learning surfaces. Links open in a new
          tab; replace with your real properties and GitHub when ready.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {links.map(({ title, desc, href, icon: Icon }) => (
          <a
            key={title}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl border border-white/10 bg-slate-900/50 p-5 transition-colors hover:border-teal-500/40 hover:bg-slate-900/80"
          >
            <Icon className="h-5 w-5 text-teal-400" />
            <h2 className="mt-3 font-display font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm text-teal-400 group-hover:underline">
              Open <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </a>
        ))}
      </div>

      <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-6">
        <h2 className="font-display text-lg font-semibold text-white">Digital zine</h2>
        <p className="mt-2 text-sm text-slate-400">
          A periodic digest: one theme per issue (e.g. “soft starts”, “hard boundaries”, “thanks
          inflation”). Export from your CMS or static site generator — this panel is a stand-in.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {siteSections.map(({ title, text, icon: Icon }) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
            <Icon className="h-5 w-5 text-slate-500" />
            <h3 className="mt-2 font-display font-semibold text-white">{title}</h3>
            <p className="mt-2 text-sm text-slate-500">{text}</p>
          </div>
        ))}
      </div>

      <a
        href="https://github.com"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/50 p-6 transition-colors hover:border-white/20"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
          <FolderGit2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="font-display font-semibold text-white">GitHub repository</p>
          <p className="text-sm text-slate-400">
            Open-source AI components, issue templates for collaboration — point this to your org repo.
          </p>
        </div>
        <ExternalLink className="ml-auto h-5 w-5 shrink-0 text-slate-500" />
      </a>
    </div>
  )
}
