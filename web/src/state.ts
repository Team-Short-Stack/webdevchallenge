import type { Attempts, Phase, PromptMessage, Ticket } from '../../shared/protocol.js';

export interface AppState {
  attempts: Attempts;
  code: string | null;
  connected: boolean;
  ended: null | 'completed' | 'hangup' | 'timeout' | 'disconnected';
  myTicket: Ticket | null;
  paired: boolean;
  phase: Phase;
  phoneNumber: string | null;
  photo: string | null;
  prompt: PromptMessage | null;
  sessionId: string | null;
  tickets: Ticket[];
}

export const emptyAttempts = (): Attempts => ({ pairing: 0, language: 0, selfie: 0, humanCheck: 0, ticket: 0 });

export function initialState(): AppState {
  return {
    attempts: emptyAttempts(),
    code: null,
    connected: false,
    ended: null,
    myTicket: null,
    paired: false,
    phase: 'pairing',
    phoneNumber: null,
    photo: null,
    prompt: null,
    sessionId: null,
    tickets: [],
  };
}
