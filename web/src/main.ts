import './style.css';
import type { Device as TwilioDevice } from '@twilio/voice-sdk';
import { STAGE_LABELS, type ClientMessage, type ServerMessage, type Stage } from '../../shared/protocol.js';
import { createScene } from './scene.js';
import { initialState } from './state.js';
import { createUi } from './ui.js';

const SESSION_KEY = 'hdfh.session';

const state = initialState();
let showDevPhonePrompt = false;
let devPhoneConnecting = false;
const sceneRoot = document.getElementById('scene') as HTMLElement;
const labelRoot = document.getElementById('labels') as HTMLElement;
const appRoot = document.getElementById('app') as HTMLElement;

const whirr = new Audio('/audio/whirr.m4a');
const allonsy = new Audio('/audio/allonsy.m4a');
const surveyMusic = new Audio('/audio/opus-1-clip.mp3');
surveyMusic.loop = true;
let surveyOpen = false;

function showSurvey() {
  if (surveyOpen) return;
  surveyOpen = true;
  whirr.pause();
  allonsy.pause();
  playCue(surveyMusic);
  void ui.showSurvey().then(() => {
    surveyMusic.pause();
    surveyMusic.currentTime = 0;
    surveyOpen = false;
    send({ type: 'survey_completed', selection: 'happy' });
  });
}

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
      ui.setDevPhoneActive(false, 'Enter the Production access code first.');
      return;
    }
    if (devPhoneConnecting || activeDevCall) return;
    devPhoneConnecting = true;
    try {
      if (state.ended || state.paired || state.phase !== 'pairing') startNewCall();
      showDevPhonePrompt = true;
      scene?.goToLolzitron();
      render();
      const deadline = Date.now() + 5_000;
      while (!state.connected || !state.sessionId || !state.code) {
        if (Date.now() >= deadline) throw new Error('The app is not connected. Refresh and try again.');
        await new Promise(resolve => window.setTimeout(resolve, 50));
      }
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
      const device = devDevice;
      const call = await device.connect({ params: { To: data.phoneNumber } });
      activeDevCall = call;
      const finish = (status: string) => {
        if (activeDevCall !== call) return;
        activeDevCall = null;
        device.destroy();
        if (devDevice === device) devDevice = null;
        if (state.ended !== 'completed' && state.phase !== 'done') startNewCall();
        ui.setDevPhoneActive(false, status);
        render();
      };
      call.on('accept', () => ui.setDevPhoneActive(true, `Connected to ${data.phoneNumber}.`));
      call.on('disconnect', () => finish('Call ended.'));
      call.on('cancel', () => finish('Call cancelled.'));
      call.on('reject', () => finish('Call rejected.'));
      call.on('error', (error) => finish(error.message));
      ui.setDevPhoneActive(true, `Calling ${data.phoneNumber}…`);
    } catch (error) {
      devDevice?.destroy();
      devDevice = null;
      activeDevCall = null;
      ui.setDevPhoneActive(false, error instanceof Error ? error.message : 'Could not start the test call.');
    } finally {
      devPhoneConnecting = false;
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
const render = () => ui.render(state, showDevPhonePrompt && state.phase === 'pairing' ? 'pairing' : scene?.focusedStage ?? null);

let socket: WebSocket | null = null;
let retries = 0;
let reconnectTimer: number | undefined;

function send(message: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/ws/laptop`);
  socket = ws;

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    retries = 0;
    state.connected = true;
    send({ type: 'hello', sessionId: sessionStorage.getItem(SESSION_KEY) ?? undefined });
    render();
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return;
    try {
      handle(JSON.parse(String(event.data)) as ServerMessage);
    } catch (error) {
      console.error('Bad message from server', error);
    }
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) return;
    state.connected = false;
    render();
    const delay = Math.min(1000 * 2 ** retries, 8000);
    retries += 1;
    reconnectTimer = window.setTimeout(() => {
      if (socket === ws) connect();
    }, delay);
  });
}

function handle(message: ServerMessage) {
  switch (message.type) {
    case 'snapshot': {
      const phaseChanged = state.phase !== message.phase;
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
      // A reconnect refreshes the session, but must not clear the selected planet.
      if (phaseChanged) scene?.setPhase(message.phase);
      scene?.setPhoto(message.photo);
      if (message.surveyPending) showSurvey();
      break;
    }
    case 'show_survey':
      showSurvey();
      break;
    case 'state_changed': {
      const phaseChanged = state.phase !== message.phase;
      state.phase = message.phase;
      state.attempts = message.attempts;
      state.prompt = null; // the server clears the prompt on every state change
      if (phaseChanged) scene?.setPhase(message.phase);
      break;
    }
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
      surveyMusic.pause();
      ui.closeSurvey();
      surveyOpen = false;
      if (message.reason !== 'completed') {
        startNewCall();
        ui.toast('Call ended. Preparing a fresh code for your next call.', 'info');
        return;
      }
      state.ended = message.reason;
      break;
    case 'error':
      ui.toast(message.message, 'fail');
      break;
  }
  render();
  // Confirm that the browser handled the pairing transition and next prompt.
  if (message.type === 'paired' || message.type === 'state_changed' || message.type === 'show_language_prompt') {
    send({ type: 'event_received', eventType: message.type });
  }
}

function startNewCall() {
  // Detach first: late messages and close events from the old session must be ignored.
  window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  const previousSocket = socket;
  socket = null;
  previousSocket?.close();
  const previousCall = activeDevCall;
  activeDevCall = null;
  previousCall?.disconnect();
  devDevice?.destroy();
  devDevice = null;
  ui.setDevPhoneActive(false, 'Ready for a new call.');
  surveyMusic.pause();
  ui.closeSurvey();
  surveyOpen = false;
  sessionStorage.removeItem(SESSION_KEY);
  const { phoneNumber, tickets } = state;
  Object.assign(state, initialState(), { phoneNumber, tickets, connected: false });
  scene?.setPhoto(null);
  scene?.setPhase('pairing');
  scene?.goToLolzitron();
  retries = 0;
  render();
  connect();
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
