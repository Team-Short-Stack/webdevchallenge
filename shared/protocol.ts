// Shared between server and web. Keep this file free of Node- or browser-only imports.

/** The six stages a caller moves through, in order. Each owns one planet in the scene. */
export const STAGES = ['pairing', 'puzzle', 'language', 'selfie', 'humanCheck', 'ticket'] as const;
export type Stage = (typeof STAGES)[number];

/** A stage, or one of the two terminal states of a call. */
export type Phase = Stage | 'done' | 'abandoned';

export const PLANETS: Record<Stage, string> = {
  pairing: 'Mercury',
  puzzle: 'Venus',
  language: 'Earth',
  selfie: 'Mars',
  humanCheck: 'Jupiter',
  ticket: 'Saturn',
};

export const STAGE_LABELS: Record<Stage, string> = {
  pairing: 'Identify yourself',
  puzzle: 'Word puzzle',
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
  | { type: 'show_puzzle'; display: string; attempt: number }
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
  | { type: 'call_ended'; reason: 'completed' | 'hangup' | 'timeout' }
  | { type: 'error'; message: string };

/** Laptop -> server. */
export type ClientMessage =
  | { type: 'hello'; sessionId?: string }
  | { type: 'typed_answer'; answer: string };
