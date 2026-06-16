/** Local heuristic tone lab (radar / history) */
export type ToneLabel = 'stress' | 'anger' | 'politeness' | 'enthusiasm' | 'neutral'

export interface ToneScores {
  stress: number
  anger: number
  politeness: number
  enthusiasm: number
  neutral: number
}

export interface HeuristicToneAnalysis {
  id: string
  at: string
  messagePreview: string
  dominant: ToneLabel
  scores: ToneScores
  explanation: string[]
  suggestions: string[]
  contactId?: string
}

/** Anthropic Claude JSON analysis */
export interface AnthropicToneAnalysis {
  tone_tags: string[]
  tone_score: number
  urgency: number
  clarity: number
  sentiment: number
  intent_clarity: number
  trust: number
  overall_score: number
  observations: string[]
  commitments: string[]
  suggested_reply: string | null
  /** 'rules' when AI was unavailable and server fell back to heuristics */
  _source?: 'rules' | 'ai'
}

export interface AnalysisHistory {
  id: string
  snippet: string
  tags: string[]
  score: number
  time: string
  fullText: string
}

export type Urgency = 'low' | 'medium' | 'high' | 'emergency'

export type CommitmentStatus = 'pending' | 'in-progress' | 'completed' | 'overdue'

export interface FulfillmentCheck {
  checkedAt: string
  fulfilled: boolean
  confidence: number
  reasoning: string
  suggestion: string | null
  evidence?: string
}

export interface Commitment {
  id: string
  text: string          // Short action summary (what needs to be done)
  person: string        // Who this commitment was made TO (their name/display name)
  action: string        // Explicit description of the action (same as text or more detailed)
  chatId?: string       // Source WhatsApp chat ID (for linking back)
  urgency: Urgency
  status: CommitmentStatus
  dueDate: string
  dueTime: string
  source: string        // Human-readable source label e.g. "WhatsApp – Rahul"
  createdAt: string
  notifyBefore: number  // minutes before due to notify
  notified: boolean
  tags: string[]
  fulfillmentCheck?: FulfillmentCheck
}

/** In-app + toast notification record (not the browser Notification API). */
export interface InAppNotification {
  id: string
  commitmentId: string
  title: string
  message: string
  type: 'pending' | 'due' | 'emergency' | 'completed' | 'overdue'
  timestamp: string
  read: boolean
}

export interface ContactProfile {
  id: string
  name: string
  relation: 'friend' | 'professional' | 'mentor'
  timezone: string
  activeStart: number
  activeEnd: number
  politenessAvg: number
  stressAvg: number
}

/** Chat assistant message */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

