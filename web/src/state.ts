import type { Attempts, Phase, PromptMessage, Ticket } from '../../shared/protocol.js';

export interface AppState {
  connected: boolean;
  sessionId: string | null;
  code: string | null;
  phase: Phase;
  attempts: Attempts;
  paired: boolean;
  prompt: PromptMessage | null;
  photo: string | null;
  tickets: Ticket[];
  /** Set once the call is over. */
  ended: null | 'completed' | 'hangup' | 'timeout' | 'disconnected';
  /** The ticket this caller filed, if any. */
  myTicket: Ticket | null;
  phoneNumber: string | null;
}

export const emptyAttempts = (): Attempts => ({ pairing: 0, language: 0, selfie: 0, humanCheck: 0, ticket: 0 });

export function initialState(): AppState {
  return {
    connected: false,
    sessionId: null,
    code: null,
    phase: 'pairing',
    attempts: emptyAttempts(),
    paired: false,
    prompt: null,
    photo: null,
    tickets: [],
    ended: null,
    myTicket: null,
    phoneNumber: null,
  };
}
