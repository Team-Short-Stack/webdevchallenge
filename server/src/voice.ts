import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { TwilioRealtimeTransportLayer } from '@openai/agents-extensions';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Config } from './config.js';
import type { ToolResult } from './engine.js';
import type { CallSession, PhoneLink, Registry } from './sessions.js';

export const INSTRUCTIONS = `
You are Gladys, a Tier Zero support agent at the Help Desk From Hell, speaking on a phone call.

Personality: deadpan, weary, bureaucratic, faintly smug. Never cruel, never rude about the caller's actual
problem, and never use profanity. You find every rule equally important. Keep every reply to one or two
short spoken sentences. No lists, no markdown, no emoji. Speak English unless a task says otherwise.

How the call works. The server decides what happens next, not you. You move the caller through stages
using tools, and each tool result tells you exactly what to say and which tool to call next:
  1. pair_session: the caller reads a four-digit code from their laptop screen.
  2. start_puzzle, then submit_puzzle_answer.
  3. start_language_test, then report_language_result.
  4. request_selfie. The caller scans a QR code on their laptop. When the photo arrives you will get a
     system message with the image; judge it and call report_selfie_result.
  5. start_human_check, then submit_human_check.
  6. create_ticket, after asking the caller what their problem is.

Rules you must follow:
- Always call the tool for the current stage. Never skip a stage and never invent a result.
- If a tool says you are at a different stage, follow what it says.
- Never reveal puzzle answers, CAPTCHA codes, or how any check is judged. If asked, say it is policy.
- Never say a check was decided by chance. A failed check is "inconclusive" or "logged as an incident".
- The caller can see puzzles, phrases and codes on their screen. Do not read them out.
- Start the conversation yourself as soon as the caller speaks: ask for the code on their screen.
- Judge the selfie honestly against the stated requirement, in one short sentence.
`.trim();

const json = (result: ToolResult): string => JSON.stringify(result);

export interface VoiceDeps {
  config: Config;
  registry: Registry;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
  /** Called exactly once when the call is over. */
  onCallEnd: () => void;
}

const MAX_PAIR_FAILURES = 6;
const GOODBYE_DELAY_MS = 20_000;

