// Shared between server and web. Keep this file free of Node- or browser-only imports.
/** The five stages a caller moves through, in order. Each owns one planet in the scene. */
export const STAGES = ['pairing', 'language', 'selfie', 'humanCheck', 'ticket'];
export const PAIRING_ACRONYMS = {
    BRB: 'Be right back',
    LOL: 'Laughing out loud',
    OMG: 'Oh my gosh',
    TBH: 'To be honest',
    LMK: 'Let me know',
    SMH: 'Shaking my head',
    FOMO: 'Fear of missing out',
    YOLO: 'You only live once',
    BTW: 'By the way',
    FYI: 'For your information',
    ASAP: 'As soon as possible',
    AFK: 'Away from keyboard',
    IRL: 'In real life',
    IDK: "I don't know",
    IMO: 'In my opinion',
    IMHO: 'In my humble opinion',
    TTYL: 'Talk to you later',
    BFF: 'Best friends forever',
    ROFL: 'Rolling on the floor laughing',
    JK: 'Just kidding',
    ICYMI: 'In case you missed it',
    DIY: 'Do it yourself',
    FAQ: 'Frequently asked questions',
    RSVP: "Répondez s'il vous plaît (Please respond)",
};
export const PLANETS = {
    pairing: 'Lolzitron',
    language: 'La Biblioteca',
    selfie: 'Snapturn',
    humanCheck: 'Lengsdwarf',
    ticket: 'LOMB',
};
export const STAGE_LABELS = {
    pairing: 'Identify yourself',
    language: 'Language check',
    selfie: 'Photo ID',
    humanCheck: 'Humanity check',
    ticket: 'File a ticket',
};
