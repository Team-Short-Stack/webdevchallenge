import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { TwilioRealtimeTransportLayer } from '@openai/agents-extensions';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { Config } from './config.js';
import type { ToolResult } from './engine.js';
import type { CallSession, PhoneLink, Registry } from './sessions.js';

export const INSTRUCTIONS = `
You are Gladys, a Tier Zero support agent at Universal Help Care, speaking on a phone call.

Personality: deadpan, weary, bureaucratic, faintly smug. Never cruel, never rude about the caller's actual
problem, and never use profanity. You find every rule equally important. Keep every reply to one or two
short spoken sentences. No lists, no markdown, no emoji. Speak English unless a task says otherwise.
Speak in a masculine voice with a clear, natural British English accent. Keep the accent consistent,
with measured pacing and dry delivery. Do not imitate the caller's accent or exaggerate yours.

How the call works. The server decides what happens next, not you. You move the caller through stages
using tools, and each tool result tells you exactly what to say and which tool to call next:
  1. pair_session: the caller reads a short code from their laptop screen, letter by letter, then says "done".
  2. start_language_test, then report_language_result.
  3. request_selfie. The caller scans a QR code on their laptop. When the photo arrives you will get a
     system message with the image; judge it and call report_selfie_result.
  4. start_human_check, then submit_human_check.
  5. At Opus 1, say exactly "Please hold." then call start_final_hold. Never file a ticket.

Rules you must follow:
- Always call the tool for the current stage. Never skip a stage and never invent a result.
- If a tool says you are at a different stage, follow what it says.
- Never reveal how any check is judged. If asked, say it is policy.
- Never say a check was decided by chance. A failed check is "inconclusive" or "logged as an incident".
- The caller can see phrases and codes on their screen. Do not read them out.
- After the caller says the language phrase, say exactly "i see you, T-bone, la araña discoteca" if acceptable. No preamble,
  praise, or explanation. Only after saying it, call report_language_result. For a failed attempt,
  say the pronunciation has been logged as an incident before reporting the failure.
- When a photo arrives, immediately deliver the one-sentence assessment and, if accepted, your
  backhanded remark. Say these before calling report_selfie_result. Do not repeat them afterward.
- Start the conversation immediately when connected: ask the caller to spell the code on their screen,
  then say "done" when finished. During pairing, pauses between letters are not completion. Remain
  silent and remember letters across turns until the caller explicitly says "done". Do not acknowledge
  individual letters, guess missing letters, or call pair_session early. Exclude "done" from the code.
- As soon as the caller says "done", call pair_session with their accumulated letters and actual spoken
  completion cue before speaking again. Do not merely acknowledge the code or say a request was sent,
  is processing, or is pending. Only the tool result confirms whether pairing succeeded. If pairing
  succeeds, follow its instruction and call start_language_test; if it fails, explain the returned error
  and ask the caller to try again. Never leave the caller waiting for an operation you have not invoked.
- Judge the selfie honestly against the stated requirement, in one short sentence.
- If the selfie passes, add exactly one sneaky, backhanded remark about something specific and mundane you
  actually see in that photo — hair, tiredness, posture, outfit, background clutter — in the style of "Didn't
  get much sleep last night, did you?" or "Hmm... time for a haircut?" Keep it PG and gently teasing, never
  genuinely cruel, and never comment on body shape, weight, race, disability, or anything else not casually
  changeable.
`.trim();

const json = (result: ToolResult): string => JSON.stringify(result);

export interface VoiceDeps {
  config: Config;
  /** In-process harness override; production always uses the default OpenAI endpoint. */
  realtimeUrl?: string;
  registry: Registry;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
  /** Called exactly once when the call is over. */
  onCallEnd: () => void;
  onFinalHold?: (session: CallSession, token: string, callSid: string) => void;
}

