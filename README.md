# Universal Help Care

A phone-driven help desk that makes callers pass absurd tests before they can file a ticket. The caller phones a
Twilio number and talks to an OpenAI voice agent. A three.js scene of planets on a laptop shows their progress:
each stage of the gauntlet belongs to its own planet.

| Stage | Planet | What the caller does |
| --- | --- | --- |
| Pairing | Lolzitron | Spells out the silly code shown on the laptop |
| Language | Translatopia | Says a phrase in another language |
| Selfie | Snapturn | Scans a QR code on the laptop and takes a selfie meeting a silly requirement |
| Human check | Lengsdwarf | Answers a fashion-trivia question about a photo shown on the laptop |
| Ticket | Opus 1 | Describes the problem; the agent files a ticket |

## What it looks like

Screenshots from a scripted run live in `docs/screenshots/`: pairing, puzzle, language, the QR code, the selfie card
beside Mars, the human check, the ticket stage, the finished overview, and the phone page. They use fallback fonts,
because the web fonts could not load where they were captured.

## How it fits together

```
phone call --> Twilio --> your server --> OpenAI Realtime (voice agent + tools)
                              |
laptop browser (three.js) <---+   WebSocket: prompts, results, selfie, tickets
phone camera --scans QR on laptop--> selfie page --> your server --> voice agent judges the photo
```

One Node server owns everything: the Twilio webhook and audio stream, the per-call state machine, the laptop
WebSocket, the selfie upload, and the static web app. See `docs/DESIGN.md` and `CLAUDE.md`.
For a current technology summary and system diagram, see [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md).

## Quick start (laptop plus ngrok)

You need Node 22+, a Twilio account with a voice number, an OpenAI API key with Realtime access, and ngrok.
**New to any of these? Follow [SETUP.md](SETUP.md) first**; it walks through creating each account and where every
value comes from.

```bash
nvm use                       # if you use nvm; the repo pins Node 22 via .nvmrc
npm install
cp .env.example .env # then fill in OPENAI_API_KEY and the rest
npm run build                 # builds the web app that the server serves
ngrok http 5050               # copy the https URL it prints
```

1. Put that URL in `.env` as `PUBLIC_BASE_URL` (no trailing slash), and your Twilio number in
   `PHONE_DISPLAY_NUMBER`.
2. In the Twilio console, open your number, and under **Voice Configuration > A call comes in** set a webhook
   (HTTP POST) to `https://YOUR-NGROK-URL/incoming-call`.
3. Start the server: `npm run dev` (or `npm start`).
4. Open <http://localhost:5050> on your laptop. You will see a short code.
5. Call your Twilio number from your phone and spell out the code.

Notes:

- **Twilio trial accounts only accept calls from verified numbers.** Verify your phone in the Twilio console, or
  upgrade the account.
- ngrok's free plan shows a warning page to browsers once a week. Your phone will see it once when it first scans
  the QR code. Opening the laptop app at `localhost` avoids it.
- Set `TWILIO_AUTH_TOKEN` to make the server reject requests that do not carry a valid Twilio signature.
  Set `ALLOWED_CALLERS` for any demo with a public number.

## In-browser test phone (Production)

The app can place a test call from the browser, so you can use your computer's microphone and speakers
instead of a physical phone. This uses Twilio's Voice JavaScript SDK and still runs the normal call flow
through the app. This project uses a single Railway `Production` environment, including browser-phone testing protected by a private access code.
Calls use Twilio and OpenAI and incur the usual usage charges.

1. In Twilio Console, open your existing **TwiML App** under **Develop > Voice > TwiML Apps** (or create one).
2. Set its Voice Request URL to the public URL of the app environment followed by `/incoming-call`, for
   example `https://webdevchallenge-production.up.railway.app/incoming-call`. Choose **HTTP POST** and save.
   This is the TwiML App URL; reuse your existing Twilio number and credentials. Set your phone number’s Voice webhook to that same Production URL (HTTP POST). A TwiML App has one Voice Request URL: browser calls using that App SID will reach whichever environment that URL points to.
3. In Railway, select the `Production` environment and set these variables on the app service:

   ```text
   VOICE_TRANSPORT=tac
   ENABLE_DEV_PHONE=true
   TWILIO_TWIML_APP_SID=AP...   # SID of your TwiML App
   DEV_PHONE_ACCESS_CODE=       # private random code, at least 16 characters
   ```

   `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER`, and
   `TWILIO_AUTH_TOKEN` must also be set. The TAC transport requires these already. Set `PUBLIC_BASE_URL=https://webdevchallenge-production.up.railway.app`
   (or use the Railway domain reference described below).
4. Deploy the Production service and open its public app URL. The **Call from this computer** controls appear
   only when the feature is enabled. Enter the access code, click the button, and allow microphone access
   when the browser asks. The status will show when the call connects; use the same button to hang up.
5. Keep the app open during the call. The main screen displays the call's pairing code and prompts; speak
   into the computer microphone as you complete the stages.

The token endpoint allows five incorrect access-code attempts per minute per IP address. Turn the feature
off by setting `ENABLE_DEV_PHONE=false` in Production when you finish testing.

## Configuration

Railway deploys `main` to Production. The Sandbox environment has been retired.

