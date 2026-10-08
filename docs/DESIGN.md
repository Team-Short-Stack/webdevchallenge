# Design notes

The full design doc, with diagrams, lives here:
https://claude.ai/code/artifact/3c19e4b1-9392-4fc5-a811-863d15a1a677

## Decisions that shaped the code

- **The server decides, the model does not.** A per-call state machine (`server/src/machine.ts`) is the only thing
  that moves a caller between stages. The voice agent acts only through tool calls, and every tool checks the stage.
- **Pairing by spoken code.** The laptop shows a silly short code (letters, not digits); the caller spells it out;
  the agent calls `pair_session`.
- **Selfie by QR code, not SMS.** At the selfie stage the laptop shows a QR code holding a one-time link. The
  caller scans it with their phone camera. This avoids US texting registration.
- **Planets map to stages.** Lolzitron pairing, Translatopia language, Snapturn selfie, Lengsdwarf human check,
  Opus 1 ticket.
  Planet names are being reworked to be sillier; Lengsdwarf (renamed from Jupiter) is deliberately the smallest
  of the five, since a "dwarf" shouldn't be the biggest planet in the scene.
  (The word-puzzle stage and its planet, Venus, were cut — it took too long and exercised the same Twilio
  feature, the live Media Stream, as every other stage.)
- **Human check is drawn from six fashion-trivia questions, once per call.** Each pairs a photo shown on the
  laptop with a season/episode question; the server extracts the spoken number and checks it, never the prompt.
- **Tickets live in memory** and appear in a side list on every laptop.
- **Calls are not recorded.** The selfie is held in memory and dropped when the session is swept.
- **Hosting:** run it on a laptop behind ngrok, or on a host that runs a long-lived Node process (Railway, Fly.io,
  Cloud Run with a 60 minute timeout). Serverless hosts that cannot hold a WebSocket server are a poor fit.

## Deviations from the doc

The human check no longer draws from the original five generic tasks (coin flips, CAPTCHA, word count, a
tongue-twister). It now always asks one of six fashion-trivia questions about Jason's past wardrobe choices,
each shown with a photo on the laptop and judged by extracting a season/episode number from the transcript.

The word-puzzle stage (`puzzle` / Venus) was removed entirely. It only exercised the live Media Stream the
same way every other stage already does, and it was slower than the gauntlet needed to be.
