// One-off helper: asks OpenAI for a batch of silly, meaningless pairing-code acronyms.
// Run with: npm run generate-codes --workspace server
// Prints a TS array literal to paste into content.ts. Does not touch any files itself.

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(1);
}

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content:
          'Give me 25 silly 3-to-5-letter acronym-style codes for a comedy bit, in the shape of real internet ' +
          'slang like FML, LYLS, SMH, BRB, TBH, LMK, FOMO, YOLO, IYKYK — invent new absurd ones in that same ' +
          'rhythm (real or nonsense, as long as they sound like something you would text), not random letter ' +
          'noise (bad: ZLXP, KQJT, PQRS) and not real dictionary words or sound effects (bad: FIZZ, BLOB, ' +
          'FROG, YAWN, BEEP). A caller reads these aloud letter by letter over a phone line, so avoid letters ' +
          'that are easily confused by ear — no B, D, P, T, V, or the letters I, O (too close to 1, 0). Avoid ' +
          'anything genuinely offensive. Reply with ONLY a JSON array of strings, nothing else.',
      },
    ],
    temperature: 1,
  }),
});

if (!res.ok) {
  console.error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const text = data.choices[0].message.content.trim();
const cleaned = text.replace(/^```json\s*|```$/g, '').trim();
const codes: string[] = JSON.parse(cleaned);

const unique = [...new Set(codes.map((c) => c.toUpperCase()))].filter((c) => /^[A-Z]{3,5}$/.test(c));

console.log(`export const PAIRING_CODES = [\n${unique.map((c) => `  '${c}',`).join('\n')}\n] as const;`);