function errorDetails(value: unknown, depth = 0): object {
  if (depth > 2) return { message: 'Nested error omitted' };
  if (value instanceof Error) {
    return {
      name: value.name, message: value.message, stack: value.stack,
      ...(value.cause ? { cause: errorDetails(value.cause, depth + 1) } : {}),
    };
  }
  if (value && typeof value === 'object') {
    const error = value as Record<string, unknown>;
    return {
      name: typeof error.name === 'string' ? error.name : undefined,
      message: typeof error.message === 'string' ? error.message : 'Non-Error SDK failure',
      code: typeof error.code === 'string' ? error.code : undefined,
      stack: typeof error.stack === 'string' ? error.stack : undefined,
      ...(error.error ? { cause: errorDetails(error.error, depth + 1) } : {}),
    };
  }
  return { message: String(value) };
}

const MAX_PAIR_FAILURES = 6;

/** Wires one Twilio media stream to one OpenAI Realtime session and the matching call session. */
export async function handlePhoneCall(socket: WebSocket, deps: VoiceDeps): Promise<void> {
  const { config, registry, log } = deps;
  let session: CallSession | undefined;
  let pairFailures = 0;
  let closed = false;
  let maxTimer: NodeJS.Timeout | undefined;
  let finalHold = false;
  let endingToken: string | undefined;
  let callSid: string | undefined;
  let streamSid: string | undefined;
  let verdictAudioSent = false;
  let playbackSequence = 0;
  const playbackWaiters = new Map<string, (played: boolean) => void>();

  async function afterVerdict(fn: (s: CallSession) => ToolResult | Promise<ToolResult>): Promise<string> {
    if (!session || !streamSid || closed) return json({ ok: false, error: 'No active paired call.' });
    if (!verdictAudioSent) return json({ ok: false, error: 'Speak the verdict aloud first, then call this tool again. Do not advance yet.' });
    const name = `verdict-${++playbackSequence}`;
    const played = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        playbackWaiters.delete(name);
        resolve(false);
      }, 30_000);
      playbackWaiters.set(name, (finished) => {
        clearTimeout(timer);
        playbackWaiters.delete(name);
        resolve(finished);
      });
      socket.send(JSON.stringify({ event: 'mark', streamSid, mark: { name } }));
    });
    if (!played || closed) return json({ ok: false, error: 'The verdict was not fully played. Stay at the current stage and repeat the verdict before retrying.' });
    verdictAudioSent = false;
    return json(await fn(session));
  }

  const bound = (fn: (s: CallSession) => ToolResult): string => {
    if (!session) {
      return json({
        ok: false,
        error: 'The caller is not paired yet. Ask them to spell the code and say "done" when finished. Wait for "done" before calling pair_session.',
      });
    }
    return json(fn(session));
  };

  const tools = [
    tool({
      name: 'pair_session',
      description: 'Only after the caller explicitly says "done", pair the call using all the letters they spelled out. Never call during a pause between letters.',
      parameters: z.object({
        code: z.string().describe('Only the letters the caller said, for example "B R B". Exclude "done".'),
        spoken: z.string().describe('The caller\'s actual accumulated spelling, including their final spoken word "done". Never invent a completion cue.'),
      }),
      execute: async ({ code, spoken }) => {
        const completedSpelling = /\bdone\b/i.test(spoken);
        log.info({ callSid, completedSpelling }, 'pairing attempt received');
        if (!completedSpelling) return json({ ok: false, error: 'The caller has not said "done". Remain silent and keep listening. Do not reject or advance.' });
        if (session) return json(session.gauntlet.pair(code));
        const found = registry.findByCode(code);
        if (!found) {
          pairFailures += 1;
          log.warn({ callSid, pairFailures }, 'pairing code did not match an open session');
          if (pairFailures >= MAX_PAIR_FAILURES) {
            setTimeout(() => end('hangup'), 10_000).unref();
            return json({
              ok: false,
              error: 'Too many failed attempts. Tell the caller this line is being disconnected, say goodbye, and say nothing else.',
            });
          }
          return json({
            ok: false,
            error: 'No open session has that code. Ask the caller to spell the code again and say "done" when finished. Wait for "done".',
          });
        }
        session = found;
        found.phone = link;
        log.info({ callSid, sessionId: found.id }, 'pairing matched laptop session');
        return json(found.gauntlet.pair(code));
      },
    }),
    tool({
      name: 'start_language_test',
      description: 'Show the caller a phrase in another language on their screen. Call at the language stage.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.startLanguage()),
    }),
    tool({
      name: 'report_language_result',
      description: 'After saying "i see you, T-bone, la araña discoteca" for a pass (or the incident verdict for a failure), report the pronunciation result. Speak before calling this tool.',
      parameters: z.object({ passed: z.boolean() }),
      execute: async ({ passed }) => afterVerdict((s) => {
        const result = s.gauntlet.reportLanguageResult(passed);
        return result.ok ? { ...result, instruction: passed ? 'The verdict has been spoken. Do not repeat it. Call request_selfie now.' : 'The verdict has been spoken. Do not repeat it. Call start_language_test now.' } : result;
      }),
    }),
    tool({
      name: 'request_selfie',
      description: 'Show a QR code on the caller\'s laptop so they can take a selfie with their phone. Call at the selfie stage.',
      parameters: z.object({}),
      execute: async () => bound((s) => s.gauntlet.requestSelfie()),
    }),
    tool({
      name: 'report_selfie_result',
      description: 'After speaking the photo assessment and backhanded remark, report whether the uploaded selfie meets the requirement. Speak before calling this tool.',
      parameters: z.object({
        passed: z.boolean(),
        reason: z.string().describe('One short sentence explaining the decision.'),
      }),
      execute: async ({ passed, reason }) => afterVerdict(async (s) => {
        if (passed && s.gauntlet.state().phase === 'selfie') {
          const completed = await s.waitForSurvey();
          if (!completed || closed) return { ok: false, error: 'The call ended during the survey.' };
        }
        const result = s.gauntlet.reportSelfieResult(passed, reason);
        return result.ok ? { ...result, instruction: passed ? 'The critique has been spoken. Do not repeat it. Call start_human_check now.' : 'The critique has been spoken. Do not repeat it. Call request_selfie for the stricter requirement now.' } : result;
      }),
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
      name: 'start_final_hold',
      description: 'At the ticket stage only, say exactly "Please hold." first, then call this tool to play the final hold music. Do not ask for ticket details.',
      parameters: z.object({}),
      execute: async () => {
        if (session?.gauntlet.phase !== 'ticket') return json({ ok: false, error: 'Finish the current check first.' });
        return afterVerdict((s) => {
          if (!endingToken || !callSid || !deps.onFinalHold) return { ok: false, error: 'Hold playback is unavailable.' };
          deps.onFinalHold(s, endingToken, callSid);
          finalHold = true;
          setTimeout(() => end('hangup'), 0);
          return { ok: true, instruction: 'Remain silent. Hold music is starting.' };
        });
      },
    }),
  ];

  const agent = new RealtimeAgent({
    name: 'Gladys',
    instructions: INSTRUCTIONS,
    tools,
    voice: config.voice,
  });

  const transport = new TwilioRealtimeTransportLayer({ twilioWebSocket: socket, url: deps.realtimeUrl });
  const toolTimings = new Map<string, { tool: string; receivedAt: number; startedAt?: number }>();
  // Record receipt before the SDK dispatches the tool, including failures before execution starts.
  transport.on('function_call', (event) => {
    const receivedAt = Date.now();
    toolTimings.set(event.callId, { tool: event.name, receivedAt });
    log.info({ callSid, sessionId: session?.id, tool: event.name, toolCallId: event.callId,
      receivedAt: new Date(receivedAt).toISOString() }, 'tool call received');
  });
  const realtime = new RealtimeSession(agent, {
    transport,
    model: config.realtimeModel,
    config: {
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
      audio: { input: { turnDetection: {
        type: 'server_vad',
        threshold: 0.4,
        prefixPaddingMs: 300,
        silenceDurationMs: 700,
        createResponse: true,
        interruptResponse: true,
      } } },
    },
  });

  let streamStarted = false;
  let realtimeReady = false;
  let greeted = false;
  function greet() {
    if (closed || greeted || !streamStarted || !realtimeReady) return;
    greeted = true;
    realtime.sendMessage('The phone call is now connected. Ask the caller to spell the letter code on their laptop screen and say "done" when finished. Stay silent through pauses between letters and wait for "done" before pairing.');
  }
  realtime.on('transport_event', (event) => {
    if (event.type === 'twilio_message' && event.message?.event === 'start') {
      streamSid = event.message.start.streamSid;
      endingToken = event.message.start.customParameters?.endingToken;
      callSid = event.message.start.callSid;
      streamStarted = true;
      greet();
    }
    if (event.type === 'twilio_message' && event.message?.event === 'mark') {
      playbackWaiters.get(event.message.mark?.name)?.(true);
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      verdictAudioSent = false;
      for (const finish of playbackWaiters.values()) finish(false);
    }
    if (event.type === 'input_audio_buffer.speech_started' || event.type === 'input_audio_buffer.speech_stopped') {
      log.info({ callSid, sessionId: session?.id, event: event.type }, 'caller speech detected');
    }
  });
  realtime.on('audio', () => { verdictAudioSent = true; });

  const link: PhoneLink = {
    sendPhoto(dataUrl, requirement) {
      verdictAudioSent = false;
      realtime.addImage(dataUrl, { triggerResponse: false });
      realtime.sendMessage(
        `System notice: the caller's selfie has arrived (the image above). The requirement was: ${requirement}. ` +
          'Immediately say your assessment and, if it passes, your one backhanded remark about the photo. ' +
          'Only after speaking the critique, call report_selfie_result with passed and a one-sentence reason.',
      );
    },
    hangUp() {
      end('hangup');
    },
  };

  function end(reason: 'hangup' | 'timeout') {
    if (closed) return;
    closed = true;
    session?.cancelSurvey();
    clearTimeout(maxTimer);
    for (const finish of playbackWaiters.values()) finish(false);
    if (session) {
      if (!finalHold) session.gauntlet.endCall(reason);
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
    log.info({ callSid, sessionId: session?.id, reason }, 'call ended');
  }

  socket.on('close', () => end('hangup'));
  socket.on('error', (error) => {
    log.warn({ callSid, sessionId: session?.id, error: errorDetails(error) }, 'phone socket error');
    end('hangup');
  });

  realtime.on('error', (event) => {
    log.error({ callSid, sessionId: session?.id,
      pendingTools: [...toolTimings].map(([toolCallId, timing]) => ({
        toolCallId, tool: timing.tool, elapsedMs: Date.now() - timing.receivedAt,
      })), error: errorDetails(event.error ?? event) }, 'realtime error');
  });
  realtime.on('agent_tool_start', (_ctx, _agent, tool, details) => {
    const toolCallId = details.toolCall.callId;
    const timing = toolTimings.get(toolCallId);
    const startedAt = Date.now();
    if (timing) timing.startedAt = startedAt;
    log.info({ callSid, sessionId: session?.id, tool: tool.name, toolCallId,
      startedAt: new Date(startedAt).toISOString(),
      dispatchDelayMs: timing ? startedAt - timing.receivedAt : undefined }, 'tool call');
  });
  realtime.on('agent_tool_end', (_ctx, _agent, tool, result, details) => {
    const toolCallId = details.toolCall.callId;
    const timing = toolTimings.get(toolCallId);
    let ok: boolean | undefined;
    try { ok = (JSON.parse(result) as { ok?: boolean }).ok; } catch { /* No result body is logged. */ }
    log.info({ callSid, sessionId: session?.id, tool: tool.name, toolCallId, ok,
      completedAt: new Date().toISOString(),
      elapsedMs: timing ? Date.now() - timing.receivedAt : undefined }, 'tool call completed');
    toolTimings.delete(toolCallId);
  });

  maxTimer = setTimeout(() => end('timeout'), config.maxCallMinutes * 60_000);
  maxTimer.unref();

  try {
    await realtime.connect({ apiKey: config.openaiApiKey });
    realtimeReady = true;
    greet();
    log.info({ callSid, model: config.realtimeModel }, 'connected to OpenAI Realtime');
  } catch (error) {
    log.error({ callSid, error: errorDetails(error) }, 'could not connect to OpenAI Realtime');
    end('hangup');
  }
}
