// All the absurd things callers are asked to do. Edit freely.

export type Rng = () => number;

export interface Puzzle {
  display: string;
  answer: string;
}

/** Ordered easy to hard. A failed attempt moves the caller to the next one. */
export const PUZZLES: Puzzle[] = [
  { display: 'TKCIET', answer: 'ticket' },
  { display: 'RIRPNET', answer: 'printer' },
  { display: 'DWORSPSA', answer: 'password' },
  { display: 'WEIFLARL', answer: 'firewall' },
  { display: 'I have keys but open no locks. What am I?', answer: 'keyboard' },
  { display: 'I have a mouse but have never eaten cheese. What am I?', answer: 'computer' },
];

export interface LanguageCheck {
  language: string;
  phrase: string;
  meaning: string;
}

export const LANGUAGES: LanguageCheck[] = [
  { language: 'Spanish', phrase: 'Mi impresora está en llamas', meaning: 'My printer is on fire' },
  { language: 'French', phrase: "Mon imprimante est en feu", meaning: 'My printer is on fire' },
  { language: 'German', phrase: 'Mein Drucker brennt', meaning: 'My printer is on fire' },
  { language: 'Italian', phrase: 'La mia stampante è in fiamme', meaning: 'My printer is on fire' },
  { language: 'Portuguese', phrase: 'A minha impressora está a arder', meaning: 'My printer is on fire' },
];

/** Ordered by absurdity. Each failed selfie escalates to the next. */
export const SELFIE_REQUIREMENTS: string[] = [
  'wearing something on your head (a hat, a bowl, a sock, anything)',
  'holding up exactly three fingers',
  'making the most disappointed face you can manage',
  'holding an object that is not a pen, while raising one eyebrow',
];

export type HumanCheckJudge = 'coinflip' | 'exact' | 'wordcount' | 'model';

export interface HumanCheck {
  id: string;
  title: string;
  /** What the agent asks the caller to do. */
  prompt: string;
  judge: HumanCheckJudge;
  /** For 'exact': the string to match. For 'wordcount': the number of words. */
  expected?: string | number;
  /** Shown in the laptop scene (for example, the CAPTCHA code). */
  display?: string;
}

/** Five tasks. One is drawn at random per call. The server judges, never the prompt. */
export const HUMAN_CHECK_IDS = [
  'happy-birthday',
  'modem',
  'captcha',
  'seven-word-meal',
  'tongue-twister',
] as const;
export type HumanCheckId = (typeof HUMAN_CHECK_IDS)[number];

// Letters that are hard to confuse when spoken aloud.
const CAPTCHA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

export function randomCaptcha(rng: Rng, length = 5): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CAPTCHA_ALPHABET[Math.floor(rng() * CAPTCHA_ALPHABET.length)];
  }
  return out;
}

export function buildHumanCheck(id: HumanCheckId, rng: Rng): HumanCheck {
  switch (id) {
    case 'happy-birthday':
      return {
        id,
        title: 'Cultural compliance',
        prompt: 'Sing Happy Birthday to the help desk. All the way through.',
        judge: 'coinflip',
      };
    case 'modem':
      return {
        id,
        title: 'Legacy protocol handshake',
        prompt: 'Make your best dial-up modem noise.',
        judge: 'coinflip',
      };
    case 'captcha': {
      const code = randomCaptcha(rng);
      return {
        id,
        title: 'Visual verification',
        prompt: 'Read aloud the distorted code shown on your screen, one letter at a time.',
        judge: 'exact',
        expected: code,
        display: code,
      };
    }
    case 'seven-word-meal':
      return {
        id,
        title: 'Biographical audit',
        prompt: 'Describe your last meal in exactly seven words.',
        judge: 'wordcount',
        expected: 7,
      };
    case 'tongue-twister':
      return {
        id,
        title: 'Articulation audit',
        prompt: "Say 'she sells seashells by the seashore' three times, fast.",
        judge: 'model',
      };
  }
}

export function pickOne<T>(items: readonly T[], rng: Rng): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pickOne called with an empty list');
  return item;
}

export function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
