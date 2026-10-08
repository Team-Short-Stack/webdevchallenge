import { randomBytes } from 'node:crypto';
import {
  type Attempts,
  type Phase,
  type PromptMessage,
  type ServerMessage,
  type Stage,
  type Ticket,
} from '../../shared/protocol.js';
import {
  HUMAN_CHECK_IDS,
  LANGUAGES,
  SELFIE_REQUIREMENTS,
  buildHumanCheck,
  extractNumber,
  normalizeCode,
  pickOne,
  type HumanCheck,
  type HumanCheckId,
  type LanguageCheck,
  type Rng,
} from './content.js';
import {
  attemptsOf,
  createGauntletActor,
  phaseOf,
  type GauntletActor,
} from './machine.js';

/** What a tool returns to the voice agent. The agent reads `instruction` and acts on it. */
export type ToolResult =
  | ({ ok: true; instruction: string } & Record<string, unknown>)
  | { ok: false; error: string };

const ok = (instruction: string, extra: Record<string, unknown> = {}): ToolResult => ({
  ok: true,
  instruction,
  ...extra,
});
const fail = (error: string): ToolResult => ({ ok: false, error });

export interface GauntletOptions {
  /** The pairing code the caller must say (shown on the laptop). */
  code: string;
  emit: (message: ServerMessage) => void;
  saveTicket: (draft: { summary: string; details: string }) => Ticket;
  buildSelfieUrl: (token: string) => string;
  rng?: Rng;
  selfieTtlMs?: number;
  now?: () => number;
}

interface SelfieRequest {
  token: string;
  expiresAt: number;
  requirement: string;
}

/**
 * All of the test logic for one call, with no network code in it. The voice layer calls
 * these methods from tool calls; the HTTP layer calls receivePhoto. Everything the laptop
 * needs to see goes out through `emit`.
 */
export class Gauntlet {
  readonly code: string;
  private readonly actor: GauntletActor;
  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly selfieTtlMs: number;
  private readonly opts: GauntletOptions;

  private language: LanguageCheck | null = null;
  private humanCheck: HumanCheck | null = null;
  private readonly usedHumanChecks = new Set<HumanCheckId>();
  private selfie: SelfieRequest | null = null;
  private photo: string | null = null;
  private lastPrompt: PromptMessage | null = null;
  private ended = false;

  constructor(opts: GauntletOptions) {
    this.opts = opts;
    this.code = opts.code;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.selfieTtlMs = opts.selfieTtlMs ?? 5 * 60_000;
    this.actor = createGauntletActor();

    let previous = this.actor.getSnapshot();
    this.actor.subscribe((snapshot) => {
      if (snapshot === previous) return;
      previous = snapshot;
      this.lastPrompt = null;
      this.opts.emit({ type: 'state_changed', phase: this.phase, attempts: this.attempts });
    });
  }

  // ---------------------------------------------------------------- state

  get phase(): Phase {
    return phaseOf(this.actor);
  }

  get attempts(): Attempts {
    return attemptsOf(this.actor);
  }

  get paired(): boolean {
    return this.phase !== 'pairing';
  }

  get isEnded(): boolean {
    return this.ended;
  }

  state() {
    return {
      phase: this.phase,
      attempts: this.attempts,
      paired: this.paired,
      prompt: this.lastPrompt,
      photo: this.photo,
    };
  }

  private show(prompt: PromptMessage) {
    this.lastPrompt = prompt;
    this.opts.emit(prompt);
  }

  private wrongStage(expected: Stage): ToolResult {
    return fail(
      `Not allowed right now. The caller is at the "${this.phase}" stage, not "${expected}". ` +
        'Do not skip stages. Follow the stage the server reports.',
    );
  }

  private resolve(stage: Stage, passed: boolean, note?: string) {
    this.opts.emit({ type: 'test_result', stage, passed, note });
    this.actor.send({ type: passed ? 'PASSED' : 'FAILED' });
  }

  // -------------------------------------------------------------- pairing

  pair(spoken: string): ToolResult {
    if (this.phase !== 'pairing') return fail(`Already paired. Current stage: ${this.phase}.`);
    if (normalizeCode(spoken) !== normalizeCode(this.code)) {
      this.resolve('pairing', false, 'Unrecognized code');
      return fail('That code does not match. Mock the caller gently and ask for the code on their screen again.');
    }
    this.opts.emit({ type: 'paired' });
    this.resolve('pairing', true);
    return ok(
      'The caller is verified. Welcome them with weary bureaucratic enthusiasm, explain that several ' +
        'mandatory checks stand between them and a ticket, then call start_language_test.',
    );
  }

  // ------------------------------------------------------------- language

  startLanguage(): ToolResult {
    if (this.phase !== 'language') return this.wrongStage('language');
    const firstTry = this.attempts.language === 1;
    const choice = firstTry
      ? pickOne(LANGUAGES, this.rng)
      : pickOne(
          LANGUAGES.filter((l) => l.language !== this.language?.language),
          this.rng,
        );
    this.language = choice;
    this.show({
      type: 'show_language_prompt',
      language: choice.language,
      phrase: choice.phrase,
      meaning: choice.meaning,
    });
    return ok(
      `The phrase is on the caller's screen. Ask them to say it out loud in ${choice.language}. ` +
        `In English it means "${choice.meaning}". Do not say the foreign phrase yourself. ` +
        'Listen to their pronunciation, then call report_language_result with whether it was acceptable.',
    );
  }

