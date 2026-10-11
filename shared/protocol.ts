// Shared between server and web. Keep this file free of Node- or browser-only imports.

/** The five stages a caller moves through, in order. Each owns one planet in the scene. */
export const STAGES = ['pairing', 'language', 'selfie', 'humanCheck', 'ticket'] as const;
export type Stage = (typeof STAGES)[number];

/** A stage, or one of the two terminal states of a call. */
export type Phase = Stage | 'done' | 'abandoned';

export const PAIRING_ACRONYMS: Record<string, string> = {
  BRB: 'Be right back',
  LOL: 'Laugh out loud',
  OMG: 'Oh my gosh',
  TBH: 'To be honest',
  LMK: 'Let me know',
  SMH: 'Shaking my head',
  FOMO: 'Fear of missing out',
  YOLO: 'You only live once',
  BTW: 'By the way',
  FYI: 'For your information',
  ASAP: 'As soon as possible',
  AFK: 'Away from keyboard',
  IRL: 'In real life',
  IDK: "I don't know",
  IMO: 'In my opinion',
  IMHO: 'In my humble opinion',
  TTYL: 'Talk to you later',
  BFF: 'Best friends forever',
  ROFL: 'Rolling on the floor laughing',
  JK: 'Just kidding',
  ICYMI: 'In case you missed it',
  DIY: 'Do it yourself',
  FAQ: 'Frequently asked questions',
  RSVP: "Répondez s'il vous plaît (Please respond)",
};

export const PLANETS: Record<Stage, string> = {
  pairing: 'Lolzitron',
  language: 'Translatopia',
  selfie: 'Snapturn',
  humanCheck: 'Lengsdwarf',
  ticket: 'Opus 1',
};

export const STAGE_LABELS: Record<Stage, string> = {
  pairing: 'Identify yourself',
  language: 'Language check',
  selfie: 'Photo ID',
  humanCheck: 'Humanity check',
  ticket: 'File a ticket',
};

export interface Ticket {
  id: string;
  summary: string;
  details: string;
  createdAt: string;
}

export type Attempts = Record<Stage, number>;

/** What the laptop shows for the current stage. Replayed on reconnect via the snapshot. */
export type PromptMessage =
  | { type: 'show_language_prompt'; language: string; phrase: string; meaning: string }
  | { type: 'show_qr'; url: string; requirement: string; expiresAt: number }
  | { type: 'show_human_check'; title: string; prompt: string; imageUrl?: string };

/** Server -> laptop. */
export type ServerMessage =
  | PromptMessage
  | {
      type: 'snapshot';
      sessionId: string;
      code: string;
      phase: Phase;
      attempts: Attempts;
      paired: boolean;
      prompt: PromptMessage | null;
      photo: string | null;
      tickets: Ticket[];
    }
  | { type: 'state_changed'; phase: Phase; attempts: Attempts }
  | { type: 'paired' }
  | { type: 'selfie_received'; photo: string }
  | { type: 'test_result'; stage: Stage; passed: boolean; note?: string }
  | { type: 'ticket_created'; ticket: Ticket; /** True only on the laptop of the caller who filed it. */ mine?: boolean }
  | { type: 'call_ended'; reason: 'completed' | 'hangup' | 'timeout' | 'disconnected' }
  | { type: 'error'; message: string };

/** Laptop -> server. */
export type ClientMessage = { type: 'hello'; sessionId?: string };
