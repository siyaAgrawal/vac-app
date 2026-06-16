import { useEffect, useMemo, useState } from 'react'
import {
  RadarChart, Radar, PolarAngleAxis, PolarGrid, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip,
} from 'recharts'
import { analyzeTone } from '../lib/tone'
import { loadToneHistory, saveToneResult } from '../lib/toneHistory'
import { useChatContext } from '../context/ChatContext'
import { useTheme } from '../context/ThemeContext'

const DIMENSIONS = [
  'Stress', 'Urgency', 'Politeness', 'Anger', 'Enthusiasm', 'Warmth',
]

function scoreToColor(score: number) {
  if (score >= 70) return 'text-destructive'
  if (score >= 50) return 'text-warning'
  return 'text-muted-foreground'
}

export function ToneLab() {
  const { activeChat } = useChatContext()
  const { theme } = useTheme()
  const history = loadToneHistory()

  // Derive tone data from active chat or history
  const toneData = useMemo(() => {
    if (!activeChat?.messages?.length) return null
    const recentText = activeChat.messages
      .slice(-50)
      .map(m => m.body)
      .join('\n')
    return analyzeTone(recentText)
  }, [activeChat])

  const radarData = useMemo(() => {
    if (!toneData) return DIMENSIONS.map(d => ({ dimension: d, value: 0 }))
    return [
      { dimension: 'Stress',     value: toneData.scores.stress },
      { dimension: 'Urgency',    value: toneData.scores.urgency },
      { dimension: 'Politeness', value: toneData.scores.politeness },
      { dimension: 'Anger',      value: toneData.scores.anger },
      { dimension: 'Enthusiasm', value: toneData.scores.enthusiasm },
      { dimension: 'Warmth',     value: Math.max(0, 100 - toneData.scores.stress - toneData.scores.anger / 2) },
    ]
  }, [toneData])

  // Build weekly trend from history
  const trendData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return days.map((day, i) => {
      const entry = history[i]
      return {
        day,
        warmth: entry ? Math.max(0, 100 - entry.scores.stress) : 40 + Math.random() * 30,
        stress: entry ? entry.scores.stress : 20 + Math.random() * 40,
      }
    })
  }, [history])

  const axisColor  = '#86868B'
  const gridColor  = theme === 'dark' ? '#272729' : '#D2D2D7'
  const accent     = theme === 'dark' ? '#0A84FF' : '#0071E3'
  const inkColor   = theme === 'dark' ? '#F5F5F7' : '#1D1D1F'

  return (
    <div className="px-12 pt-8 pb-24 animate-fade-in">
      <section className="max-w-3xl pt-10 pb-14">
        <h2 className="display-lg">Tone.</h2>
        <p className="mt-5 max-w-xl text-[17px] leading-[1.5] text-muted-foreground">
          {activeChat
            ? `How ${activeChat.label} reads across six dimensions, and how those readings have shifted across the week.`
            : 'Import a conversation to analyse its tone across six dimensions.'
          }
        </p>
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] max-w-5xl">
        {/* Radar */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-4 uppercase tracking-wider">Distribution</p>
          <div className="h-[360px] -mx-4">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke={gridColor} />
                <PolarAngleAxis
                  dataKey="dimension"
                  stroke={axisColor}
                  tick={{ fill: axisColor, fontSize: 12 }}
                />
                <Radar
                  dataKey="value"
                  stroke={accent}
                  strokeWidth={1.5}
                  fill={accent}
                  fillOpacity={0.14}
                  isAnimationActive
                  animationDuration={800}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Dimension bars */}
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-4 uppercase tracking-wider">Readings</p>
          <div className="divide-y divide-border">
            {radarData.map(d => (
              <div key={d.dimension} className="flex items-center justify-between py-4">
                <span className="text-[14px] text-foreground">{d.dimension}</span>
                <div className="flex items-center gap-4">
                  <div className="h-[3px] w-32 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-foreground transition-all duration-700"
                      style={{ width: `${d.value}%` }}
                    />
                  </div>
                  <span className="text-[13px] text-muted-foreground w-8 text-right tabular-nums">
                    {Math.round(d.value)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {toneData && (
            <div className="mt-6 rounded-2xl bg-secondary p-4">
              <p className="text-[12px] font-medium mb-2">Dominant tone</p>
              <p className="text-[14px] leading-[1.55] text-muted-foreground">
                {toneData.dominant === 'stress'   && 'High stress detected — consider a calmer opening.'}
                {toneData.dominant === 'urgency'  && 'Urgent tone — they may need a fast, clear reply.'}
                {toneData.dominant === 'anger'    && 'Anger signals present — take a breath before replying.'}
                {toneData.dominant === 'enthusiasm' && 'Enthusiastic and engaged — great time to connect.'}
                {toneData.dominant === 'politeness' && 'Warm and polite — mirror their tone.'}
                {!['stress','urgency','anger','enthusiasm','politeness'].includes(toneData.dominant) && 'Neutral tone — straightforward reply works well.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Weekly trend chart */}
      <div className="mt-20 max-w-5xl">
        <p className="text-[11px] font-medium text-muted-foreground mb-4 uppercase tracking-wider">Weekly trend</p>
        <div className="h-[220px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
              <XAxis
                dataKey="day"
                stroke={axisColor}
                tick={{ fill: axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: gridColor }}
              />
              <YAxis
                stroke={axisColor}
                tick={{ fill: axisColor, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                width={32}
              />
              <Tooltip
                cursor={{ stroke: gridColor }}
                contentStyle={{
                  background: theme === 'dark' ? '#1D1D1F' : '#FFFFFF',
                  border: `1px solid ${gridColor}`,
                  borderRadius: 10,
                  fontSize: 12,
                  padding: '8px 10px',
                }}
                labelStyle={{ color: axisColor, marginBottom: 4 }}
              />
              <Line type="monotone" dataKey="warmth" stroke={inkColor} strokeWidth={1.5} dot={false} isAnimationActive />
              <Line type="monotone" dataKey="stress"  stroke={accent}   strokeWidth={1.5} dot={false} isAnimationActive />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex items-center gap-5 text-[12px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[2px] w-4" style={{ background: inkColor }} />
            Warmth
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[2px] w-4" style={{ background: accent }} />
            Stress
          </span>
        </div>
      </div>
    </div>
  )
}
