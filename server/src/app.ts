import { existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import fastifyFormBody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import twilio from 'twilio';
import { z } from 'zod';
import type { ClientMessage } from '../../shared/protocol.js';
import { maskNumber, type Config } from './config.js';
import { StreamGate } from './gate.js';
import { Registry, type CallSession } from './sessions.js';
import { handlePhoneCall } from './voice.js';

export async function buildApp(config: Config, options: { logger?: boolean } = {}) {
const app = Fastify({ logger: options.logger === false ? false : { level: 'info' }, bodyLimit: 1024 * 1024 });

  const publicBase = (hostHeader: string | undefined, protoHeader: string | undefined): string =>
  config.publicBaseUrl ?? `${protoHeader ?? 'https'}://${hostHeader ?? `localhost:${config.port}`}`;

const registry = new Registry(
  (token) => `${config.publicBaseUrl ?? `http://localhost:${config.port}`}/selfie.html?t=${token}`,
);
const gate = new StreamGate();
let activeCalls = 0;
const finalHolds = new Map<string, { session: CallSession; callSid: string; timer: NodeJS.Timeout }>();
const devPhoneAttempts = new Map<string, { startedAt: number; count: number }>();
app.addHook('onClose', async () => {
  for (const hold of finalHolds.values()) clearTimeout(hold.timer);
});

await app.register(fastifyFormBody);
await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

// Photos arrive as a raw image body from the selfie page.
app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp'], { parseAs: 'buffer', bodyLimit: 6 * 1024 * 1024 }, (_req, body, done) => {
  done(null, body);
});

// ---------------------------------------------------------------- health

app.get('/healthz', async () => ({ ok: true, sessions: registry.size, activeCalls }));

// Public settings the laptop app needs.
app.get('/api/config', async () => ({ phoneNumber: config.phoneDisplayNumber ?? null }));
app.get('/api/dev-phone/config', async (_request, reply) => {
  if (!config.enableDevPhone) return reply.code(404).send({ error: 'Dev Phone is disabled.' });
  return { enabled: true, phoneNumber: config.twilioPhoneNumber };
});

app.post('/api/dev-phone/token', async (request, reply) => {
  if (!config.enableDevPhone || !config.twilioTwimlAppSid || !config.twilioApiKey || !config.twilioApiSecret || !config.twilioAccountSid) {
    return reply.code(404).send({ error: 'Dev Phone is disabled.' });
  }
  const now = Date.now();
  const attempt = devPhoneAttempts.get(request.ip);
  if (attempt && now - attempt.startedAt < 60_000 && attempt.count >= 5) {
    return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
  }
  if (!attempt || now - attempt.startedAt >= 60_000) devPhoneAttempts.set(request.ip, { startedAt: now, count: 1 });
  else attempt.count += 1;
  const { accessCode } = (request.body ?? {}) as { accessCode?: unknown };
  const supplied = typeof accessCode === 'string' ? Buffer.from(accessCode) : Buffer.alloc(0);
  const expected = Buffer.from(config.devPhoneAccessCode ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply.code(401).send({ error: 'Incorrect access code.' });
  }
  const identity = `dev_${randomUUID().replaceAll('-', '')}`;
  const token = new twilio.jwt.AccessToken(config.twilioAccountSid, config.twilioApiKey, config.twilioApiSecret, { identity, ttl: 900 });
  token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({ outgoingApplicationSid: config.twilioTwimlAppSid, incomingAllow: false }));
  return { token: token.toJwt(), identity, phoneNumber: config.twilioPhoneNumber };
});

// ---------------------------------------------------------------- Twilio

function rejectCall(reply: import('fastify').FastifyReply, message: string) {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: 'Polly.Brian-Neural', language: 'en-GB' }, message);
  vr.hangup();
  return reply.type('text/xml').send(vr.toString());
}

if (config.voiceTransport === 'legacy') app.post('/incoming-call', async (request, reply) => {
  const params = (request.body ?? {}) as Record<string, string>;
  const base = publicBase(request.headers.host, request.headers['x-forwarded-proto'] as string | undefined);

  if (config.twilioAuthToken) {
    const signature = request.headers['x-twilio-signature'];
    const valid =
      typeof signature === 'string' &&
      twilio.validateRequest(config.twilioAuthToken, signature, `${base}${request.url}`, params);
    if (!valid) {
      request.log.warn('rejected /incoming-call with a bad or missing Twilio signature');
      return reply.code(403).send('Forbidden');
    }
  }

  const from = params.From;
  if (config.allowedCallers.length > 0 && (!from || (!from.startsWith('client:dev_') && !config.allowedCallers.includes(from)))) {
    request.log.warn({ from: maskNumber(from) }, 'rejected caller not on the allow list');
    return rejectCall(reply, 'This line is closed to you. Please try again never.');
  }
  if (activeCalls + gate.pending >= config.maxConcurrentCalls) {
    request.log.warn({ activeCalls }, 'rejected call: at the concurrent call limit');
    return rejectCall(reply, 'All of our agents are busy ignoring other callers. Please try again later.');
  }

  gate.grant();
  request.log.info({ from: maskNumber(from) }, 'incoming call accepted');

  const vr = new twilio.twiml.VoiceResponse();
  vr.say(
    { voice: 'Polly.Brian-Neural', language: 'en-GB' },
    'Thank you for calling Universal Help Care. Your call is important to us. Please find the letter code on your screen, and spell it out when prompted.',
  );
  const connect = vr.connect();
  const token = randomUUID();
  connect.stream({ url: `wss://${new URL(base).host}/media-stream` }).parameter({ name: 'endingToken', value: token });
  vr.redirect({ method: 'POST' }, `${base}/final-hold?t=${token}`);
  return reply.type('text/xml').send(vr.toString());
});