Use a single ignored `.env` for local configuration; both `npm run dev` and `npm start` read it. Railway uses service variables configured in each environment, so set the values directly in Production. See `.env.example` for the full, commented list.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required. |
| `OPENAI_REALTIME_MODEL` | Defaults to `gpt-realtime-2.1`. |
| `PUBLIC_BASE_URL` | Your public https address. Used for the QR code and signature checks. |
| `TWILIO_AUTH_TOKEN` | Enables Twilio signature checks. Required when `NODE_ENV=production`. |
| `VOICE_TRANSPORT` | Voice integration selector: `legacy` (default) or `tac`. TAC uses the app's custom provider with the TAC Voice channel. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER` | Required only for `VOICE_TRANSPORT=tac`; use a Twilio API key/secret in addition to the Auth Token. |
| `ENABLE_DEV_PHONE`, `TWILIO_TWIML_APP_SID`, `DEV_PHONE_ACCESS_CODE` | Optional in-browser test phone. Use a private access code; the TwiML App’s Voice URL must be Production’s `/incoming-call` URL. |
| `ALLOWED_CALLERS` | Comma-separated numbers allowed to call. Blank means anyone. |
| `MAX_CALL_MINUTES`, `MAX_CONCURRENT_CALLS` | Hard limits on call length and parallel calls. |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server with auto-reload. |
| `npm run dev:web` | Vite dev server for the laptop app on port 5173, proxying to the server on 5050. |
| `npm run build` | Builds the web app into `web/dist`. |
| `npm start` | Runs the server. |
| `npm test` | Server tests. No network or API keys needed. |
| `npm run typecheck` | Typechecks server and web. |

The QR code points at `PUBLIC_BASE_URL`, so the selfie page is served from the built `web/dist`. Run
`npm run build` before testing the selfie step, even if you use the Vite dev server for the laptop app.

## Docker

```bash
docker build -t universal-help-care .
docker run --env-file .env -p 5050:5050 universal-help-care
```

In production (`NODE_ENV=production`, set by the image) `TWILIO_AUTH_TOKEN` is required.

## Hosting

The server needs a host that runs a normal long-lived process with WebSocket support (Railway, Fly.io, Render's
paid plans, Cloud Run with its request timeout raised to 60 minutes). Hosts that sleep when idle will miss
Twilio's 15-second webhook limit on the first call. Vercel and Netlify are a poor fit for the server.
Check each host's current pricing and limits before choosing.

## Security notes

A public voice demo can be abused: someone can run up your Twilio and OpenAI bills. Built-in protections:

- Twilio signature check on `/incoming-call` (when `TWILIO_AUTH_TOKEN` is set).
- A media stream is only accepted shortly after a valid incoming call.
- Optional caller allow list, a cap on concurrent calls, and a hard maximum call length.
- This app never places outbound calls, which is the pattern behind most voice toll fraud.

Also do these in the Twilio console: restrict Voice Geographic Permissions to the countries you need, add Usage
Triggers, and set spend limits with OpenAI. Never commit `.env`; turn on GitHub secret scanning for the repo.

## Privacy

Calls are not recorded. The selfie is held in server memory only, sent to OpenAI for judging, and dropped when
the session is swept. Tickets are kept in memory and disappear on restart. Tell callers about the photo before
the QR code appears if you use this beyond a private demo.

### Automated call-flow harness

Run `npm run test:call-flow` for the voice integration harness, or `npm test` for all tests. No service credentials or billed calls are needed. The harness runs real local HTTP and WebSocket connections with the installed TAC and OpenAI Agents SDKs; a local simulator supplies model audio and tool events.

Both `legacy` and `tac` are covered: browser pairing, incoming-call signatures, caller restrictions, concurrency limits, audio forwarding, playback acknowledgements and interruptions, selfie upload/image injection, human checks, final hold, and dropped-call cleanup. Dev Phone token authentication, signing, expiry, and rate limits are also checked. These tests do not verify actual microphone audio, Twilio networking, or model behavior; use a live Dev Phone call for those.

The OpenAI SDK packages are pinned together through root `overrides`. TAC has an optional older Agents peer dependency; allowing mixed versions makes the Twilio transport emit tool events that the newer session cannot dispatch.

For local Dev Phone testing, fill the ignored `.env` with `VOICE_TRANSPORT=tac`, `ENABLE_DEV_PHONE=true`, the Twilio account/auth token, API Key SID and matching secret, phone number, TwiML App SID, and a `DEV_PHONE_ACCESS_CODE` of at least 16 characters. Set `PUBLIC_BASE_URL` to your HTTPS tunnel URL. Use your existing TwiML App with its Voice request URL set to `<PUBLIC_BASE_URL>/incoming-call` (POST). For Railway Production testing, set these same values in Production service variables and use `https://webdevchallenge-production.up.railway.app` as `PUBLIC_BASE_URL`. Local phone testing temporarily requires routing both Twilio webhooks to the tunnel; restore both to Production afterward. Build with `npm run build`, then start with `npm run dev`; open http://localhost:5050 and use the Dev Phone panel.

### Calls disconnect immediately after the greeting

Keep Production’s `PUBLIC_BASE_URL`, the phone number’s Voice webhook, and the TwiML App’s Voice URL pointed at Production. Mixing a local tunnel with the deployed service can grant the call on one server and send its media WebSocket to another, where the stream is rejected. Final-hold callbacks also need to reach the same server.

In Railway service variables, set `PUBLIC_BASE_URL` to `https://${{RAILWAY_PUBLIC_DOMAIN}}` so it follows that environment's public domain, then deploy the variable change. Keep the phone number's Voice webhook and the browser-phone TwiML App Voice URL pointed at the environment being tested, followed by `/incoming-call` (POST). Open [the Production app](https://webdevchallenge-production.up.railway.app/) for its pairing code.

Configuration now rejects mismatched Railway-generated domains at startup with an explicit error. Local ngrok and custom-domain configuration remain available.
