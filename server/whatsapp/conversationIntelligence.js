/**
 * Conversation Intelligence — deep analysis of a conversation thread.
 *
 * Analyzes the full message history to extract:
 *   - Topic progression
 *   - Emotional arc and current temperature
 *   - Open loops (unanswered questions, pending commitments)
 *   - Who initiates and who follows
 *   - Relationship signals over time
 *
 * This context is injected into the AI prompt so the reply accounts for the
 * whole conversation, not just the latest message.
 */

function isOutbound(m) {
  return m.direction === 'out' || m.sender === 'You' || m.fromMe === true
}

// ── Topic detection ───────────────────────────────────────────────────────────

const TOPIC_PATTERNS = [
  { topic: 'academics / school',    re: /class|school|exam|homework|study|test|assignment|subject|marks|grade|teacher|tuition|padhai|pariksha/i },
  { topic: 'scheduling / plans',    re: /meet|meeting|call|time|schedule|available|when|appointment|today|tomorrow|later|soon|come|pick|kal|aaj|milna|aana|kab/i },
  { topic: 'health',                re: /sick|ill|doctor|hospital|fever|medicine|health|pain|headache|better|worse|rest|covid|beemar|tabiyat|dard|dawa/i },
  { topic: 'apology / conflict',    re: /sorry|apolog|forgive|mistake|wrong|upset|angry|hurt|fight|argument|problem|issue|maafi|galti|gussa|naraaz/i },
  { topic: 'emotional / personal',  re: /love|miss|feel|care|relationship|friend|trust|support|scared|worried|sad|happy|excited|pyaar|yaad|dost|dil/i },
  { topic: 'work / professional',   re: /work|job|project|deadline|task|office|boss|client|presentation|report|meeting|hr|kaam|naukri/i },
  { topic: 'plans / events',        re: /plan|trip|event|party|birthday|celebration|wedding|travel|vacation|holiday|janam din|safar/i },
  { topic: 'money / financial',     re: /money|pay|payment|fee|price|cost|bill|loan|salary|spend|afford|expensive|paisa|kharch|udhaar/i },
  { topic: 'family',                re: /family|mom|dad|parent|sibling|brother|sister|uncle|aunt|grandma|grandpa|relative|ghar|maa|papa|bhai|behen|didi|bhaiya/i },
  { topic: 'urgent request',        re: /urgent|asap|immediately|right now|please|need|help|important|emergency|critical|jaldi|zaruri|please kar/i },
]

function detectTopics(messages) {
  const freq = {}
  for (const m of messages) {
    const text = m.body || ''
    for (const { topic, re } of TOPIC_PATTERNS) {
      if (re.test(text)) freq[topic] = (freq[topic] || 0) + 1
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)
}

// ── Emotional arc ─────────────────────────────────────────────────────────────

const POSITIVE_RE = /happy|great|amazing|love|wonderful|excited|good|okay|perfect|thanks|yay|😊|❤|🎉|awesome|glad/i
const NEGATIVE_RE = /upset|angry|sad|frustrated|disappointed|sorry|worried|bad|stressed|anxious|scared|terrible|awful|😢|😭|💔/i
const URGENT_RE   = /urgent|asap|immediately|please|need|important|critical|help|emergency|!!+/i

function detectEmotionalArc(recent10) {
  const pos     = recent10.filter((m) => POSITIVE_RE.test(m.body || '')).length
  const neg     = recent10.filter((m) => NEGATIVE_RE.test(m.body || '')).length
  const urgent  = recent10.filter((m) => URGENT_RE.test(m.body || '')).length

  if (urgent > 2)               return 'urgent / time-pressured'
  if (neg > pos + 1)            return 'tense / negative — de-escalation may help'
  if (pos > neg * 2)            return 'warm / positive'
  if (neg > 0 && pos > neg)     return 'mixed but improving'
  return 'neutral / calm'
}

// ── Open loops ────────────────────────────────────────────────────────────────

function findOpenLoops(messages) {
  const openLoops = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (isOutbound(m)) continue
    const body = m.body || ''

    // Only care about inbound questions
    if (!/\?/.test(body)) continue

    // Did the user reply AFTER this message?
    const userRepliedAfter = messages.slice(i + 1).some((r) => isOutbound(r))
    if (!userRepliedAfter) {
      openLoops.push(body.slice(0, 120).replace(/\n/g, ' '))
    }
  }

  return openLoops.slice(-3)  // last 3 unanswered questions
}

// ── Pending commitments ───────────────────────────────────────────────────────

