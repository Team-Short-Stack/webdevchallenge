/**
 * Twilio opens the media WebSocket right after it receives our TwiML. This gate makes sure a
 * media connection is only accepted shortly after a validated /incoming-call, so a stranger who
 * finds the WebSocket URL cannot open a paid OpenAI session.
 */
export class StreamGate {
  private readonly grants: number[] = [];

  constructor(
    private readonly ttlMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  grant() {
    this.prune();
    this.grants.push(this.now() + this.ttlMs);
  }

  /** Returns true and uses up one grant if a recent /incoming-call is waiting for its stream. */
  consume(): boolean {
    this.prune();
    return this.grants.shift() !== undefined;
  }

  get pending(): number {
    this.prune();
    return this.grants.length;
  }

  private prune() {
    const t = this.now();
    while (this.grants.length > 0 && (this.grants[0] ?? 0) <= t) this.grants.shift();
  }
}
