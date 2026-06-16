/**
 * VAC Keyboard Assistant
 *
 * Powers the real-time keyboard intelligence layer in the LiveChat UI.
 * Takes the current chat context + optional draft and returns a full
 * KeyboardAssistPayload for the KeyboardComposer component.
 *
 * Payload shape (mirrors KeyboardComposer.tsx):
 *   shouldReply      — whether a reply is warranted
 *   noReplyReason    — why not (if shouldReply is false)
 *   variants         — 4 tap-to-send suggestion chips
 *   deepCompose      — longer draft with tone/intent/why metadata
 *   inline           — completion, rewrite, toneAdjustment for the typing bar
 *   context          — topic, relationship, emotionalState
 *   commitments      — open commitments still pending
 *   sendTiming       — advice on whether to delay sending
 */
import { generateSuggestions, improveDraft } from './suggestMultiple.js'
import { loadMemory, buildStyleProfile } from './memory.js'
import { analyzeConversation, detectConflictSignals } from './conversationIntelligence.js'
import { claudeComplete, getActiveProvider } from '../claudeClient.js'
import { preCheckShouldReply } from './analyzer.js'
import { logger } from '../logger.js'

/**
 * Generate the full keyboard assistance payload.
 * @param {{ chatId: string, draft: string, platform: string }} opts
 * @returns {Promise<import('./types').KeyboardAssistPayload>}
 */