const COMMITMENT_RE = /I('ll| will)\s+\w|will (send|call|check|follow|get back|do|fix|handle|share|let you know)|by (monday|tuesday|wednesday|thursday|friday|tomorrow|tonight|EOD)|I promise|I'll make sure/i

function findPendingCommitments(messages) {
  const commitments = []
  for (const m of messages.slice(-20)) {
    if (!isOutbound(m)) continue
    const body = m.body || ''
    if (COMMITMENT_RE.test(body)) {
      commitments.push(body.slice(0, 100).replace(/\n/g, ' '))
    }
  }
  return commitments.slice(-2)
}

// ── Conversation balance ──────────────────────────────────────────────────────

function conversationBalance(messages) {
  const recent  = messages.slice(-20)
  const inCount  = recent.filter((m) => !isOutbound(m)).length
  const outCount = recent.filter((m) =>  isOutbound(m)).length

  if (inCount > outCount * 2) return 'they initiate much more than you'
  if (outCount > inCount * 2) return 'you initiate much more than them'
  return 'balanced — roughly equal back and forth'
}

// ── Conversation closure detection ───────────────────────────────────────────

const CLOSURE_SIGNALS_EN = /^(ok|okay|k|kk|cool|sure|thanks|ty|thx|noted|got it|gotcha|yep|yup|yep yep|alright|fine|right|nice|good|great|perfect|👍|🙏|np|no problem|no worries|sounds good|makes sense|i see|ah|oh|hmm|hm|mm|aight|bet|word|lol|haha|lmao|😂|😊|👌|✅|will do|done|ok cool|ok got it|k thanks|ok thanks|noted thanks|thanks bye|ok bye|bye|talk later|ttyl|cya|see ya|good night|gn|goodnight|sleep well)[\s!.]*$/i
const CLOSURE_SIGNALS_HI = /^(haan|theek|theek hai|accha|ok|okay|kal|sahi|bilkul|bas|thik|chalo|bye|alvida|shukriya|dhanyawad|ho gaya|kar diya|dekh liya|samajh gaya|samajh gayi|pata hai|pata chal gaya|acha theek|ok theek)[\s!.]*$/i

/**
 * Checks if the last inbound message is a clear conversation-ender.
 * Returns { isClosed: bool, signal: string }
 */
export function detectClosureSignals(message, messages) {
  if (!message) return { isClosed: false, signal: '' }
  const t = message.trim()

  // Single emoji / thumbs up
  if (/^(👍|🙏|✅|👌|😊|❤️?|💯)+$/.test(t)) {
    return { isClosed: true, signal: 'single-emoji acknowledgement' }
  }

  // English closure
  if (CLOSURE_SIGNALS_EN.test(t) && !/\?/.test(t)) {
    return { isClosed: true, signal: `english closure: "${t}"` }
  }

  // Hinglish closure
  if (CLOSURE_SIGNALS_HI.test(t) && !/\?/.test(t)) {
    return { isClosed: true, signal: `hinglish closure: "${t}"` }
  }

  // Very short (≤ 3 chars), no question, no emotion
  if (t.length <= 3 && !/\?/.test(t) && !/[❤😍😭😂]/.test(t)) {
    return { isClosed: true, signal: `very short non-question: "${t}"` }
  }

  // Already replied consecutively without a new inbound (over-messaging guard)
  if (messages && messages.length >= 4) {
    const recent = messages.slice(-4)
    const outCount = recent.filter((m) => isOutbound(m)).length
    const inCount  = recent.filter((m) => !isOutbound(m)).length
    // Last 3 messages are all outbound (we've been talking to ourselves)
    if (outCount >= 3 && inCount === 0) {
      return { isClosed: true, signal: 'over-messaging — sent 3+ messages without response' }
    }
  }

  return { isClosed: false, signal: '' }
}

// ── Conflict / defensiveness detection ───────────────────────────────────────

const CONFLICT_RE = /\b(angry|mad|upset|hurt|wrong|unfair|rude|stop|enough|whatever|leave me|don't talk|shut up|seriously|wtf|you always|you never|your fault|blame|argue|fight|problem with you)\b/i

export function detectConflictSignals(messages) {
  const recent = messages?.slice(-8) || []
  const conflictMsgs = recent.filter((m) => !isOutbound(m) && CONFLICT_RE.test(m.body || ''))
  const escalating   = conflictMsgs.length >= 2
  const hasConflict  = conflictMsgs.length >= 1

  // Detect terse-message escalation (short messages back and forth = tension)
  const avgLen = recent.reduce((s, m) => s + (m.body || '').length, 0) / Math.max(recent.length, 1)
  const terseTension = avgLen < 15 && recent.length >= 4

  return {
    hasConflict:  hasConflict || terseTension,
    escalating,
    terseTension,
    level: escalating ? 'high' : hasConflict ? 'medium' : terseTension ? 'low' : 'none',
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns a rich analysis object to inject into the AI prompt.
 * @param {Array} messages - full messages array from memory
 * @returns {object|null}
 */
export function analyzeConversation(messages) {
  if (!messages || messages.length === 0) return null

  const recent10   = messages.slice(-10)
  const recent30   = messages.slice(-30)

  const mainTopics         = detectTopics(recent30)
  const emotionalTrend     = detectEmotionalArc(recent10)
  const openLoops          = findOpenLoops(recent30)
  const pendingCommitments = findPendingCommitments(messages)
  const balance            = conversationBalance(messages)

  // Last exchange summary for the prompt (most recent 6 messages)
  const lastExchange = messages.slice(-6).map((m) => {
    const who = isOutbound(m) ? 'You' : 'Them'
    const body = (m.body || '').slice(0, 80).replace(/\n/g, ' ')
    return `  ${who}: "${body}"`
  }).join('\n')

  // Build the narrative block for prompt injection
  const lines = [
    `Topics discussed: ${mainTopics.length > 0 ? mainTopics.join(', ') : 'general conversation'}`,
    `Emotional temperature: ${emotionalTrend}`,
    `Conversation balance: ${balance}`,
  ]

  if (openLoops.length > 0) {
    lines.push(`Unanswered question(s) from them (open loops to address):\n${openLoops.map((q) => `  - "${q}"`).join('\n')}`)
  }
  if (pendingCommitments.length > 0) {
    lines.push(`Commitments you made earlier (worth following up):\n${pendingCommitments.map((c) => `  - "${c}"`).join('\n')}`)
  }

  return {
    mainTopics,
    emotionalTrend,
    openLoops,
    pendingCommitments,
    balance,
    lastExchange,
    narrative:    lines.join('\n'),
    messageCount: messages.length,
  }
}
