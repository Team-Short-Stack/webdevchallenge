# Design notes

The full design doc, with diagrams, lives here:
https://claude.ai/code/artifact/3c19e4b1-9392-4fc5-a811-863d15a1a677

## Decisions that shaped the code

- **The server decides, the model does not.** A per-call state machine (`server/src/machine.ts`) is the only thing
  that moves a caller between stages. The voice agent acts only through tool calls, and every tool checks the stage.
- **Pairing by spoken code.** The laptop shows a 4-digit code; the caller says it; the agent calls `pair_session`.
- **Selfie by QR code, not SMS.** At the selfie stage the laptop shows a QR code holding a one-time link. The
  caller scans it with their phone camera. This avoids US texting registration.
- **Planets map to stages.** Mercury pairing, Venus puzzle, Earth language, Mars selfie, Jupiter human check,
  Saturn ticket.
- **Human check is drawn from five tasks, once per call.** Coin flips, an exact-match CAPTCHA, a word count and a
  model verdict. Randomness and matching happen on the server, never in the prompt.
- **Tickets live in memory** and appear in a side list on every laptop.
- **Calls are not recorded.** The selfie is held in memory and dropped when the session is swept.
- **Hosting:** run it on a laptop behind ngrok, or on a host that runs a long-lived Node process (Railway, Fly.io,
  Cloud Run with a 60 minute timeout). Serverless hosts that cannot hold a WebSocket server are a poor fit.

## One deviation from the doc

The "seven-word meal" check is judged by the server counting words in the transcript, not by the model.
