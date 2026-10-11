# Setup: OpenAI, Twilio and ngrok

You need three accounts before the first call. Do them in this order. Menu names change now and then, so if a
label differs slightly, look for the closest one.

## 1. OpenAI

1. Sign up at <https://platform.openai.com>. This is the API platform. A ChatGPT subscription does not include
   API access.
2. Add billing: open **Settings > Billing** and add a payment method or prepaid credit. Without it, the
   Realtime connection fails.
3. Recommended: create a separate **project** for this demo. Keys belong to a project, so usage and spending stay
   easy to read.
4. Set a **spend limit** for that project (Settings > Limits). If a key leaks or something loops, this caps the cost.
5. In the same project limits, make sure **realtime models are allowed**. A 403 when the call connects usually means
   they are not.
6. Create a key at <https://platform.openai.com/api-keys> with **Create new secret key**. Copy it straight away; it
   is shown only once. Do not use a read-only or restricted key that excludes Realtime. New users may be asked to
   verify a phone number first.
7. Put it in `.env.development`:

   ```
   OPENAI_API_KEY=sk-...
   ```

## 2. Twilio

1. Create an account at <https://www.twilio.com>.
2. Buy a number: in the Twilio Console go to **Phone Numbers > Manage > Buy a Number**, filter for **Voice**
   capability, and click **Buy** next to a number.
3. Trial accounts only accept calls from numbers you have **verified** with Twilio. Add your own mobile number as a
   verified caller ID in the console, or upgrade the account so anyone you choose can call.
4. Find your **Auth Token** in the Console home page under **Account Info** (next to the Account SID). Put it in `.env.development`:

   ```
   TWILIO_AUTH_TOKEN=...
   ```

   This lets the server reject requests that do not really come from Twilio.
5. For the TAC transport only, create a **Standard API Key** in **Builder tools > API Keys & auth tokens**. Add
   its SID and secret to `TWILIO_API_KEY` and `TWILIO_API_SECRET`, and set `TWILIO_ACCOUNT_SID` and
   `TWILIO_PHONE_NUMBER` in the environment too. Keep `VOICE_TRANSPORT=legacy` for local development; the TAC
   test deployment can set `VOICE_TRANSPORT=tac` and use its own set of Railway variables.
6. Tell the number where to send calls (after step 3 below gives you a public URL): click the number, open the
   **Configure** tab, find **Voice Configuration**, and in the **A call comes in** row choose **Webhook**. Set the
   URL to `https://YOUR-NGROK-URL/incoming-call` with method **HTTP POST**, and save.
7. Before sharing the number with anyone, restrict **Voice Geographic Permissions** to the countries you need and
   add **Usage Triggers**. See the security notes in the README.

Twilio charges for the number and for call minutes, and OpenAI charges for audio use. Check both pricing pages
before long testing sessions.

## 3. ngrok

1. Sign up at <https://ngrok.com> and install ngrok.
2. Add your token once: `ngrok config add-authtoken YOUR_TOKEN`.
3. Start a tunnel to the server's port: `ngrok http 5050`.
4. Copy the `https://...` address it shows into `.env.development` (no trailing slash):

   ```
   PUBLIC_BASE_URL=https://your-name.ngrok-free.dev
   PHONE_DISPLAY_NUMBER=(555) 013-0666
   ```

5. Use the same address in the Twilio webhook (step 2.5). The free plan gives you one stable dev domain; if your
   address ever changes, update both `.env.development` and the Twilio webhook.

ngrok's local inspector at <http://127.0.0.1:4040> shows every request Twilio sends, which is the quickest way to
debug the webhook.

## 4. Run it

```bash
nvm use                  # if you use nvm; the repo pins Node 22 via .nvmrc
npm install
cp .env.example .env.development     # if you have not already; fill in the values above
npm run build
npm run dev
```

Open <http://localhost:5050>, note the code on screen, then call your Twilio number and say it.

Quick check that the tunnel reaches your server: `curl https://YOUR-NGROK-URL/healthz` should print `{"ok":true,...}`.

## If something goes wrong

| Symptom | Likely cause |
| --- | --- |
| Twilio says "application error" and hangs up | The webhook URL is wrong, the server is not running, or ngrok is not running. Check the ngrok inspector. |
| Server log says it rejected `/incoming-call` | The signature check is failing. `PUBLIC_BASE_URL` must exactly match the URL in Twilio (https, no trailing slash), and `TWILIO_AUTH_TOKEN` must belong to the same Twilio account. |
| The call never connects from your phone | Trial account and the number is not verified. Verify it or upgrade. |
| You hear the greeting, then silence | OpenAI key, billing, or Realtime access. Look for `realtime error` or `could not connect to OpenAI Realtime` in the server log. |
| The QR code opens nothing on the phone | `PUBLIC_BASE_URL` is not set, so the QR points at localhost. Set it and restart. |
| The phone shows a warning page before the selfie page | ngrok's free-plan notice. Tap through; it shows once a week. |
