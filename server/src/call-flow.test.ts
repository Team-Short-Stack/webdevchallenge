import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac, randomUUID } from 'node:crypto';
import { describe, it, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket, WebSocketServer } from 'ws';
import twilio from 'twilio';
import { buildApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { buildHumanCheck, HUMAN_CHECK_IDS } from './content.js';

// Wire fixtures are deliberately separate from the application state machine.
// Real HTTP/WS servers and the installed Agents/TAC SDKs run during these tests.
type Event = Record<string, any>;
const BASE = 'https://example.test';
const AUTH = 'test-auth-token';
const ACCESS = 'private-test-access-code';
const fixtures = {
  OPENAI_API_KEY: 'sk-local-fixture', PUBLIC_BASE_URL: BASE,
  TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`, TWILIO_AUTH_TOKEN: AUTH,
  TWILIO_API_KEY: `SK${'0'.repeat(32)}`, TWILIO_API_SECRET: 'local-api-secret',
  TWILIO_PHONE_NUMBER: '+15550001111', TWILIO_TWIML_APP_SID: `AP${'0'.repeat(32)}`,
  ENABLE_DEV_PHONE: 'true', DEV_PHONE_ACCESS_CODE: ACCESS, ALLOWED_CALLERS: '+15550002222',
  WEB_DIST: '/nonexistent',
};

class Messages {
  readonly events: Event[] = [];
  constructor(socket: WebSocket) {
    socket.on('message', raw => this.events.push(JSON.parse(raw.toString())));
  }
  async wait(predicate: (event: Event) => boolean, start = 0): Promise<Event> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const found = this.events.slice(start).find(predicate);
      if (found) return found;
      await delay(10);
    }
    throw new Error(`Timed out waiting for wire event; seen: ${this.events.map(e => e.type ?? e.event).join(', ')}`);
  }
}

async function socketAt(url: string, t: TestContext) {
  const socket = new WebSocket(url, url.includes('/media-stream') ? { headers: { 'x-forwarded-host': 'example.test', 'x-forwarded-proto': 'https', 'x-twilio-signature': twilio.getExpectedTwilioSignature(AUTH, 'wss://example.test/media-stream', {}) } } : {});
  const messages = new Messages(socket);
  t.after(() => socket.terminate());
  await once(socket, 'open');
  return { socket, messages };
}

async function harness(t: TestContext, transport: Config['voiceTransport'], extra: Record<string, string> = {}) {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(upstream, 'listening');
  t.after(async () => {
    for (const socket of upstream.clients) socket.terminate();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  });
  let model: { socket: WebSocket; messages: Messages } | undefined;
  upstream.on('connection', socket => {
    model = { socket, messages: new Messages(socket) };
    socket.on('message', raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'session.update') {
        socket.send(JSON.stringify({ type: 'session.updated', event_id: randomUUID(), session: event.session }));
      }
      if (event.type === 'response.create') {
        const id = randomUUID();
        socket.send(JSON.stringify({ type: 'response.created', event_id: randomUUID(), response: { id, status: 'in_progress', output: [] } }));
        socket.send(JSON.stringify({ type: 'response.done', event_id: randomUUID(), response: { id, status: 'completed', output: [] } }));
      }
    });
  });
  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress !== 'string');
  const config = loadConfig({ ...fixtures, VOICE_TRANSPORT: transport, ...extra });
  config.port = 0; // Ephemeral listening port; zero is intentionally unavailable through env config.
  const built = await buildApp(config, { logger: false, realtimeUrl: `ws://127.0.0.1:${upstreamAddress.port}` });
  t.after(async () => {
    for (const socket of built.app.websocketServer.clients) socket.terminate();
    await built.app.close();
  });
  if (built.tacServer) await built.tacServer.start();
  else await built.app.listen({ port: 0, host: '127.0.0.1' });
  const address = built.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  async function webhook(route: string, params: Record<string, string>, signed = true) {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-host': 'example.test', 'x-forwarded-proto': 'https',
    };
    if (signed) headers['x-twilio-signature'] = twilio.getExpectedTwilioSignature(AUTH, BASE + route, params);
    return fetch(url + route, { method: 'POST', headers, body: new URLSearchParams(params) });
  }
  async function getModel() {
    for (let i = 0; i < 500 && !model; i++) await delay(10);
    assert.ok(model, 'voice bridge must connect to the local model simulator');
    return model;
  }
  async function tool(name: string, args: object = {}) {
    const m = await getModel();
    const callId = randomUUID();
    m.socket.send(JSON.stringify({
      type: 'response.output_item.done', event_id: randomUUID(), response_id: randomUUID(), output_index: 0,
      item: { id: randomUUID(), type: 'function_call', status: 'completed', call_id: callId, name, arguments: JSON.stringify(args) },
    }));
    const result = await m.messages.wait(e => e.type === 'conversation.item.create' && e.item?.type === 'function_call_output' && e.item.call_id === callId);
    return JSON.parse(result.item.output) as { ok: boolean; error?: string };
  }
  async function audio() {
    const m = await getModel();
    m.socket.send(JSON.stringify({
      type: 'response.output_audio.delta', event_id: randomUUID(), response_id: randomUUID(),
      item_id: randomUUID(), output_index: 0, content_index: 0,
      delta: Buffer.alloc(160, 0xff).toString('base64'),
    }));
  }
  return { ...built, url, ws: url.replace('http:', 'ws:'), webhook, getModel, tool, audio };
}

