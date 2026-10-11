import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import twilio from 'twilio';
import {
  TAC,
  TACConfig,
  TACServer,
  VoiceChannel,
  VoiceProvider,
  VoiceProviderConfig,
  type TwiMLRequest,
  type VoiceTwiMLOptions,
} from 'twilio-agent-connect';
import type { WebSocket } from 'ws';
import type { Config } from './config.js';
import { maskNumber } from './config.js';
import { StreamGate } from './gate.js';
import type { CallSession, Registry } from './sessions.js';
import { handlePhoneCall } from './voice.js';

interface TacVoiceDeps {
  app: FastifyInstance;
  config: Config;
  registry: Registry;
  gate: StreamGate;
  getActiveCalls: () => number;
  incrementActiveCalls: (delta: number) => void;
  onFinalHold: (session: CallSession, token: string, callSid: string) => void;
}

class AppVoiceProvider extends VoiceProvider {
  constructor(channel: VoiceChannel, private readonly deps: TacVoiceDeps) {
    super(channel);
  }

  override async handleIncomingCall(request?: TwiMLRequest, _options?: { hostTwimlOptions?: VoiceTwiMLOptions }): Promise<string> {
    const { config, gate, getActiveCalls } = this.deps;
    const from = request?.from;
    if (config.allowedCallers.length > 0 && (!from || (!from.startsWith('client:dev_') && !config.allowedCallers.includes(from)))) {
      this.logger.warn({ from: maskNumber(from) }, 'rejected caller not on the allow list');
      return this.rejectCall('This line is closed to you. Please try again never.');
    }
    if (getActiveCalls() + gate.pending >= config.maxConcurrentCalls) {
      this.logger.warn({ activeCalls: getActiveCalls() }, 'rejected call: at the concurrent call limit');
      return this.rejectCall('All of our agents are busy ignoring other callers. Please try again later.');
    }

    const base = config.publicBaseUrl;
    if (!base) throw new Error('PUBLIC_BASE_URL is required for TAC voice calls.');
    const token = randomUUID();
    const callSid = request?.callSid;
    const vr = new twilio.twiml.VoiceResponse();
    vr.say(
      { voice: 'Polly.Brian-Neural', language: 'en-GB' },
      'Thank you for calling Universal Help Care. Your call is important to us. Please find the letter code on your screen, and spell it out when prompted.',
    );
    const connect = vr.connect();
    connect.stream({ url: `wss://${new URL(base).host}/media-stream` })
      .parameter({ name: 'endingToken', value: token });
    vr.redirect({ method: 'POST' }, `${base}/final-hold?t=${token}`);
    gate.grant();
    this.logger.info({ from: maskNumber(from), callSid }, 'incoming TAC call accepted');
    return vr.toString();
  }

  override handleWebSocket(socket: WebSocket): void {
    const { config, gate, registry, incrementActiveCalls, onFinalHold } = this.deps;
    if (!gate.consume()) {
      this.logger.warn('rejected a TAC media stream with no matching incoming call');
      socket.close(1008, 'unexpected stream');
      return;
    }
    incrementActiveCalls(1);
    void handlePhoneCall(socket, {
      config,
      registry,
      log: this.logger,
      onFinalHold,
      onCallEnd: () => incrementActiveCalls(-1),
    });
  }

  private rejectCall(message: string): string {
    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: 'Polly.Brian-Neural', language: 'en-GB' }, message);
    vr.hangup();
    return vr.toString();
  }
}

class AppVoiceProviderConfig extends VoiceProviderConfig {
  constructor(private readonly deps: TacVoiceDeps) {
    super({ memoryMode: 'never' });
  }

  override createProvider(channel: VoiceChannel): VoiceProvider {
    return new AppVoiceProvider(channel, this.deps);
  }
}

export async function attachTacServer(deps: TacVoiceDeps): Promise<{ tac: TAC; server: TACServer }> {
  const { config } = deps;
  const publicUrl = new URL(config.publicBaseUrl!);

  const tacConfig = new TACConfig({
    accountSid: config.twilioAccountSid!,
    authToken: config.twilioAuthToken!,
    apiKey: config.twilioApiKey!,
    apiSecret: config.twilioApiSecret!,
    phoneNumber: config.twilioPhoneNumber!,
    voicePublicDomain: publicUrl.host,
    voiceWebsocketPath: '/media-stream',
    voiceActionPath: '/tac-action',
    voiceCallEventPath: '/twilio/call-events',
  });
  const tac = await TAC.create({ config: tacConfig });
  const voiceChannel = new VoiceChannel(tac, new AppVoiceProviderConfig(deps));
  tac.registerChannel(voiceChannel);
  const server = new TACServer(tac, {
    fastifyInstance: deps.app,
    host: '0.0.0.0',
    port: config.port,
    voiceChannel,
    webhookPaths: { twiml: '/incoming-call' },
  });
  return { tac, server };
}
