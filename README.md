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

## Quick start (laptop plus ngrok)

You need Node 22+, a Twilio account with a voice number, an OpenAI API key with Realtime access, and ngrok.
**New to any of these? Follow [SETUP.md](SETUP.md) first**; it walks through creating each account and where every
value comes from.

```bash
nvm use                       # if you use nvm; the repo pins Node 22 via .nvmrc
npm install
cp .env.example .env.development # then fill in OPENAI_API_KEY and the rest
npm run build                 # builds the web app that the server serves
ngrok http 5050               # copy the https URL it prints
```

1. Put that URL in `.env.development` as `PUBLIC_BASE_URL` (no trailing slash), and your Twilio number in
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

## In-browser test phone (Sandbox)

The app can place a test call from the browser, so you can use your computer's microphone and speakers
instead of a physical phone. This uses Twilio's Voice JavaScript SDK and still runs the normal call flow
through the app. It is intended for a private test environment such as the Railway `Sandbox` environment.
Calls use Twilio and OpenAI and incur the usual usage charges.

1. In Twilio Console, create a **TwiML App** under **Develop > Voice > TwiML Apps**.
2. Set its Voice Request URL to the public URL of the app environment followed by `/incoming-call`, for
   example `https://YOUR-SANDBOX-DOMAIN.up.railway.app/incoming-call`. Choose **HTTP POST** and save.
   This is the TwiML App URL; your Twilio phone number can keep its existing webhook configuration.
3. In Railway, select the `Sandbox` environment and set these variables on the app service:

   ```text
   ENABLE_DEV_PHONE=true
   TWILIO_TWIML_APP_SID=AP...   # SID of the TwiML App created above
   DEV_PHONE_ACCESS_CODE=       # private random code, at least 16 characters
   ```

   `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER`, and
   `TWILIO_AUTH_TOKEN` must also be set. The TAC transport requires these already. Keep the Dev Phone
   variables out of Production and leave `ENABLE_DEV_PHONE=false` there.
4. Deploy the Sandbox service and open its public app URL. The **Call from this computer** controls appear
   only when the feature is enabled. Enter the access code, click the button, and allow microphone access
   when the browser asks. The status will show when the call connects; use the same button to hang up.
5. Keep the app open during the call. The main screen displays the call's pairing code and prompts; speak
   into the computer microphone as you complete the stages.

The token endpoint allows five incorrect access-code attempts per minute per IP address. Turn the feature
off by setting `ENABLE_DEV_PHONE=false` in Sandbox when you finish testing.

## Configuration

Everything is an environment variable; see `.env.example` for the full, commented list.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required. |
| `OPENAI_REALTIME_MODEL` | Defaults to `gpt-realtime-2.1`. |
| `PUBLIC_BASE_URL` | Your public https address. Used for the QR code and signature checks. |
| `TWILIO_AUTH_TOKEN` | Enables Twilio signature checks. Required when `NODE_ENV=production`. |
| `VOICE_TRANSPORT` | Voice integration selector: `legacy` (default) or `tac`. TAC uses the app's custom provider with the TAC Voice channel. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_PHONE_NUMBER` | Required only for `VOICE_TRANSPORT=tac`; use a Twilio API key/secret in addition to the Auth Token. |
| `ENABLE_DEV_PHONE`, `TWILIO_TWIML_APP_SID`, `DEV_PHONE_ACCESS_CODE` | Optional in-browser test phone. Enable only in a private test environment; the TwiML App's Voice URL must be the environment's `/incoming-call` URL. |
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
