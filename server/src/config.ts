import { z } from 'zod';

// Treat empty strings in .env (for example `TWILIO_AUTH_TOKEN=`) as "not set".
const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(5050),
  NODE_ENV: z.string().default('development'),
  VOICE_TRANSPORT: z.enum(['legacy', 'tac']).default('legacy'),

  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-2.1'),
  OPENAI_VOICE: z.string().default('cedar'),
  OPENAI_REASONING_EFFORT: optional(z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])),
  OPENAI_VAD_THRESHOLD: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1).default(0.6)),
  OPENAI_INPUT_NOISE_REDUCTION: z.preprocess(blankToUndefined, z.enum(['near_field', 'far_field', 'none']).default('far_field')),
  OPENAI_INTERRUPT_RESPONSE: z.preprocess(blankToUndefined, z.enum(['true', 'false']).default('false')).transform(v => v === 'true'),

  /** The public https URL of this server, for example your ngrok URL. Used for the QR code and signature checks. */
  PUBLIC_BASE_URL: optional(z.string().url()),
  /** When set, requests to /incoming-call must carry a valid Twilio signature. Required in production. */
  TWILIO_AUTH_TOKEN: optional(z.string()),
  TWILIO_ACCOUNT_SID: optional(z.string()),
  TWILIO_API_KEY: optional(z.string()),
  TWILIO_API_SECRET: optional(z.string()),
  TWILIO_PHONE_NUMBER: optional(z.string()),
  TWILIO_TWIML_APP_SID: optional(z.string().startsWith('AP')),
  ENABLE_DEV_PHONE: z.preprocess(blankToUndefined, z.string().default('false')).transform((v) => v === 'true'),
  DEV_PHONE_ACCESS_CODE: optional(z.string().min(16)),

  /** Comma-separated E.164 numbers allowed to call. Empty means anyone can call. */
  ALLOWED_CALLERS: z.preprocess(blankToUndefined, z.string().default('')),
  MAX_CALL_MINUTES: z.coerce.number().positive().default(10),
  MAX_CONCURRENT_CALLS: z.coerce.number().int().positive().default(2),

  /** The number callers dial, shown on the laptop screen (any format you like). */
  PHONE_DISPLAY_NUMBER: optional(z.string()),

  /** Folder with the built web app. Defaults to ../web/dist next to this server. */
  WEB_DIST: optional(z.string()),
});

export interface Config {
  port: number;
  isProduction: boolean;
  voiceTransport: 'legacy' | 'tac';
  openaiApiKey: string;
  realtimeModel: string;
  voice: string;
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
  vadThreshold: number;
  inputNoiseReduction: 'near_field' | 'far_field' | 'none';
  interruptResponse: boolean;
  publicBaseUrl: string | undefined;
  twilioAuthToken: string | undefined;
  twilioAccountSid: string | undefined;
  twilioApiKey: string | undefined;
  twilioApiSecret: string | undefined;
  twilioPhoneNumber: string | undefined;
  twilioTwimlAppSid: string | undefined;
  enableDevPhone: boolean;
  devPhoneAccessCode: string | undefined;
  allowedCallers: string[];
  maxCallMinutes: number;
  maxConcurrentCalls: number;
  phoneDisplayNumber: string | undefined;
  webDist: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration. Check your .env file:\n${problems}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  // Catch a copied Railway URL before it sends call media to another environment.
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim().toLowerCase();
  if (railwayDomain && e.PUBLIC_BASE_URL) {
    const configuredDomain = new URL(e.PUBLIC_BASE_URL).hostname.toLowerCase();
    if (configuredDomain.endsWith('.up.railway.app') && railwayDomain.endsWith('.up.railway.app') && configuredDomain !== railwayDomain) {
      throw new Error(`PUBLIC_BASE_URL points to ${configuredDomain}, but this Railway service is ${railwayDomain}. Set PUBLIC_BASE_URL=https://${railwayDomain} in this environment.`);
    }
  }
  if (isProduction && !e.TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_AUTH_TOKEN is required when NODE_ENV=production, so Twilio signatures can be checked.');
  }
  if (e.VOICE_TRANSPORT === 'tac') {
    const requiredForTac = [
      ['TWILIO_ACCOUNT_SID', e.TWILIO_ACCOUNT_SID],
      ['TWILIO_API_KEY', e.TWILIO_API_KEY],
      ['TWILIO_API_SECRET', e.TWILIO_API_SECRET],
      ['TWILIO_PHONE_NUMBER', e.TWILIO_PHONE_NUMBER],
      ['PUBLIC_BASE_URL', e.PUBLIC_BASE_URL],
      ['TWILIO_AUTH_TOKEN', e.TWILIO_AUTH_TOKEN],
    ] as const;
    const missing = requiredForTac.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`VOICE_TRANSPORT=tac requires: ${missing.join(', ')}.`);
    }
  }
  if (e.ENABLE_DEV_PHONE) {
    const required = [
      ['TWILIO_ACCOUNT_SID', e.TWILIO_ACCOUNT_SID],
      ['TWILIO_API_KEY', e.TWILIO_API_KEY],
      ['TWILIO_API_SECRET', e.TWILIO_API_SECRET],
      ['TWILIO_PHONE_NUMBER', e.TWILIO_PHONE_NUMBER],
      ['TWILIO_TWIML_APP_SID', e.TWILIO_TWIML_APP_SID],
      ['DEV_PHONE_ACCESS_CODE', e.DEV_PHONE_ACCESS_CODE],
      ['TWILIO_AUTH_TOKEN', e.TWILIO_AUTH_TOKEN],
      ['PUBLIC_BASE_URL', e.PUBLIC_BASE_URL],
    ] as const;
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`ENABLE_DEV_PHONE=true requires: ${missing.join(', ')}.`);
  }
  return {
    port: e.PORT,
    isProduction,
    voiceTransport: e.VOICE_TRANSPORT,
    openaiApiKey: e.OPENAI_API_KEY,
    realtimeModel: e.OPENAI_REALTIME_MODEL,
    voice: e.OPENAI_VOICE,
    reasoningEffort: e.OPENAI_REASONING_EFFORT,
    vadThreshold: e.OPENAI_VAD_THRESHOLD,
    inputNoiseReduction: e.OPENAI_INPUT_NOISE_REDUCTION,
    interruptResponse: e.OPENAI_INTERRUPT_RESPONSE,
    publicBaseUrl: e.PUBLIC_BASE_URL?.replace(/\/+$/, ''),
    twilioAuthToken: e.TWILIO_AUTH_TOKEN,
    twilioAccountSid: e.TWILIO_ACCOUNT_SID,
    twilioApiKey: e.TWILIO_API_KEY,
    twilioApiSecret: e.TWILIO_API_SECRET,
    twilioPhoneNumber: e.TWILIO_PHONE_NUMBER,
    twilioTwimlAppSid: e.TWILIO_TWIML_APP_SID,
    enableDevPhone: e.ENABLE_DEV_PHONE,
    devPhoneAccessCode: e.DEV_PHONE_ACCESS_CODE,
    allowedCallers: e.ALLOWED_CALLERS.split(',')
      .map((n) => n.trim())
      .filter(Boolean),
    maxCallMinutes: e.MAX_CALL_MINUTES,
    maxConcurrentCalls: e.MAX_CONCURRENT_CALLS,
    phoneDisplayNumber: e.PHONE_DISPLAY_NUMBER,
    webDist: e.WEB_DIST,
  };
}

/** Show only the last four digits of a phone number in logs. */
export function maskNumber(n: string | undefined): string {
  if (!n) return 'unknown';
  return `***${n.slice(-4)}`;
}
