import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ServerMessage, Ticket } from '../../shared/protocol.js';
import { PAIRING_CODES, normalizeCode } from './content.js';
import { Gauntlet } from './engine.js';

/** In-memory ticket list, shared by every laptop. Swap for SQLite if tickets should survive restarts. */
export class TicketStore {
  private readonly tickets: Ticket[] = [];
  private counter = 0;

  add(draft: { summary: string; details: string }): Ticket {
    this.counter += 1;
    const ticket: Ticket = {
      id: `UHC-${String(this.counter).padStart(4, '0')}`,
      summary: draft.summary.slice(0, 200),
      details: draft.details.slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    this.tickets.push(ticket);
    return ticket;
  }

  recent(limit = 20): Ticket[] {
    return this.tickets.slice(-limit).reverse();
  }
}

/** The link between a running call and the Twilio/OpenAI side. Set once the call pairs. */
export interface PhoneLink {
  /** Hand the caller's photo to the voice model and ask it to judge. */
  sendPhoto(dataUrl: string, requirement: string): void;
  /** Hang up on the caller. */
  hangUp(): void;
}

export class CallSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  readonly laptops = new Set<WebSocket>();
  readonly gauntlet: Gauntlet;
  phone: PhoneLink | null = null;

  constructor(
    readonly code: string,
    private readonly tickets: TicketStore,
    private readonly broadcastToAll: (message: ServerMessage, except: CallSession) => void,
    buildSelfieUrl: (token: string) => string,
  ) {
    this.gauntlet = new Gauntlet({
      code,
      buildSelfieUrl,
      saveTicket: (draft) => {
        const ticket = this.tickets.add(draft);
        return ticket;
      },
      emit: (message) => {
        // Ticket creation is visible on every laptop; everything else is private to this call.
        if (message.type === 'ticket_created') {
          this.send({ ...message, mine: true });
          this.broadcastToAll(message, this);
        } else {
          this.send(message);
        }
      },
    });
  }

  send(message: ServerMessage) {
    const text = JSON.stringify(message);
    for (const socket of this.laptops) {
      if (socket.readyState === socket.OPEN) socket.send(text);
    }
  }

  snapshot(): ServerMessage {
    const s = this.gauntlet.state();
    return {
      type: 'snapshot',
      sessionId: this.id,
      code: this.code,
      phase: s.phase,
      attempts: s.attempts,
      paired: s.paired,
      prompt: s.prompt,
      photo: s.photo,
      tickets: this.tickets.recent(),
    };
  }
}

export class Registry {
  readonly tickets = new TicketStore();
  private readonly sessions = new Map<string, CallSession>();

  constructor(private readonly buildSelfieUrl: (token: string) => string) {}

  create(): CallSession {
    let code: string;
    do {
      const picked = PAIRING_CODES[randomInt(0, PAIRING_CODES.length)];
      if (picked === undefined) throw new Error('PAIRING_CODES is empty.');
      code = picked;
    } while (this.findByCode(code));
    const session = new CallSession(
      code,
      this.tickets,
      (message, except) => this.broadcastAll(message, except),
      this.buildSelfieUrl,
    );
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): CallSession | undefined {
    return this.sessions.get(id);
  }

  /** Only sessions still waiting to be paired can be found by their code. */
  findByCode(spoken: string): CallSession | undefined {
    const code = normalizeCode(spoken);
    for (const session of this.sessions.values()) {
      if (session.code === code && !session.gauntlet.isEnded && !session.phone) return session;
    }
    return undefined;
  }

  findBySelfieToken(token: string): CallSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.gauntlet.isSelfieTokenValid(token)) return session;
    }
    return undefined;
  }

  broadcastAll(message: ServerMessage, except?: CallSession) {
    for (const session of this.sessions.values()) {
      if (session !== except) session.send(message);
    }
  }

  /** Drop sessions that have no laptop attached and have been idle for a while. */
  sweep(maxIdleMs = 30 * 60_000) {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.laptops.size === 0 && now - session.createdAt > maxIdleMs) {
        session.gauntlet.endCall('hangup');
        this.sessions.delete(id);
      }
    }
  }

  get size() {
    return this.sessions.size;
  }
}
