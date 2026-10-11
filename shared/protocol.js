// Shared between server and web. Keep this file free of Node- or browser-only imports.
/** The five stages a caller moves through, in order. Each owns one planet in the scene. */
export const STAGES = ['pairing', 'language', 'selfie', 'humanCheck', 'ticket'];
export const PLANETS = {
    pairing: 'Lolzitron',
    language: 'Translatopia',
    selfie: 'Snapturn',
    humanCheck: 'Lengsdwarf',
    ticket: 'Opus 1',
};
export const STAGE_LABELS = {
    pairing: 'Identify yourself',
    language: 'Language check',
    selfie: 'Photo ID',
    humanCheck: 'Humanity check',
    ticket: 'File a ticket',
};
