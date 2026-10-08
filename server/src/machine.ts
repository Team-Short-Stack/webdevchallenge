import { assign, createActor, createMachine, type Actor } from 'xstate';
import { STAGES, type Attempts, type Phase, type Stage } from '../../shared/protocol.js';

export interface MachineContext {
  /** How many times each stage has been entered. 1 means first try. */
  attempts: Attempts;
}

export type MachineEvent =
  | { type: 'PASSED' }
  | { type: 'FAILED' }
  | { type: 'HANGUP' };

function emptyAttempts(): Attempts {
  return { pairing: 0, puzzle: 0, language: 0, selfie: 0, humanCheck: 0, ticket: 0 };
}

/**
 * One machine per call. Every stage is a state, PASSED moves to the next stage,
 * FAILED re-enters the same stage (so entry actions run again and attempts goes up),
 * and HANGUP from anywhere ends the session. Only this machine decides what happens
 * next, which is what stops the voice agent from skipping a stage.
 */
function buildStates() {
  const states: Record<string, unknown> = {};
  STAGES.forEach((stage, i) => {
    const next: Phase = STAGES[i + 1] ?? 'done';
    states[stage] = {
      entry: assign({
        attempts: ({ context }: { context: MachineContext }) => ({
          ...context.attempts,
          [stage]: context.attempts[stage] + 1,
        }),
      }),
      on: {
        PASSED: { target: next },
        FAILED: { target: stage, reenter: true },
        HANGUP: { target: 'abandoned' },
      },
    };
  });
  states['done'] = { type: 'final' };
  states['abandoned'] = { type: 'final' };
  return states;
}

export const gauntletMachine = createMachine({
  id: 'gauntlet',
  types: {} as { context: MachineContext; events: MachineEvent },
  initial: 'pairing',
  context: { attempts: emptyAttempts() },
  states: buildStates() as never,
});

export type GauntletActor = Actor<typeof gauntletMachine>;

export function createGauntletActor(): GauntletActor {
  const actor = createActor(gauntletMachine);
  actor.start();
  return actor;
}

export function phaseOf(actor: GauntletActor): Phase {
  return actor.getSnapshot().value as Phase;
}

export function attemptsOf(actor: GauntletActor): Attempts {
  return actor.getSnapshot().context.attempts;
}

export function isStage(phase: Phase): phase is Stage {
  return (STAGES as readonly string[]).includes(phase);
}
