import QRCode from 'qrcode';
import { STAGE_LABELS, type Stage, type Ticket } from '../../shared/protocol.js';
import type { AppState } from './state.js';

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export interface UiApi {
  showWelcome(): void;
  render(state: AppState, focusedStage: Stage | null): void;
  toast(message: string, tone: 'pass' | 'fail' | 'info'): void;
}

export function createUi(root: HTMLElement, handlers: { onNewCall(): void; onGetStarted(): void }): UiApi {
  const promptHost = el('section', { class: 'prompt', 'aria-live': 'polite' });
  const ticketList = el('ol', { class: 'ticket-list' });
  const ticketsPanel = el('aside', { class: 'tickets', 'aria-label': 'Tickets' }, el('h2', {}, 'Tickets'), ticketList);
  const ticketsMenu = el('details', { class: 'tickets-menu' },
    el('summary', {}, 'Tickets'),
    ticketsPanel,
  );
  const toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  const endHost = el('div', { class: 'end', hidden: '' });

  root.append(promptHost, ticketsMenu, toastHost, endHost);

  const welcome = el('dialog', { class: 'welcome', 'aria-labelledby': 'welcome-title', 'aria-describedby': 'welcome-message' },
    el('div', { class: 'slip' },
      el('h1', { id: 'welcome-title' }, 'welcome to universal help care.'),
      el('p', { id: 'welcome-message', class: 'summary' }, "let's just make sure you are not a dalek."),
      el('button', { class: 'button', type: 'button', autofocus: '' }, 'get started'),
    ),
  );
  root.append(welcome);
  welcome.querySelector('button')?.addEventListener('click', () => {
    welcome.close();
    handlers.onGetStarted();
  });

  let promptKey = '';
  let countdownTimer: number | undefined;

  function slip(title: string, ...body: Child[]) {
    return el('div', { class: 'slip' }, el('h1', {}, title), ...body);
  }

  function buildPrompt(state: AppState): { key: string; node: HTMLElement | null } {
    if (!state.connected && !state.sessionId) {
      return { key: 'connecting', node: slip('Connecting to the help desk', el('p', { class: 'hint' }, 'Please hold.')) };
    }
    if (state.ended === 'completed' || state.phase === 'done') {
      const t = state.myTicket;
      const key = `done:${t?.id ?? ''}`;
      return {
        key,
        node: slip(
          t ? `Ticket ${t.id} filed` : 'Ticket filed',
          t ? el('p', { class: 'summary' }, t.summary) : null,
          el('p', { class: 'hint' }, 'Someone may respond eventually. Thank you for your patience.'),
          el('button', { class: 'button', type: 'button' }, 'Start a new call'),
        ),
      };
    }
    if (state.phase === 'pairing') {
      const code = state.code ?? '----';
      const number = state.phoneNumber ?? 'the help desk number';
      return {
        key: `pairing:${code}:${number}`,
        node: slip(
          'Call to be served',
          el('p', { class: 'phone' }, number),
          el('p', { class: 'hint' }, 'When the agent answers, say this code:'),
          el('p', { class: 'code', 'aria-label': `Code ${code.split('').join(' ')}` }, code.split('').join(' ')),
        ),
      };
    }
    if (state.phase === 'ticket') {
      return {
        key: 'ticket',
        node: slip('File your ticket', el('p', { class: 'hint' }, 'Tell the agent what is wrong. Be specific; it will not help.')),
      };
    }
    if (state.phase === 'selfie' && state.photo) {
      return { key: 'selfie-judging', node: slip('Photo received', el('p', { class: 'hint' }, 'The agent is reviewing your face. Please remain neutral.')) };
    }

    const prompt = state.prompt;
    if (!prompt) {
      return { key: `waiting:${state.phase}:${state.attempts[state.phase as Stage] ?? 0}`, node: slip(STAGE_LABELS[state.phase as Stage] ?? 'Please hold', el('p', { class: 'hint' }, 'Listen to the agent.')) };
    }

    switch (prompt.type) {
      case 'show_language_prompt':
        return {
          key: `language:${prompt.language}`,
          node: slip(
            `Say this in ${prompt.language}`,
            el('p', { class: 'phrase', lang: languageTag(prompt.language) }, prompt.phrase),
            el('p', { class: 'hint' }, 'The agent is listening to your pronunciation.'),
          ),
        };
      case 'show_qr': {
        const canvas = el('canvas', { class: 'qr', width: '220', height: '220', 'aria-label': 'QR code for the photo page' });
        void QRCode.toCanvas(canvas, prompt.url, { width: 220, margin: 1, color: { dark: '#0b1020', light: '#e6ebf2' } });
        const countdown = el('p', { class: 'hint countdown' }, '');
        const tick = () => {
          const left = Math.max(0, Math.round((prompt.expiresAt - Date.now()) / 1000));
          countdown.textContent =
            left > 0 ? `Link expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Link expired. Tell the agent.';
        };
        tick();
        window.clearInterval(countdownTimer);
        countdownTimer = window.setInterval(tick, 1000);
        return {
          key: `qr:${prompt.url}`,
          node: el(
            'div',
            { class: 'slip slip-qr' },
            el(
              'div',
              { class: 'qr-wrap' },
              canvas,
            ),
            el(
              'div',
              { class: 'qr-copy' },
              el('h1', {}, 'Photo ID required'),
              el('p', { class: 'summary' }, `Scan with your phone camera and take a selfie ${prompt.requirement}.`),
              el('p', { class: 'hint' }, 'Stay on the call. Your phone camera can scan while you talk.'),
              countdown,
            ),
          ),
        };
      }
      case 'show_human_check':
        return {
          key: `human:${prompt.title}:${prompt.imageUrl ?? ''}`,
          node: slip(
            prompt.title,
            prompt.imageUrl
              ? el('img', { class: 'human-check-photo', src: prompt.imageUrl, alt: 'Photo for the humanity check question' })
              : null,
            el('p', { class: 'summary' }, prompt.prompt),
            el('p', { class: 'hint' }, 'Say the answer out loud. The agent is listening.'),
          ),
        };
    }
  }

  function ticketSlip(t: Ticket): HTMLElement {
    const time = new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return el(
      'li',
      { class: 'ticket' },
      el('div', { class: 'ticket-head' }, el('span', { class: 'ticket-id' }, t.id), el('time', { datetime: t.createdAt }, time)),
      el('p', {}, t.summary),
    );
  }

  return {
    showWelcome() {
      if (!welcome.open) welcome.showModal();
    },
    render(state, focusedStage) {
      // Prompt (rebuilt only when it changes, so the QR code and countdown don't flicker)
      const next = buildPrompt(state);
      promptHost.hidden = state.phase === 'pairing' && focusedStage !== 'pairing';
      if (next.key !== promptKey) {
        promptKey = next.key;
        if (!next.key.startsWith('qr:')) window.clearInterval(countdownTimer);
        promptHost.replaceChildren(...(next.node ? [next.node] : []));
        promptHost.querySelector('button')?.addEventListener('click', handlers.onNewCall);
      }

      // Tickets
      ticketList.replaceChildren(
        ...(state.tickets.length > 0
          ? state.tickets.map(ticketSlip)
          : [el('li', { class: 'ticket-empty' }, 'No tickets yet. Nobody has passed.')]),
      );

      // End overlay (only for calls that ended before a ticket was filed)
      const abandoned = state.ended !== null && state.ended !== 'completed' && state.phase !== 'done';
      endHost.hidden = !abandoned;
      if (abandoned) {
        endHost.replaceChildren(
          el(
            'div',
            { class: 'slip' },
            el('h1', {}, state.ended === 'timeout' ? 'Your time is up' : 'The call ended'),
            el('p', { class: 'hint' }, 'You were not served. This is normal.'),
            el('button', { class: 'button', type: 'button' }, 'Start a new call'),
          ),
        );
        endHost.querySelector('button')?.addEventListener('click', handlers.onNewCall);
      }
    },

    toast(message, tone) {
      const node = el('p', { class: `toast toast-${tone}` }, message);
      toastHost.append(node);
      window.setTimeout(() => node.remove(), 3600);
    },
  };
}

function languageTag(language: string): string {
  const tags: Record<string, string> = { Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Portuguese: 'pt' };
  return tags[language] ?? 'en';
}
