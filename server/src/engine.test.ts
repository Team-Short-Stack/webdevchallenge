import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ServerMessage } from '../../shared/protocol.js';
import { PUZZLES, countWords, normalizeWord } from './content.js';
import { Gauntlet, type ToolResult } from './engine.js';
import { Registry } from './sessions.js';

/** Returns the given values in order, then repeats the last one. */
function scripted(values: number[]) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

function setup(rngValues: number[] = [0], now = { t: 1_000 }) {
  const events: ServerMessage[] = [];
  const g = new Gauntlet({
    code: '4271',
    rng: scripted(rngValues),
    emit: (m) => events.push(m),
    saveTicket: (d) => ({ id: 'HDFH-0001', createdAt: 'now', ...d }),
    buildSelfieUrl: (t) => `https://example.test/selfie.html?t=${t}`,
    now: () => now.t,
    selfieTtlMs: 60_000,
  });
  return { g, events, now };
}

function expectOk(result: ToolResult): asserts result is Extract<ToolResult, { ok: true }> {
  assert.equal(result.ok, true, JSON.stringify(result));
}

function lastOfType<T extends ServerMessage['type']>(events: ServerMessage[], type: T) {
  return [...events].reverse().find((e) => e.type === type) as Extract<ServerMessage, { type: T }> | undefined;
}

describe('content', () => {
  it('scrambled puzzles are anagrams of their answers', () => {
    for (const p of PUZZLES.filter((x) => !x.display.includes(' '))) {
      const sort = (s: string) => normalizeWord(s).split('').sort().join('');
      assert.equal(sort(p.display), sort(p.answer), p.display);
    }
  });

  it('counts words', () => {
    assert.equal(countWords('  one two   three '), 3);
    assert.equal(countWords(''), 0);
  });
});