export async function generateKeyboardAssist({ chatId, draft = '', platform = 'whatsapp' }) {
  const mem         = loadMemory(chatId)
  const allMessages = mem.messages || []

  // ── Find the last inbound message ──────────────────────────────────────────
  const lastInbound = [...allMessages].reverse().find(
    (m) => m.direction === 'in' || (m.sender && m.sender !== 'You')
  )
  const lastInboundMsg  = lastInbound?.body  || ''
  const lastInboundFrom = lastInbound?.sender || 'them'

  const empty = buildEmptyPayload()

  if (!lastInboundMsg) {
    return { ...empty, shouldReply: false, noReplyReason: 'No incoming message yet.' }
  }

  // ── Conversation intelligence ───────────────────────────────────────────────
  let convIntel     = null
  let conflictState = { hasConflict: false, level: 'none' }
  try { convIntel     = analyzeConversation(allMessages) } catch (_) {}
  try { conflictState = detectConflictSignals(allMessages) } catch (_) {}

  // ── Closure / pre-check gate ────────────────────────────────────────────────
  const preCheck = preCheckShouldReply(lastInboundMsg, allMessages)
  if (!preCheck.should) {
    return {
      ...empty,
      shouldReply:   false,
      noReplyReason: preCheck.reason || 'Conversation looks complete.',
      context:       buildContext(convIntel, conflictState),
    }
  }

  // ── Get 4 tap-to-send variants ──────────────────────────────────────────────
  let variants = []
  let conflict = conflictState.hasConflict
  try {
    const result = await generateSuggestions({
      chatId,
      message: lastInboundMsg,
      sender:  lastInboundFrom,
    })
    conflict = result.conflict

    if (result.noReplyNeeded) {
      return {
        ...empty,
        shouldReply:   false,
        noReplyReason: result.reason || 'No reply needed.',
        context:       buildContext(convIntel, conflictState),
      }
    }

    variants = (result.suggestions || []).map((s, i) => ({
      id:     `${s.tone}-${i}`,
      text:   s.text,
      tone:   s.label  || s.tone,
      intent: s.reasoning || '',
      why:    s.reasoning || '',
    }))
  } catch (err) {
    logger.error('KeyboardAssist', 'generateSuggestions failed', { error: err.message })
  }

  // ── Improve draft if user is actively typing ────────────────────────────────
  let improved  = draft
  let changes   = []
  const draftWordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0
  if (draftWordCount >= 3) {
    try {
      const res = await improveDraft({ chatId, draft })
      improved  = res.improved || draft
      changes   = res.changes  || []
    } catch (_) {}
  }

  // ── Deep Compose — pick the detailed variant as the main draft ──────────────
  const detailedV = variants.find((v) => /detail/i.test(v.tone))
  const warmV     = variants.find((v) => /warm/i.test(v.tone))
  const baseV     = detailedV || warmV || variants[0]

  // ── Inline AI intelligence ──────────────────────────────────────────────────
  let inline = buildDefaultInline(draft, improved, changes, conflictState)
  const provider = await getActiveProvider()
  if (provider && draftWordCount >= 2) {
    try {
      const styleProfile = buildStyleProfile(chatId)
      const styleLine = styleProfile
        ? `User's style: ${styleProfile.style}, ${styleProfile.formality}, avg ${styleProfile.avgLength} chars.`
        : 'Casual conversational style.'

      const prompt = `You are an inline typing assistant for WhatsApp.
Context — last message received: "${lastInboundMsg}"
User's current draft: "${draft}"
${styleLine}

Return ONLY valid JSON (no markdown):
{
  "completion": "<complete the draft naturally — empty string if draft is empty or complete>",
  "rewrite": "<improved version if needed — same meaning, better phrasing — empty string if draft is already good>",
  "toneAdjustment": "<1-sentence coaching tip about tone — max 12 words>"
}

Rules:
- completion must END the sentence naturally, not repeat the draft
- rewrite must be meaningfully better or identical to draft (not generic)
- toneAdjustment must be specific to this conversation, not generic advice`

      const raw    = await claudeComplete({ messages: [{ role: 'user', content: prompt }], maxTokens: 200, smart: false })
      const clean  = raw.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1))
      inline = {
        completion:     parsed.completion     || '',
        rewrite:        parsed.rewrite        || '',
        toneAdjustment: parsed.toneAdjustment || 'Tone looks natural.',
      }
    } catch (_) {
      // keep default inline
    }
  }

  // ── Commitments & send timing ───────────────────────────────────────────────
  const commitments = buildCommitments(convIntel)
  const sendTiming  = buildSendTiming(allMessages, conflictState)

  logger.info('KeyboardAssist', 'Payload built', {
    chatId, variants: variants.length, conflict, draftWordCount,
  })

  return {
    shouldReply:   true,
    noReplyReason: null,
    variants,
    deepCompose: baseV ? {
      draft:  baseV.text,
      tone:   baseV.tone,
      intent: baseV.intent || 'reply',
      why:    baseV.why    || 'Best full response to this message.',
    } : null,
    inline,
    context:     buildContext(convIntel, conflictState),
    commitments,
    sendTiming,
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildEmptyPayload() {
  return {
    shouldReply:   true,
    noReplyReason: null,
    variants:      [],
    deepCompose:   null,
    inline: {
      completion:     '',
      rewrite:        '',
      toneAdjustment: 'Tone looks good.',
    },
    context: {
      topic:          'general',
      relationship:   'contact',
      emotionalState: 'neutral',
    },
    commitments: [],
    sendTiming: {
      shouldDelay: false,
      label:       'Good to send',
      reason:      'No timing concerns.',
    },
  }
}

function buildDefaultInline(draft, improved, changes, conflictState) {
  return {
    completion:     '',
    rewrite:        (improved && improved !== draft) ? improved : '',
    toneAdjustment: conflictState?.hasConflict
      ? 'De-escalate — acknowledge before your point.'
      : (changes.length > 0 ? changes[0] : 'Tone looks natural.'),
  }
}

function buildContext(convIntel, conflictState) {
  if (!convIntel) {
    return {
      topic:          'general',
      relationship:   'contact',
      emotionalState: conflictState?.hasConflict ? 'tense' : 'neutral',
    }
  }
  return {
    topic:          (convIntel.topics || ['general'])[0] || 'general',
    relationship:   convIntel.relationship || 'contact',
    emotionalState: conflictState?.hasConflict
      ? `tense (${conflictState.level})`
      : (convIntel.emotionalArc || 'neutral'),
  }
}

function buildCommitments(convIntel) {
  if (!convIntel?.openLoops?.length) return []
  return convIntel.openLoops.slice(0, 3).map((loop) => ({
    label: loop.type === 'question' ? 'Unanswered question' : 'Pending commitment',
    text:  (loop.text || loop.body || '').slice(0, 120),
  }))
}

function buildSendTiming(allMessages, conflictState) {
  // Warn if user is double/triple texting
  const recent5        = allMessages.slice(-5)
  const outboundStreak = recent5.filter(
    (m) => m.direction === 'out' || m.sender === 'You'
  ).length

  if (outboundStreak >= 3) {
    return {
      shouldDelay: true,
      label:       'Wait for response',
      reason:      "You've sent several messages — wait for their reply first.",
    }
  }

  if (conflictState?.hasConflict && conflictState.level === 'high') {
    return {
      shouldDelay: true,
      label:       'Take a breath',
      reason:      'Tension is high — a short pause can help.',
    }
  }

  return {
    shouldDelay: false,
    label:       'Good to send',
    reason:      'Timing looks fine.',
  }
}