for (const route of ['/final-hold', '/call-failed']) {
  app.post(route, async (request, reply) => {
    const params = (request.body ?? {}) as Record<string, string>;
    const base = publicBase(request.headers.host, request.headers['x-forwarded-proto'] as string | undefined);
    const signature = request.headers['x-twilio-signature'];
    if (config.twilioAuthToken && (typeof signature !== 'string' ||
      !twilio.validateRequest(config.twilioAuthToken, signature, `${base}${request.url}`, params))) {
      return reply.code(403).send('Forbidden');
    }
    const token = (request.query as { t?: string }).t ?? '';
    const hold = finalHolds.get(token);
    const vr = new twilio.twiml.VoiceResponse();
    if (hold && hold.callSid === params.CallSid) {
      if (route === '/final-hold') {
        vr.play(`${base}/audio/opus-1-clip.mp3`);
        vr.redirect({ method: 'POST' }, `${base}/call-failed?t=${token}`);
      } else {
        clearTimeout(hold.timer);
        finalHolds.delete(token);
        hold.session.gauntlet.endCall('disconnected');
        vr.hangup();
      }
    } else {
      vr.hangup();
    }
    return reply.type('text/xml').send(vr.toString());
  });
}

await app.register(async (scope) => {
  if (config.voiceTransport === 'legacy') {
    scope.get('/media-stream', { websocket: true }, (socket, request) => {
      if (!gate.consume()) {
        request.log.warn('rejected a media stream with no matching incoming call');
        socket.close(1008, 'unexpected stream');
        return;
      }
      activeCalls += 1;
      void handlePhoneCall(socket, {
        config,
        registry,
        log: request.log,
        onFinalHold(session, token, callSid) {
          const timer = setTimeout(() => {
            finalHolds.delete(token);
            session.gauntlet.endCall('disconnected');
          }, 90_000);
          timer.unref();
          finalHolds.set(token, { session, callSid, timer });
        },
        onCallEnd: () => {
          activeCalls = Math.max(0, activeCalls - 1);
        },
      });
    });
  }

  // ------------------------------------------------------------- laptop
  const clientMessage = z.discriminatedUnion('type', [
    z.object({ type: z.literal('hello'), sessionId: z.string().optional() }),
  ]);

  scope.get('/ws/laptop', { websocket: true }, (socket, request) => {
    let session: CallSession | undefined;
    const keepAlive = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 25_000);

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = clientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (message.type === 'hello') {
        if (session) return;
        const existing = message.sessionId ? registry.get(message.sessionId) : undefined;
        if (existing && !existing.gauntlet.isEnded) {
          session = existing;
        } else {
          registry.sweep();
          if (registry.size >= 200) {
            socket.send(JSON.stringify({ type: 'error', message: 'The help desk is full. Try again later.' }));
            socket.close();
            return;
          }
          session = registry.create();
        }
        session.laptops.add(socket);
        socket.send(JSON.stringify(session.snapshot()));
        request.log.info({ sessionId: session.id }, 'laptop connected');
      }
    });
    socket.on('close', () => {
      clearInterval(keepAlive);
      session?.laptops.delete(socket);
    });
  });
});

// ---------------------------------------------------------------- selfie

app.get('/api/selfie/info', async (request, reply) => {
  const token = (request.query as { t?: string }).t ?? '';
  const session = registry.findBySelfieToken(token);
  const requirement = session?.gauntlet.selfieRequirement(token);
  if (!session || !requirement) return reply.code(404).send({ error: 'This photo link has expired or was already used.' });
  return { requirement };
});

app.post('/api/selfie', async (request, reply) => {
  const token = (request.query as { t?: string }).t ?? '';
  const session = registry.findBySelfieToken(token);
  if (!session) return reply.code(404).send({ error: 'This photo link has expired or was already used.' });

  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ error: 'Send the photo as a JPEG, PNG or WebP image.' });
  const mime = detectImage(body);
  if (!mime) return reply.code(415).send({ error: 'That does not look like a JPEG, PNG or WebP image.' });
  if (!session.phone) return reply.code(409).send({ error: 'The call has ended.' });

  const dataUrl = `data:${mime};base64,${body.toString('base64')}`;
  const result = session.gauntlet.receivePhoto(token, dataUrl);
  if (!result.ok) return reply.code(410).send({ error: result.error });
  session.phone.sendPhoto(dataUrl, result.requirement);
  return { ok: true };
});

function detectImage(b: Buffer): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.subarray(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

// ---------------------------------------------------------------- static web app

const webDist = config.webDist ?? path.resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
} else {
  app.log.warn(`No built web app at ${webDist}. Run "npm run build" to serve the scene and selfie page from this server.`);
}

  let tacServer: import('twilio-agent-connect').TACServer | undefined;
  if (config.voiceTransport === 'tac') {
    process.env.TAC_ANALYTICS_DISABLED ??= 'true';
    const { attachTacServer } = await import('./tac-transport.js');
    const attached = await attachTacServer({
        app,
        config,
        registry,
        gate,
        getActiveCalls: () => activeCalls,
        incrementActiveCalls: (delta) => { activeCalls = Math.max(0, activeCalls + delta); },
        onFinalHold(session, token, callSid) {
          const timer = setTimeout(() => {
            finalHolds.delete(token);
            session.gauntlet.endCall('disconnected');
          }, 90_000);
          timer.unref();
          finalHolds.set(token, { session, callSid, timer });
        },
      });
    tacServer = attached.server;
    app.addHook('onClose', async () => {
      attached.tac.shutdown();
      const { shutdownAnalytics } = await import('twilio-agent-connect');
      await shutdownAnalytics();
    });
  }

  return { app, registry, gate, activeCalls: () => activeCalls, tacServer };
}