describe('gauntlet', () => {
  it('starts in pairing and refuses to skip stages', () => {
    const { g } = setup();
    assert.equal(g.phase, 'pairing');
    const r = g.startPuzzle();
    assert.equal(r.ok, false);
    assert.equal(g.phase, 'pairing');
  });

  it('rejects a wrong code and accepts the right one, ignoring spacing', () => {
    const { g } = setup();
    assert.equal(g.pair('0000').ok, false);
    assert.equal(g.phase, 'pairing');
    expectOk(g.pair('4 2 7 1'));
    assert.equal(g.phase, 'puzzle');
  });

  it('moves to a harder puzzle after a wrong answer and never reveals the answer', () => {
    const { g, events } = setup();
    g.pair('4271');
    g.startPuzzle();
    assert.equal(lastOfType(events, 'show_puzzle')?.display, PUZZLES[0]!.display);
    const wrong = g.submitPuzzleAnswer('banana');
    expectOk(wrong);
    assert.ok(!JSON.stringify(wrong).includes(PUZZLES[0]!.answer));
    assert.equal(g.phase, 'puzzle');
    assert.equal(g.attempts.puzzle, 2);
    g.startPuzzle();
    assert.equal(lastOfType(events, 'show_puzzle')?.display, PUZZLES[1]!.display);
    expectOk(g.submitPuzzleAnswer('Printer!'));
    assert.equal(g.phase, 'language');
  });

  it('picks a different language after a failed attempt', () => {
    const { g, events } = setup([0, 0]);
    g.pair('4271');
    g.startPuzzle();
    g.submitPuzzleAnswer(PUZZLES[0]!.answer);
    g.startLanguage();
    const first = lastOfType(events, 'show_language_prompt')!.language;
    g.reportLanguageResult(false);
    assert.equal(g.phase, 'language');
    g.startLanguage();
    const second = lastOfType(events, 'show_language_prompt')!.language;
    assert.notEqual(first, second);
  });

  it('runs the selfie flow: token, photo, single use, expiry, escalation', () => {
    const { g, events, now } = setup();
    g.pair('4271');
    g.startPuzzle();
    g.submitPuzzleAnswer(PUZZLES[0]!.answer);
    g.startLanguage();
    g.reportLanguageResult(true);
    assert.equal(g.phase, 'selfie');

    expectOk(g.requestSelfie());
    const qr = lastOfType(events, 'show_qr')!;
    const token = new URL(qr.url).searchParams.get('t')!;
    assert.ok(g.isSelfieTokenValid(token));
    assert.equal(g.isSelfieTokenValid('wrong'), false);

    // photo arrives
    const got = g.receivePhoto(token, 'data:image/jpeg;base64,AAAA');
    assert.equal(got.ok, true);
    assert.equal(g.isSelfieTokenValid(token), false, 'single use');
    assert.equal(g.receivePhoto(token, 'data:image/jpeg;base64,BBBB').ok, false);
    assert.equal(lastOfType(events, 'selfie_received')?.photo, 'data:image/jpeg;base64,AAAA');

    // judged badly: requirement escalates and a fresh token is issued
    expectOk(g.reportSelfieResult(false, 'no hat'));
    assert.equal(g.phase, 'selfie');
    expectOk(g.requestSelfie());
    const qr2 = lastOfType(events, 'show_qr')!;
    assert.notEqual(qr2.requirement, qr.requirement);
    const token2 = new URL(qr2.url).searchParams.get('t')!;
    assert.notEqual(token2, token);

    // expiry
    now.t += 61_000;
    assert.equal(g.isSelfieTokenValid(token2), false);
  });

  it('cannot judge a selfie before a photo arrives', () => {
    const { g } = setup();
    g.pair('4271');
    g.startPuzzle();
    g.submitPuzzleAnswer(PUZZLES[0]!.answer);
    g.startLanguage();
    g.reportLanguageResult(true);
    g.requestSelfie();
    assert.equal(g.reportSelfieResult(true, 'looks fine').ok, false);
  });

  function toHumanCheck(g: Gauntlet) {
    g.pair('4271');
    g.startPuzzle();
    g.submitPuzzleAnswer(PUZZLES[0]!.answer);
    g.startLanguage();
    g.reportLanguageResult(true);
    g.requestSelfie();
    const token = (g as unknown as { selfie: { token: string } }).selfie.token;
    g.receivePhoto(token, 'data:image/jpeg;base64,AAAA');
    g.reportSelfieResult(true, 'ok');
    assert.equal(g.phase, 'humanCheck');
  }

  it('passes a coin-flip check when the server RNG says pass', () => {
    // rng calls in order: language pick (0), human-check pick (0 = happy-birthday), coin flip (0 < 0.5)
    const { g, events } = setup([0, 0, 0]);
    toHumanCheck(g);
    g.startHumanCheck();
    assert.equal(lastOfType(events, 'show_human_check')!.title, 'Cultural compliance');
    expectOk(g.submitHumanCheck('la la la'));
    assert.equal(g.phase, 'ticket');
  });

  it('fails a coin-flip check when the RNG says so, then offers a different task', () => {
    // language pick (0), human-check pick (0), coin flip (0.9 = fail)
    const { g, events } = setup([0, 0, 0.9]);
    toHumanCheck(g);
    g.startHumanCheck();
    const firstTitle = lastOfType(events, 'show_human_check')!.title;
    expectOk(g.submitHumanCheck('la la la'));
    assert.equal(g.phase, 'humanCheck');
    assert.equal(g.attempts.humanCheck, 2);
    g.startHumanCheck();
    assert.notEqual(lastOfType(events, 'show_human_check')!.title, firstTitle);
  });

  it('checks the CAPTCHA exactly, ignoring case and spacing', () => {
    // human-check pick 0.5 -> index 2 -> captcha
    const wrong = setup([0, 0.5, 0.1]);
    toHumanCheck(wrong.g);
    wrong.g.startHumanCheck();
    const shown = lastOfType(wrong.events, 'show_human_check')!;
    assert.equal(shown.title, 'Visual verification');
    assert.equal(shown.display?.length, 5);
    expectOk(wrong.g.submitHumanCheck('definitely not it'));
    assert.equal(wrong.g.phase, 'humanCheck');

    const right = setup([0, 0.5, 0.1]);
    toHumanCheck(right.g);
    right.g.startHumanCheck();
    const code = lastOfType(right.events, 'show_human_check')!.display!;
    expectOk(right.g.submitHumanCheck(code.split('').join(' ').toLowerCase()));
    assert.equal(right.g.phase, 'ticket');
  });

  it('checks the seven-word answer by counting words on the server', () => {
    // human-check pick 0.7 -> index 3 -> seven-word-meal
    const eight = setup([0, 0.7]);
    toHumanCheck(eight.g);
    eight.g.startHumanCheck();
    assert.equal(lastOfType(eight.events, 'show_human_check')!.title, 'Biographical audit');
    expectOk(eight.g.submitHumanCheck('I ate a sandwich yesterday at noon today'));
    assert.equal(eight.g.phase, 'humanCheck', 'eight words fails');

    const seven = setup([0, 0.7]);
    toHumanCheck(seven.g);
    seven.g.startHumanCheck();
    expectOk(seven.g.submitHumanCheck('I had three tacos and one apology'));
    assert.equal(seven.g.phase, 'ticket', 'seven words passes');
  });

  it('needs a verdict for model-judged checks', () => {
    // pick index 4 -> tongue-twister (0.9 * 5 = 4.5 -> 4)
    const { g } = setup([0, 0.9]);
    toHumanCheck(g);
    g.startHumanCheck();
    assert.equal(g.submitHumanCheck('she sells seashells').ok, false);
    expectOk(g.submitHumanCheck('she sells seashells by the seashore', true));
    assert.equal(g.phase, 'ticket');
  });

  it('files a ticket, finishes, and reports completion once', () => {
    const { g, events } = setup([0, 0.9]);
    toHumanCheck(g);
    g.startHumanCheck();
    g.submitHumanCheck('x', true);
    const r = g.createTicket('Printer on fire', 'It is literally on fire');
    expectOk(r);
    assert.equal(g.phase, 'done');
    assert.equal(lastOfType(events, 'ticket_created')?.ticket.id, 'HDFH-0001');
    g.endCall('hangup');
    g.endCall('hangup');
    const ended = events.filter((e) => e.type === 'call_ended');
    assert.equal(ended.length, 1);
    assert.equal((ended[0] as { reason: string }).reason, 'completed');
  });

  it('abandons the session on hang-up from any stage', () => {
    const { g, events } = setup();
    g.pair('4271');
    g.startPuzzle();
    g.endCall('hangup');
    assert.equal(g.phase, 'abandoned');
    assert.equal(lastOfType(events, 'call_ended')?.reason, 'hangup');
    assert.equal(g.startPuzzle().ok, false);
  });
});

describe('registry', () => {
  it('finds a waiting session by spoken code and hides paired ones', () => {
    const registry = new Registry((t) => `https://example.test/selfie.html?t=${t}`);
    const session = registry.create();
    const spoken = session.code.split('').join(' ');
    assert.equal(registry.findByCode(spoken), session);
    session.phone = { sendPhoto() {}, hangUp() {} };
    assert.equal(registry.findByCode(session.code), undefined);
  });

  it('finds the session that owns a selfie token', () => {
    const registry = new Registry((t) => `https://example.test/selfie.html?t=${t}`);
    const session = registry.create();
    session.gauntlet.pair(session.code);
    session.gauntlet.startPuzzle();
    session.gauntlet.submitPuzzleAnswer(PUZZLES[0]!.answer);
    session.gauntlet.startLanguage();
    session.gauntlet.reportLanguageResult(true);
    session.gauntlet.requestSelfie();
    const token = (session.gauntlet as unknown as { selfie: { token: string } }).selfie.token;
    assert.equal(registry.findBySelfieToken(token), session);
    assert.equal(registry.findBySelfieToken('nope'), undefined);
  });
});