for (const transport of ['legacy', 'tac'] as const) {
  describe(`${transport} call flow harness`, () => {
    it('connects a signed call to the browser session, streams audio, injects selfie, and ends after hold', { timeout: 20_000 }, async t => {
      const h = await harness(t, transport);
      const laptop = await socketAt(`${h.ws}/ws/laptop`, t);
      laptop.socket.send(JSON.stringify({ type: 'hello' }));
      const snapshot = await laptop.messages.wait(e => e.type === 'snapshot');
      assert.equal(snapshot.phase, 'pairing');

      const tokenResponse = await fetch(`${h.url}/api/dev-phone/token`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: ACCESS }),
      });
      assert.equal(tokenResponse.status, 200);
      const token = await tokenResponse.json() as { token: string; identity: string };
      const params = { From: `client:${token.identity}`, CallSid: `CA${'1'.repeat(32)}` };
      const incoming = await h.webhook('/incoming-call', params);
      assert.equal(incoming.status, 200);
      const twiml = await incoming.text();
      assert.match(twiml, /<Stream url="wss:\/\/example.test\/media-stream"/);
      const endingToken = /name="endingToken" value="([^"]+)"/.exec(twiml)?.[1];
      assert.ok(endingToken);

      const phone = await socketAt(`${h.ws}/media-stream`, t);
      let acknowledgeMarks = true;
      phone.socket.on('message', raw => {
        const event = JSON.parse(raw.toString());
        if (event.event === 'mark' && acknowledgeMarks) phone.socket.send(JSON.stringify(event));
      });
      phone.socket.send(JSON.stringify({ event: 'start', start: {
        streamSid: 'MZ-local', callSid: params.CallSid, customParameters: { endingToken },
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
      } }));
      const model = await h.getModel();
      const settings = await model.messages.wait(e => e.type === 'session.update');
      assert.equal(settings.session.audio.input.format.type, 'audio/pcmu');
      assert.equal(settings.session.audio.input.turn_detection.threshold, 0.6);
      assert.equal(settings.session.audio.input.turn_detection.interrupt_response, false);
      assert.equal(settings.session.audio.input.noise_reduction.type, 'far_field');
      await model.messages.wait(e => e.type === 'conversation.item.create' && JSON.stringify(e.item).includes('phone call is now connected'));
      const payload = Buffer.alloc(160, 0xff).toString('base64');
      phone.socket.send(JSON.stringify({ event: 'media', media: { payload, timestamp: '0' } }));
      await model.messages.wait(e => e.type === 'input_audio_buffer.append' && e.audio === payload);
      assert.equal((await h.tool('request_selfie')).ok, false, 'cannot skip pairing');
      assert.equal((await h.tool('pair_session', { code: snapshot.code, spoken: snapshot.code })).ok, false, 'must wait for done');
      assert.equal((await h.tool('pair_session', { code: snapshot.code, spoken: `${snapshot.code} done` })).ok, true);
      await laptop.messages.wait(e => e.type === 'paired');
      await laptop.messages.wait(e => e.type === 'show_language_prompt');
      assert.equal(h.registry.get(snapshot.sessionId)?.gauntlet.phase, 'language', 'pairing immediately starts stage two');
      assert.equal((await h.tool('report_language_result', { passed: true })).ok, false, 'cannot advance before speaking');

      // A barge-in must cancel an unacknowledged verdict and leave the UI at language.
      acknowledgeMarks = false;
      await h.audio();
      await phone.messages.wait(e => e.event === 'media');
      const pending = h.tool('report_language_result', { passed: true });
      await phone.messages.wait(e => e.event === 'mark' && e.mark?.name === 'verdict-1');
      model.socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started', event_id: randomUUID(), audio_start_ms: 0, item_id: 'caller-interrupt' }));
      assert.equal((await pending).ok, false);
      assert.equal(h.registry.get(snapshot.sessionId)?.gauntlet.phase, 'language');
      acknowledgeMarks = true;
      await h.audio();
      assert.equal((await h.tool('report_language_result', { passed: true })).ok, true);
      assert.equal((await h.tool('request_selfie')).ok, true);
      const qr = await laptop.messages.wait(e => e.type === 'show_qr');
      const selfieToken = new URL(qr.url).searchParams.get('t');
      assert.ok(selfieToken);
      const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
      const upload = await fetch(`${h.url}/api/selfie?t=${selfieToken}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: photo });
      assert.equal(upload.status, 200);
      const shown = await laptop.messages.wait(e => e.type === 'selfie_received');
      assert.match(shown.photo, /^data:image\/jpeg;base64,/);
      await model.messages.wait(e => e.type === 'conversation.item.create' && JSON.stringify(e.item).includes('input_image'));
      const replay = await fetch(`${h.url}/api/selfie?t=${selfieToken}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: photo });
      assert.equal(replay.status, 404, 'photo links are single-use');
      await h.audio();
      const selfieResult = h.tool('report_selfie_result', { passed: true, reason: 'Fixture meets the requirement.' });
      await laptop.messages.wait(e => e.type === 'show_survey');
      laptop.socket.send(JSON.stringify({ type: 'survey_completed', selection: 'happy' }));
      assert.equal((await selfieResult).ok, true);
      assert.equal((await h.tool('start_human_check')).ok, true);
      const prompt = await laptop.messages.wait(e => e.type === 'show_human_check');
      const answer = HUMAN_CHECK_IDS.map(buildHumanCheck).find(check => check.imageUrl === prompt.imageUrl);
      assert.ok(answer);
      assert.equal((await h.tool('submit_human_check', { heard: String(answer.expected) })).ok, true);
      assert.equal(h.registry.get(snapshot.sessionId)?.gauntlet.phase, 'ticket');
      await h.audio();
      const closed = once(phone.socket, 'close');
      assert.equal((await h.tool('start_final_hold')).ok, true);
      await closed;
      assert.equal(h.activeCalls(), 0);
      const holdRoute = `/final-hold?t=${endingToken}`;
      const mismatched = await h.webhook(holdRoute, { ...params, CallSid: 'CA-wrong' });
      assert.match(await mismatched.text(), /<Hangup/);
      const hold = await h.webhook(holdRoute, params);
      assert.match(await hold.text(), /<Play>.*opus-1-clip\.mp3<\/Play>/);
      const endRoute = `/call-failed?t=${endingToken}`;
      assert.equal((await h.webhook(endRoute, params)).status, 200);
      await laptop.messages.wait(e => e.type === 'call_ended' && e.reason === 'disconnected');
      await h.webhook(endRoute, params);
      await delay(20);
      assert.equal(laptop.messages.events.filter(e => e.type === 'call_ended').length, 1);
      assert.equal(laptop.messages.events.some(e => e.type === 'ticket_created'), false);
    });

    it('rejects unsigned calls, unapproved callers, unsolicited streams and excess concurrent calls', { timeout: 10_000 }, async t => {
      const h = await harness(t, transport, { MAX_CONCURRENT_CALLS: '1', ENABLE_DEV_PHONE: 'false' });
      const params = { From: fixtures.ALLOWED_CALLERS, CallSid: `CA${'2'.repeat(32)}` };
      assert.equal((await h.webhook('/incoming-call', params, false)).status, 403);
      for (const from of ['+15550003333', 'client:dev_unissued']) {
        const rejected = await h.webhook('/incoming-call', { ...params, From: from });
        assert.match(await rejected.text(), /<Hangup/);
      }
      const { socket: stray } = await socketAt(`${h.ws}/media-stream`, t);
      t.after(() => stray.terminate());
      const rejected = once(stray, 'close');
      const [code] = await rejected;
      assert.equal(code, 1008);
      assert.equal((await h.webhook('/incoming-call', params)).status, 200);
      const full = await h.webhook('/incoming-call', params);
      assert.match(await full.text(), /<Hangup/);
    });

    it('cleans up a dropped call and releases the concurrency slot', { timeout: 10_000 }, async t => {
      const h = await harness(t, transport, { MAX_CONCURRENT_CALLS: '1' });
      const laptop = await socketAt(`${h.ws}/ws/laptop`, t);
      laptop.socket.send(JSON.stringify({ type: 'hello' }));
      const snapshot = await laptop.messages.wait(e => e.type === 'snapshot');
      await h.webhook('/incoming-call', { From: fixtures.ALLOWED_CALLERS, CallSid: 'CA-drop' });
      const phone = await socketAt(`${h.ws}/media-stream`, t);
      phone.socket.send(JSON.stringify({ event: 'start', start: { streamSid: 'MZ-drop', callSid: 'CA-drop' } }));
      assert.equal((await h.tool('pair_session', { code: snapshot.code, spoken: `${snapshot.code} done` })).ok, true);
      const closed = once(phone.socket, 'close');
      phone.socket.close();
      await closed;
      await laptop.messages.wait(e => e.type === 'call_ended');
      assert.equal(h.activeCalls(), 0);
      const next = await h.webhook('/incoming-call', { From: fixtures.ALLOWED_CALLERS, CallSid: 'CA-next' });
      assert.match(await next.text(), /<Stream/);
    });
  });
}

