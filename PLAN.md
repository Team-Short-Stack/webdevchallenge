# Plan

Work through this top to bottom. Each item says what "done" looks like. Tick boxes as you go.

## Status at hand-off

Built and tested without any network access:

- [x] Per-call state machine and all test logic (`engine.ts`), covered by tests.
- [x] HTTP and WebSocket server, Twilio signature check, stream gate, caller allow list, concurrency cap.
- [x] Selfie upload path (token, size and type checks, single use, expiry), covered by tests.
- [x] Laptop app: planets scene, "Now serving" sign, prompt slips, QR code, ticket list, selfie card.
- [x] Phone selfie page (capture, downscale, upload).
- [x] Full walkthrough in headless Chromium: pairing, puzzle (wrong then right), language, QR, real photo upload,
      human check, ticket, overview. Screenshots looked right.

Never run against the real services, and not yet seen:

- [ ] The voice bridge (`voice.ts`) against live Twilio and OpenAI.
- [ ] The phone selfie page in its normal "Take selfie" state on a real phone.
- [ ] The web fonts (Public Sans and Doto load from Google Fonts; they were blocked while testing).
- [ ] Scanning the QR code while a call is active, on both iPhone and Android.

## 1. First live call (do this before anything else)

- [ ] Follow the README quick start: `.env`, `npm run build`, ngrok, Twilio webhook, `npm run dev`.
- [ ] Verify your phone number in Twilio (trial accounts only accept verified callers) or upgrade the account.
- [ ] Call, hear the greeting, say the code. Done when the laptop moves from Lolzitron to Translatopia.
- [ ] If the agent stays silent after the greeting, check the server log for `connected to OpenAI Realtime` and
      `realtime error`, and confirm the API key has Realtime access.
- [ ] Walk the whole gauntlet once. Done when a ticket appears in the side list.

## 2. Tune the agent

- [ ] Latency: try `OPENAI_REASONING_EFFORT=low` and compare. Try `gpt-realtime-2.1-mini` if replies feel slow.
- [ ] Prompt: adjust `INSTRUCTIONS` in `voice.ts` until Gladys is funny without being cruel. Keep replies to one
      or two sentences.
- [ ] Make the agent speak first. Today the greeting is a Twilio `<Say>` line in `app.ts`. Optionally send an
      opening message from `voice.ts` once the stream has started and the model is connected.
- [ ] Speech recognition of spoken codes: if digits are misheard, ask the model to read them back, or
      accept spelled-out words ("four two seven one") in `pair_session`.
- [ ] CAPTCHA: letters are easy to mishear on a phone line. Try a shorter code or digits.

## 3. Selfie step on real phones

- [ ] Scan the QR code during an active call on iPhone and on Android. Done when the call survives and the photo
      arrives.
- [ ] Check front-camera capture (`capture="user"`) and photo orientation on both.
- [ ] Confirm the model judges the requirement fairly (a hat, three fingers, and so on). Tune
      `SELFIE_REQUIREMENTS` in `content.ts`.
- [ ] Decide on a one-line notice about the photo on the laptop before the QR appears (`ui.ts`).

## 4. Polish

- [ ] Look at the real fonts. If Doto does not suit the LED digits, change `--font-led` in `style.css`.
- [ ] Failure moments: a stronger reaction when a test fails (planet shake exists; consider a flash on the sign).
- [ ] Narrow screens: the ticket list hides below 960px. Add a small ticket count to the sign if wanted.
- [ ] Tidy `index.html` meta and add a proper favicon.

## 5. Tests worth adding

- [ ] Turn the headless screenshot walkthrough into a script in the repo (drive a `Gauntlet` through every stage
      with `buildApp`, load the page in Playwright, screenshot each stage).
- [ ] A test for the laptop WebSocket: hello, snapshot, resume with `sessionId`, ticket broadcast with `mine`.
- [ ] A test that tool results never contain an answer the model is only supposed to judge, not know in advance.

## 6. Hosting (optional)

- [ ] Pick a host that runs a long-lived process: Railway, Fly.io, or Cloud Run (set request timeout to 60 minutes).
      Check current pricing and limits first.
- [ ] Build with the `Dockerfile`, set every variable from `.env.example` in the host, including
      `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL`.
- [ ] Point the Twilio webhook at the host. Keep `ALLOWED_CALLERS` set.

## 7. Before sharing the number with anyone

- [ ] Twilio: restrict Voice Geographic Permissions, add Usage Triggers, use a separate subaccount for the demo.
- [ ] OpenAI: set a project spend limit.
- [ ] Set `ALLOWED_CALLERS`, keep `MAX_CALL_MINUTES` and `MAX_CONCURRENT_CALLS` low.
- [ ] Turn on GitHub secret scanning and push protection. Confirm `.env` was never committed.

## Open questions

- Venus/the word puzzle is gone, and all five remaining planets now have silly names instead of real-planet
  ones: Lolzitron (pairing), Translatopia (language), Snapturn (selfie), Lengsdwarf (human check, deliberately
  the smallest), Opus 1 (ticket).
- Should a failed test also flash the sign, not just shake the planet?
- Show every caller's tickets (current behavior) or only the current call's?
- Photo as a card beside Snapturn (current behavior) or mapped onto the planet?
