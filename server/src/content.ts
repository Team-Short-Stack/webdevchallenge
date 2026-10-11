// All the absurd things callers are asked to do. Edit freely.
import { PAIRING_ACRONYMS } from '../../shared/protocol.js';

export type Rng = () => number;

/** Clean, familiar acronyms the caller spells out to the agent. */
export const PAIRING_CODES = Object.keys(PAIRING_ACRONYMS);

export interface LanguageCheck {
  language: string;
  phrase: string;
  meaning: string;
}

export const LANGUAGES: LanguageCheck[] = [
  { language: 'Spanish', phrase: 'adonde esta la biblioteca', meaning: 'Where is the library?' },
  { language: 'French', phrase: 'Où est la bibliothèque ?', meaning: 'Where is the library?' },
  { language: 'German', phrase: 'Wo ist die Bibliothek?', meaning: 'Where is the library?' },
  { language: 'Italian', phrase: "Dov'è la biblioteca?", meaning: 'Where is the library?' },
  { language: 'Portuguese', phrase: 'Onde fica a biblioteca?', meaning: 'Where is the library?' },
];

/** Ordered by absurdity. Each failed selfie escalates to the next. */
export const SELFIE_REQUIREMENTS: string[] = [
  'wearing something on your head (a hat, a bowl, a sock, anything)',
  'holding up exactly three fingers',
  'making the most disappointed face you can manage',
  'holding an object that is not a pen, while raising one eyebrow',
];

export type HumanCheckJudge = 'number';

export interface HumanCheck {
  id: string;
  title: string;
  /** What the agent asks the caller to do. */
  prompt: string;
  judge: HumanCheckJudge;
  /** The correct season or episode number. */
  expected: number;
  /** Shown in the laptop scene alongside the question. */
  imageUrl: string;
}

/** Six fashion-trivia questions, one of Jason's looks per photo. One is drawn at random per call. */
export const HUMAN_CHECK_IDS = [
  'sunflower-pants',
  'pitbull',
  'mister-rogers',
  'read-freely',
  'cheetah',
  'sad-computer',
] as const;
export type HumanCheckId = (typeof HUMAN_CHECK_IDS)[number];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/** Pulls a season/episode number out of whatever the caller said, digits or spelled out. */
export function extractNumber(heard: string): number | null {
  const digits = heard.match(/\d+/);
  if (digits) return Number(digits[0]);
  const words = heard.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  for (const word of words) {
    const value = NUMBER_WORDS[word];
    if (value !== undefined) return value;
  }
  return null;
}

export function buildHumanCheck(id: HumanCheckId): HumanCheck {
  switch (id) {
    case 'sunflower-pants':
      return {
        id,
        title: 'Fashion archive',
        prompt: 'A photo is on your screen. In which season did Jason wear those famous sunflower pants?',
        judge: 'number',
        expected: 2,
        imageUrl: '/fashion/sunflower-pants.png',
      };
    case 'pitbull':
      return {
        id,
        title: 'Fashion archive',
        prompt:
          'A photo is on your screen. In season two, which episode did Jason resemble a certain Cuban-American rapper?',
        judge: 'number',
        expected: 6,
        imageUrl: '/fashion/pitbull.png',
      };
    case 'mister-rogers':
      return {
        id,
        title: 'Fashion archive',
        prompt: 'A photo is on your screen. Which episode found Jason channeling Mister Rogers in a smoking cardigan?',
        judge: 'number',
        expected: 3,
        imageUrl: '/fashion/mister-rogers.png',
      };
    case 'read-freely':
      return {
        id,
        title: 'Fashion archive',
        prompt: 'In which episode of season 2 did Jason wear his very smart "free people read freely" sweater?',
        judge: 'number',
        expected: 12,
        imageUrl: '/fashion/read-freely.png',
      };
    case 'cheetah':
      return {
        id,
        title: 'Fashion archive',
        prompt: 'A photo is on your screen. In season two, which episode did Jason most resemble a cheetah?',
        judge: 'number',
        expected: 5,
        imageUrl: '/fashion/cheetah.png',
      };
    case 'sad-computer':
      return {
        id,
        title: 'Fashion archive',
        prompt: 'A photo is on your screen. In which season did Jason sport the fan-created "sad computer" tee?',
        judge: 'number',
        expected: 2,
        imageUrl: '/fashion/sad-computer.png',
      };
  }
}

export function pickOne<T>(items: readonly T[], rng: Rng): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pickOne called with an empty list');
  return item;
}

export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
