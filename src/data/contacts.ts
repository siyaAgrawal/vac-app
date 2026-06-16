import type { ContactProfile } from '../types'

export const CONTACTS: ContactProfile[] = [
  {
    id: '1',
    name: 'Alex Rivera',
    relation: 'professional',
    timezone: 'America/New_York',
    activeStart: 9,
    activeEnd: 18,
    politenessAvg: 0.72,
    stressAvg: 0.28,
  },
  {
    id: '2',
    name: 'Sam Okonkwo',
    relation: 'friend',
    timezone: 'Europe/London',
    activeStart: 10,
    activeEnd: 23,
    politenessAvg: 0.55,
    stressAvg: 0.35,
  },
  {
    id: '3',
    name: 'Dr. Mei Chen',
    relation: 'mentor',
    timezone: 'Asia/Singapore',
    activeStart: 8,
    activeEnd: 19,
    politenessAvg: 0.8,
    stressAvg: 0.15,
  },
]