  reportLanguageResult(passed: boolean): ToolResult {
    if (this.phase !== 'language') return this.wrongStage('language');
    if (!this.language) return fail('No language check has been issued. Call start_language_test first.');
    this.resolve('language', passed);
    return passed
      ? ok('Say exactly "Eh, close enough!" then call request_selfie.')
      : ok('Rejected. Say the pronunciation has been logged as an incident, then call start_language_test for a new language.');
  }

  // --------------------------------------------------------------- selfie

  requestSelfie(): ToolResult {
    if (this.phase !== 'selfie') return this.wrongStage('selfie');
    const index = Math.min(this.attempts.selfie - 1, SELFIE_REQUIREMENTS.length - 1);
    const requirement = SELFIE_REQUIREMENTS[index];
    if (!requirement) return fail('No selfie requirements configured.');
    const token = randomBytes(18).toString('base64url');
    const expiresAt = this.now() + this.selfieTtlMs;
    this.selfie = { token, expiresAt, requirement };
    this.photo = null;
    this.show({
      type: 'show_qr',
      url: this.opts.buildSelfieUrl(token),
      requirement,
      expiresAt,
    });
    return ok(
      'A QR code is now on the caller\'s laptop screen. Tell them to scan it with their phone camera and ' +
        `take a selfie ${requirement}. Say nothing else until a system message tells you the photo has arrived.`,
      { requirement },
    );
  }

  isSelfieTokenValid(token: string): boolean {
    const s = this.selfie;
    return (
      this.phase === 'selfie' &&
      s !== null &&
      this.photo === null &&
      s.token === token &&
      this.now() < s.expiresAt
    );
  }

  selfieRequirement(token: string): string | null {
    return this.isSelfieTokenValid(token) && this.selfie ? this.selfie.requirement : null;
  }

  /** Called by the HTTP layer when the phone uploads a photo. Returns the requirement to judge against. */
  receivePhoto(token: string, dataUrl: string): { ok: true; requirement: string } | { ok: false; error: string } {
    if (!this.isSelfieTokenValid(token) || !this.selfie) {
      return { ok: false, error: 'This photo link has expired or was already used.' };
    }
    this.photo = dataUrl;
    this.opts.emit({ type: 'selfie_received', photo: dataUrl });
    return { ok: true, requirement: this.selfie.requirement };
  }

  reportSelfieResult(passed: boolean, reason: string): ToolResult {
    if (this.phase !== 'selfie') return this.wrongStage('selfie');
    if (!this.photo) return fail('No photo has arrived yet. Wait for the system message.');
    this.resolve('selfie', passed, reason);
    if (passed) {
      return ok('Photo accepted. Deliver your one sneaky backhanded remark about the photo, then call start_human_check.');
    }
    this.photo = null;
    return ok(
      'Photo rejected. Say why in one sentence, tell the caller a stricter requirement applies, then call request_selfie again.',
    );
  }

  // ---------------------------------------------------------- human check

  startHumanCheck(): ToolResult {
    if (this.phase !== 'humanCheck') return this.wrongStage('humanCheck');
    const unused = HUMAN_CHECK_IDS.filter((id) => !this.usedHumanChecks.has(id));
    const pool = unused.length > 0 ? unused : HUMAN_CHECK_IDS.filter((id) => id !== this.humanCheck?.id);
    const id = pickOne(pool, this.rng);
    this.usedHumanChecks.add(id);
    const check = buildHumanCheck(id);
    this.humanCheck = check;
    this.show({
      type: 'show_human_check',
      title: check.title,
      prompt: check.prompt,
      imageUrl: check.imageUrl,
    });
    return ok(
      `Give the caller this task: "${check.prompt}" ` +
        'There is a photo on their screen; do not describe it or hint at the answer. ' +
        'Then call submit_human_check with exactly what you heard. Leave verdict out.',
    );
  }

  submitHumanCheck(heard: string, verdict?: boolean): ToolResult {
    if (this.phase !== 'humanCheck') return this.wrongStage('humanCheck');
    const check = this.humanCheck;
    if (!check) return fail('No humanity check has been issued. Call start_human_check first.');

    let passed: boolean;
    switch (check.judge) {
      case 'number':
        passed = extractNumber(heard) === check.expected;
        break;
    }
    this.resolve('humanCheck', passed, passed ? undefined : 'Inconclusive');
    return passed
      ? ok('Humanity confirmed, reluctantly. Ask the caller to describe their problem, then call create_ticket.')
      : ok(
          'The result is inconclusive. Do not explain why. Tell the caller the system will try a different ' +
            'verification, then call start_human_check again.',
        );
  }

  // --------------------------------------------------------------- ticket

  createTicket(summary: string, details: string): ToolResult {
    if (this.phase !== 'ticket') return this.wrongStage('ticket');
    const ticket = this.opts.saveTicket({ summary, details });
    this.opts.emit({ type: 'ticket_created', ticket });
    this.actor.send({ type: 'PASSED' });
    return ok(
      `Ticket ${ticket.id} has been filed. Read the ticket number to the caller, tell them someone may ` +
        'respond eventually, thank them for their patience, and say goodbye. Keep it short.',
      { ticketId: ticket.id },
    );
  }

  // ----------------------------------------------------------------- end

  /** Called when the call is over for any reason. Safe to call more than once. */
  endCall(reason: 'hangup' | 'timeout' = 'hangup') {
    if (this.ended) return;
    this.ended = true;
    const finishedNormally = this.phase === 'done';
    if (this.phase !== 'done' && this.phase !== 'abandoned') {
      this.actor.send({ type: 'HANGUP' });
    }
    this.opts.emit({ type: 'call_ended', reason: finishedNormally ? 'completed' : reason });
    this.actor.stop();
  }
}

