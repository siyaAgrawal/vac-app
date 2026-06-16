/** Short, research-informed phrasing templates (educational demo). */

export function replyNecessaryHint(context: 'thanks' | 'fyi' | 'question' | 'thread') {
  switch (context) {
    case 'thanks':
      return {
        need: 'low' as const,
        text: 'Gratitude messages rarely need a reply unless a relationship norm expects it.',
      }
    case 'fyi':
      return {
        need: 'low' as const,
        text: 'FYI updates: a brief acknowledgment builds trust in async teams.',
      }
    case 'question':
      return {
        need: 'high' as const,
        text: 'Direct questions increase perceived responsiveness; set expectations if delayed.',
      }
    default:
      return {
        need: 'medium' as const,
        text: 'Ongoing threads benefit from periodic closure signals.',
      }
  }
}

export function styleForRelation(
  relation: 'friend' | 'professional' | 'mentor',
  topic: string,
) {
  const base = {
    friend: [
      'Lead with warmth: “Hey — quick thing…”',
      'Match their typical message length to avoid feeling formal.',
    ],
    professional: [
      'Use subject + ask + deadline: clear scannable blocks.',
      'Prefer neutral sign-off: “Thanks,” over emoji in formal channels.',
    ],
    mentor: [
      'Show preparation: “I tried X and Y; I’m stuck on Z.”',
      'Ask for one focused opinion rather than open-ended validation.',
    ],
  }
  return { topic, bullets: base[relation] }
}

export function impulseWarning(stress: number, anger: number) {
  if (stress > 0.55 || anger > 0.45) {
    return {
      send: false,
      reason:
        'High arousal states correlate with messages people regret. Draft now, send after a cooldown.',
    }
  }
  if (stress > 0.4) {
    return {
      send: 'delay' as const,
      reason: 'Elevated stress detected — schedule send in 30–60 minutes if possible.',
    }
  }
  return { send: true as const, reason: 'No strong impulse risk from current draft signals.' }
}