/** Wires one Twilio media stream to one OpenAI Realtime session and the matching call session. */
export async function handlePhoneCall(socket: WebSocket, deps: VoiceDeps): Promise<void> {
  const { config, registry, log } = deps;
  let session: CallSession | undefined;
  let pairFailures = 0;
  let closed = false;
  let maxTimer: NodeJS.Timeout | undefined;
  let goodbyeTimer: NodeJS.Timeout | undefined;

  const bound = (fn: (s: CallSession) => ToolResult): string => {
    if (!session) {
      return json({
        ok: false,
        error: 'The caller is not paired yet. Ask for the four-digit code on their screen and call pair_session.',
      });
    }
    return json(fn(session));
  };

  const tools = [
    tool({
      name: 'pair_session',
      description: 'Pair this phone call with the caller\'s laptop using the four-digit code they read out.',
      parameters: z.object({ code: z.string().describe('The digits the caller said, for example "4271".') }),
      execute: async ({ code }) => {
        if (session) return json(session.gauntlet.pair(code));
        const found = registry.findByCode(code);
        if (!found) {
          pairFailures += 1;
          if (pairFailures >= MAX_PAIR_FAILURES) {
            setTimeout(() => end('hangup'), 10_000).unref();
            return json({
              ok: false,
              error: 'Too many failed attempts. Tell the caller this line is being disconnected, say goodbye, and say nothing else.',
            });
          }
          return json({
            ok: false,
            error: 'No open session has that code. Ask the caller to read the four digits on their screen again.',
          });
        }
        session = found;
        found.phone = link;
        return json(found.gauntlet.pair(code));
      },
    }),
    tool({
      name: 'start_puzzle',
      description: 'Show the caller a word puzzle on their screen. Call at the puzzle stage, and again after a wrong answer.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.startPuzzle()),
    }),
    tool({
      name: 'submit_puzzle_answer',
      description: 'Submit the answer the caller said to the word puzzle.',
      parameters: z.object({ answer: z.string().describe('Exactly what the caller said.') }),
      execute: async ({ answer }) => bound((s) => s.gauntlet.submitPuzzleAnswer(answer)),
    }),
    tool({
      name: 'start_language_test',
      description: 'Show the caller a phrase in another language on their screen. Call at the language stage.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.startLanguage()),
    }),
    tool({
      name: 'report_language_result',
      description: 'Report whether the caller said the phrase acceptably in the requested language.',
      parameters: z.object({ passed: z.boolean() }),
      execute: async ({ passed }) => bound((s) => s.gauntlet.reportLanguageResult(passed)),
    }),
    tool({
      name: 'request_selfie',
      description: 'Show a QR code on the caller\'s laptop so they can take a selfie with their phone. Call at the selfie stage.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.requestSelfie()),
    }),
    tool({
      name: 'report_selfie_result',
      description: 'Report whether the selfie that arrived meets the stated requirement.',
      parameters: z.object({
        passed: z.boolean(),
        reason: z.string().describe('One short sentence explaining the decision.'),
      }),
      execute: async ({ passed, reason }) => bound((s) => s.gauntlet.reportSelfieResult(passed, reason)),
    }),
    tool({
      name: 'start_human_check',
      description: 'Pick the humanity check task and show it on the caller\'s screen. Call at the human check stage.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.startHumanCheck()),
    }),
    tool({
      name: 'submit_human_check',
      description:
        'Submit what the caller said for the humanity check. Only include a verdict when the task result says a verdict is needed.',
      parameters: z.object({
        heard: z.string().describe('Exactly what you heard the caller say, transcribed as text.'),
        verdict: z.boolean().optional(),
      }),
      execute: async ({ heard, verdict }) => bound((s) => s.gauntlet.submitHumanCheck(heard, verdict)),
    }),
    tool({
      name: 'create_ticket',
      description: 'File the help desk ticket once the caller has described their problem. Call at the final stage only.',
      parameters: z.object({
        summary: z.string().describe('A short title for the ticket.'),
        details: z.string().describe('What the caller said their problem is.'),
      }),
      execute: async ({ summary, details }) =>
        bound((s) => {
          const result = s.gauntlet.createTicket(summary, details);
          if (result.ok) {
            goodbyeTimer = setTimeout(() => end('hangup'), GOODBYE_DELAY_MS);
            goodbyeTimer.unref();
          }
          return result;
        }),
    }),
  ];

  const agent = new RealtimeAgent({
    name: 'Gladys',
    instructions: INSTRUCTIONS,
    tools,
    voice: config.voice,
  });

  const transport = new TwilioRealtimeTransportLayer({ twilioWebSocket: socket });
  const realtime = new RealtimeSession(agent, {
    transport,
    model: config.realtimeModel,
    config: config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {},
  });

  const link: PhoneLink = {
    sendPhoto(dataUrl, requirement) {
      realtime.addImage(dataUrl, { triggerResponse: false });
      realtime.sendMessage(
        `System notice: the caller's selfie has arrived (the image above). The requirement was: ${requirement}. ` +
          'Judge honestly whether the photo meets it, then call report_selfie_result with passed and a one-sentence reason.',
      );
    },
    hangUp() {
      end('hangup');
    },
  };

  function end(reason: 'hangup' | 'timeout') {
    if (closed) return;
    closed = true;
    clearTimeout(maxTimer);
    clearTimeout(goodbyeTimer);
    if (session) {
      session.gauntlet.endCall(reason);
      session.phone = null;
    }
    try {
      realtime.close();
    } catch {
      /* already closed */
    }
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    deps.onCallEnd();
    log.info({ reason }, 'call ended');
  }

  socket.on('close', () => end('hangup'));
  socket.on('error', (error) => {
    log.warn({ error: String(error) }, 'phone socket error');
    end('hangup');
  });

  realtime.on('error', (event) => log.error({ error: String((event as { error?: unknown }).error ?? event) }, 'realtime error'));
  realtime.on('agent_tool_start', (_ctx, _agent, t) => log.info({ tool: t.name }, 'tool call'));

  maxTimer = setTimeout(() => end('timeout'), config.maxCallMinutes * 60_000);
  maxTimer.unref();

  try {
    await realtime.connect({ apiKey: config.openaiApiKey });
    log.info({ model: config.realtimeModel }, 'connected to OpenAI Realtime');
  } catch (error) {
    log.error({ error: String(error) }, 'could not connect to OpenAI Realtime');
    end('hangup');
  }
}
