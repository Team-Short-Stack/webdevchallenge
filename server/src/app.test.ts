import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import twilio from 'twilio';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import type { CallSession } from './sessions.js';

const BASE = 'https://example.test';
const TOKEN = 'test-auth-token';
const ALLOWED = '+15550001111';

const config = loadConfig({
  OPENAI_API_KEY: 'sk-test',
  PUBLIC_BASE_URL: BASE,
  TWILIO_AUTH_TOKEN: TOKEN,
  ALLOWED_CALLERS: ALLOWED,
  MAX_CONCURRENT_CALLS: '2',
  WEB_DIST: '/nonexistent',
});

type Built = Awaited<ReturnType<typeof buildApp>>;
let built: Built;

before(async () => {
  built = await buildApp(config, { logger: false });
});
after(async () => {
  await built.app.close();
});

function signedCall(params: Record<string, string>, signed = true) {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (signed) headers['x-twilio-signature'] = twilio.getExpectedTwilioSignature(TOKEN, `${BASE}/incoming-call`, params);
  return built.app.inject({ method: 'POST', url: '/incoming-call', headers, payload: new URLSearchParams(params).toString() });
}

function toSelfie(session: CallSession): string {
  const g = session.gauntlet;
  g.pair(session.code);
  g.startLanguage();
  g.reportLanguageResult(true);
  g.requestSelfie();
  return (g as unknown as { selfie: { token: string } }).selfie.token;
}

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);

describe('Twilio webhook protections', () => {
  it('rejects a request with no Twilio signature', async () => {
    const res = await signedCall({ From: ALLOWED, CallSid: 'CA1' }, false);
    assert.equal(res.statusCode, 403);
  });

  it('accepts a correctly signed call and points the stream at this server', async () => {
    const res = await signedCall({ From: ALLOWED, CallSid: 'CA2' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<Stream url="wss:\/\/example\.test\/media-stream"/);
  });

  it('closes the line to callers who are not on the allow list', async () => {
    const res = await signedCall({ From: '+15559998888', CallSid: 'CA3' });
    assert.match(res.body, /<Hangup/);
    assert.match(res.body, /closed to you/);
  });
});

describe('selfie upload', () => {
  it('hands a valid photo to the phone once, then refuses reuse', async () => {
    const session = built.registry.create();
    const token = toSelfie(session);
    const sent: { dataUrl: string; requirement: string }[] = [];
    session.phone = { sendPhoto: (dataUrl, requirement) => sent.push({ dataUrl, requirement }), hangUp() {} };

    const info = await built.app.inject({ method: 'GET', url: `/api/selfie/info?t=${token}` });
    assert.equal(info.statusCode, 200);
    assert.ok(JSON.parse(info.body).requirement.length > 0);

    const upload = await built.app.inject({
      method: 'POST',
      url: `/api/selfie?t=${token}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: jpeg(),
    });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.dataUrl, /^data:image\/jpeg;base64,/);
    assert.ok(sent[0]!.requirement.length > 0);

    const again = await built.app.inject({
      method: 'POST',
      url: `/api/selfie?t=${token}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: jpeg(),
    });
    assert.equal(again.statusCode, 404);
    assert.equal(sent.length, 1);
  });

  it('refuses a file that is not an image', async () => {
    const session = built.registry.create();
    const token = toSelfie(session);
    session.phone = { sendPhoto() {}, hangUp() {} };
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/selfie?t=${token}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: Buffer.alloc(400, 65),
    });
    assert.equal(res.statusCode, 415);
  });

  it('refuses an upload after the call has ended', async () => {
    const session = built.registry.create();
    const token = toSelfie(session);
    const res = await built.app.inject({
      method: 'POST',
      url: `/api/selfie?t=${token}`,
      headers: { 'content-type': 'image/jpeg' },
      payload: jpeg(),
    });
    assert.equal(res.statusCode, 409);
  });
});
