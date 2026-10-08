# CLAUDE.md

Context for Claude Code. Read this first, then `PLAN.md` for what to do next.

## What this is

A voice help desk that makes callers pass six stages before they can file a ticket. Callers phone a Twilio number
and talk to an OpenAI Realtime voice agent. A three.js scene on a laptop shows progress, one planet per stage.
It is a fun demo, about 20 to 30 calls total, not a production system.

## Layout

- `shared/protocol.ts`: stages, planets, and every message type between server and laptop. Imported by both sides.
- `server/src/machine.ts`: XState machine, one per call. Stages are states; PASSED advances, FAILED re-enters.
- `server/src/engine.ts`: `Gauntlet`, all test logic for one call, with no network code. Start here for behavior.
- `server/src/content.ts`: puzzles, languages, selfie requirements, the five human-check tasks.
- `server/src/voice.ts`: Twilio media stream to OpenAI Realtime via the OpenAI Agents SDK. Defines the agent
  instructions and the tools, each of which calls into `Gauntlet`.
- `server/src/app.ts`: Fastify routes (`/incoming-call`, `/media-stream`, `/ws/laptop`, `/api/selfie`, static web).
  `buildApp(config)` is importable, so tests use `app.inject`.
- `server/src/sessions.ts`: in-memory registry of call sessions and the ticket store.
- `server/src/gate.ts`: only accepts a media stream shortly after a validated incoming call.
- `web/`: Vite and TypeScript. `index.html` is the laptop app (three.js scene in `src/scene.ts`, DOM in `src/ui.ts`).
  `selfie.html` is the phone page opened by the QR code.

## Commands

```bash
npm install
npm test               # server tests, no network needed
npm run typecheck      # server and web
npm run build          # web app into web/dist
npm run dev            # server with reload (needs .env)
```

## Rules that must not be broken

1. **The server decides, never the prompt.** Pass or fail, randomness, answer matching and word counting are done
   in `engine.ts`. The model only reports what it heard or saw. A model asked to fail callers "randomly" is not
   random.
2. **Every tool checks the current stage** and returns a clear error otherwise. Do not add a tool that bypasses
   the state machine.
3. **Tool results must never contain puzzle answers or CAPTCHA codes.** The model would say them aloud.
4. **Keep `shared/protocol.ts` the single source of truth** for messages. Update server and web together.
5. **Secrets stay in environment variables.** Never log full phone numbers (use `maskNumber`), never commit `.env`.
6. **Protections stay on:** Twilio signature check, stream gate, caller allow list, concurrency and duration caps.
   Do not add an endpoint that places outbound calls.
7. **Add a test for behavior you change** in `engine.ts` or `app.ts`. Tests use a scripted RNG; see `engine.test.ts`.

## Gotchas

- Twilio trial accounts accept inbound calls only from verified numbers.
- Twilio gives call webhooks a hard 15 second limit, so hosts that sleep when idle will fail the first call.
- ngrok's free plan shows a browser warning page once per week, which the phone sees when scanning the QR code.
- The selfie QR needs `PUBLIC_BASE_URL` set to a public address, or it points at localhost and the phone cannot reach it.
- The voice bridge has never been run against live Twilio and OpenAI in development; see `PLAN.md`.
- `xstate`, `zod` and `twilio` are on current major versions. Check their docs before assuming older APIs.
- TypeScript runs through `tsx`; there is no server build step.

## Style

TypeScript strict. Short functions, plain names, comments only where the reason is not obvious.
Interface copy is sentence case, active voice, and in character: deadpan bureaucracy, never cruelty.