describe('Dev Phone credentials', () => {
  it('requires the complete browser-phone config', () => {
    assert.throws(() => loadConfig({ OPENAI_API_KEY: 'fixture', ENABLE_DEV_PHONE: 'true', TWILIO_TWIML_APP_SID: fixtures.TWILIO_TWIML_APP_SID, DEV_PHONE_ACCESS_CODE: ACCESS }), /TWILIO_API_KEY/);
  });
  it('authenticates token requests, signs a short-lived outgoing-only grant, and rate limits requests', async t => {
    const h = await harness(t, 'legacy');
    const tokenRequest = (accessCode: unknown) => fetch(`${h.url}/api/dev-phone/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode }),
    });
    assert.equal((await tokenRequest(123)).status, 401);
    const response = await tokenRequest(ACCESS);
    assert.equal(response.status, 200);
    const body = await response.json() as { token: string; identity: string };
    const [header, payload, signature] = body.token.split('.');
    assert.ok(header && payload && signature);
    assert.equal(signature, createHmac('sha256', fixtures.TWILIO_API_SECRET).update(`${header}.${payload}`).digest('base64url'));
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.grants.identity, body.identity);
    assert.equal(claims.grants.voice.outgoing.application_sid, fixtures.TWILIO_TWIML_APP_SID);
    assert.equal(claims.grants.voice.incoming, undefined);
    assert.equal(claims.exp - claims.iat, 900);
    for (let i = 0; i < 3; i++) assert.equal((await tokenRequest('wrong')).status, 401);
    assert.equal((await tokenRequest(ACCESS)).status, 429);
  });
});



