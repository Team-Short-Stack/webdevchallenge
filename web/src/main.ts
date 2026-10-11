import './style.css';
import type { Device as TwilioDevice } from '@twilio/voice-sdk';
import { STAGE_LABELS, type ClientMessage, type ServerMessage, type Stage } from '../../shared/protocol.js';
import { createScene } from './scene.js';
import { initialState } from './state.js';
import { createUi } from './ui.js';

const SESSION_KEY = 'hdfh.session';

const state = initialState();
const sceneRoot = document.getElementById('scene') as HTMLElement;
const labelRoot = document.getElementById('labels') as HTMLElement;
const appRoot = document.getElementById('app') as HTMLElement;

const whirr = new Audio('/audio/whirr.m4a');
const allonsy = new Audio('/audio/allonsy.m4a');

function playCue(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  void audio.play().catch((error: unknown) => console.warn('Audio cue could not play', error));
}

const scene = createScene(sceneRoot, labelRoot, () => {
  allonsy.pause();
  playCue(whirr);
  ui.showWelcome();
}, () => render());
if (!scene) {
  document.body.classList.add('no-webgl');
  sceneRoot.removeAttribute('aria-hidden');
  sceneRoot.textContent = 'Your browser cannot draw the planets. The help desk still works.';
}

const ui = createUi(appRoot, {
  onNewCall: startNewCall,
  async onDevPhone(accessCode) {
    if (!accessCode) {
      ui.setDevPhoneActive(false, 'Enter the Sandbox access code first.');
      return;
    }
    try {
      ui.setDevPhoneActive(false, 'Connecting to Twilio…');
      const { Device } = await import('@twilio/voice-sdk');
      const response = await fetch('/api/dev-phone/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      });
      const data = await response.json() as { token?: string; phoneNumber?: string; error?: string };
      if (!response.ok || !data.token || !data.phoneNumber) throw new Error(data.error ?? 'Dev Phone is not configured.');
      devDevice?.destroy();
      devDevice = new Device(data.token);
      devDevice.on('error', (error) => ui.setDevPhoneActive(false, error.message));
      const call = await devDevice.connect({ params: { To: data.phoneNumber } });
      activeDevCall = call;
      call.on('accept', () => ui.setDevPhoneActive(true, `Connected to ${data.phoneNumber}.`));
      call.on('disconnect', () => {
        activeDevCall = null;
        devDevice?.destroy();
        devDevice = null;
        ui.setDevPhoneActive(false, 'Call ended.');
      });
      call.on('cancel', () => ui.setDevPhoneActive(false, 'Call cancelled.'));
      ui.setDevPhoneActive(true, `Calling ${data.phoneNumber}…`);
    } catch (error) {
      devDevice?.destroy();
      devDevice = null;
      ui.setDevPhoneActive(false, error instanceof Error ? error.message : 'Could not start the test call.');
    }
  },
  onHangupDevPhone() {
    activeDevCall?.disconnect();
    activeDevCall = null;
    devDevice?.destroy();
    devDevice = null;
    ui.setDevPhoneActive(false, 'Call ended.');
  },
  onGetStarted() {
    whirr.pause();
    playCue(allonsy);
    scene?.goToLolzitron();
  },
});
let devDevice: TwilioDevice | null = null;
let activeDevCall: ReturnType<TwilioDevice['connect']> extends Promise<infer T> ? T | null : null = null;
const render = () => ui.render(state, scene?.focusedStage ?? null);

let socket: WebSocket | null = null;
let retries = 0;
let reconnectNow = false;

function send(message: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/ws/laptop`);
  socket = ws;

  ws.addEventListener('open', () => {
    retries = 0;
    state.connected = true;
    send({ type: 'hello', sessionId: sessionStorage.getItem(SESSION_KEY) ?? undefined });
    render();
  });

  ws.addEventListener('message', (event) => {
    try {
      handle(JSON.parse(String(event.data)) as ServerMessage);
    } catch (error) {
      console.error('Bad message from server', error);
    }
  });

  ws.addEventListener('close', () => {
    state.connected = false;
    render();
    const delay = reconnectNow ? 0 : Math.min(1000 * 2 ** retries, 8000);
    reconnectNow = false;
    retries += 1;
    window.setTimeout(connect, delay);
  });
}

function handle(message: ServerMessage) {
  switch (message.type) {
    case 'snapshot':
      Object.assign(state, {
        sessionId: message.sessionId,
        code: message.code,
        phase: message.phase,
        attempts: message.attempts,
        paired: message.paired,
        prompt: message.prompt,
        photo: message.photo,
        tickets: message.tickets,
        ended: null,
      });
      sessionStorage.setItem(SESSION_KEY, message.sessionId);
      scene?.setPhase(message.phase);
      scene?.setPhoto(message.photo);
      break;
    case 'state_changed':
      state.phase = message.phase;
      state.attempts = message.attempts;
      state.prompt = null; // the server clears the prompt on every state change
      scene?.setPhase(message.phase);
      break;
    case 'paired':
      state.paired = true;
      ui.toast('Verified. Barely.', 'pass');
      break;
    case 'show_language_prompt':
    case 'show_qr':
    case 'show_human_check':
      state.prompt = message;
      break;
    case 'selfie_received':
      state.photo = message.photo;
      scene?.setPhoto(message.photo);
      break;
    case 'test_result': {
      scene?.flash(message.stage, message.passed);
      const label = STAGE_LABELS[message.stage as Stage];
      ui.toast(`${label}: ${message.passed ? 'passed' : message.note?.toLowerCase() === 'inconclusive' ? 'inconclusive' : 'failed'}`, message.passed ? 'pass' : 'fail');
      if (message.stage === 'selfie' && !message.passed) {
        state.photo = null;
        scene?.setPhoto(null);
      }
      break;
    }
    case 'ticket_created':
      state.tickets = [message.ticket, ...state.tickets.filter((t) => t.id !== message.ticket.id)].slice(0, 20);
      if (message.mine) state.myTicket = message.ticket;
      break;
    case 'call_ended':
      state.ended = message.reason;
      break;
    case 'error':
      ui.toast(message.message, 'fail');
      break;
  }
  render();
}

function startNewCall() {
  sessionStorage.removeItem(SESSION_KEY);
  const { phoneNumber, tickets } = state;
  Object.assign(state, initialState(), { phoneNumber, tickets, connected: false });
  scene?.setPhoto(null);
  scene?.setPhase('pairing');
  reconnectNow = true;
  socket?.close();
  render();
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const config = (await res.json()) as { phoneNumber: string | null };
      state.phoneNumber = config.phoneNumber;
      render();
    }
  } catch {
    /* the number is optional */
  }
  try {
    const res = await fetch('/api/dev-phone/config');
    ui.setDevPhoneVisible(res.ok);
  } catch {
    ui.setDevPhoneVisible(false);
  }
}

scene?.setPhase('pairing');
render();
void loadConfig();
connect();
