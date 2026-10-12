import './selfie.css';

const token = new URLSearchParams(location.search).get('t') ?? '';
const root = document.getElementById('app') as HTMLElement;

function render(...nodes: Node[]) {
  const slip = document.createElement('div');
  slip.className = 'slip';
  slip.append(...nodes);
  root.replaceChildren(slip);
}

function text<K extends 'h1' | 'p'>(tag: K, content: string, className = '') {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function showProblem(message: string) {
  render(text('h1', 'Photo ID'), text('p', message, 'error'));
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older browsers: an <img> applies the photo's rotation by itself.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Shrink the photo on the phone so it uploads fast and costs the model fewer image tokens. */
async function toJpeg(file: Blob, maxSide = 768): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const width = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const height = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process photos.');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the photo.'))), 'image/jpeg', 0.85);
  });
}

async function upload(blob: Blob) {
  const res = await fetch(`/api/selfie?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'The upload failed. Ask the agent for a new link.');
  }
}

function showCapture(requirement: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'user');
  input.hidden = true;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button';
  button.textContent = 'Take selfie';
  button.addEventListener('click', () => input.click());

  const status = text('p', '', 'error');
  status.setAttribute('role', 'status');

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    status.textContent = '';
    try {
      const jpeg = await toJpeg(file);
      const preview = document.createElement('img');
      preview.className = 'preview';
      preview.alt = 'Your selfie';
      preview.src = URL.createObjectURL(jpeg);
      await upload(jpeg);
      render(
        text('h1', 'Photo sent'),
        text('p', 'Look at the laptop. The agent is judging you.', 'sent'),
        preview,
        text('p', 'You can close this page. Stay on the call.', 'hint'),
      );
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Try again';
      status.className = 'error';
      status.textContent = error instanceof Error ? error.message : 'Something went wrong.';
    }
  });

  render(
    text('h1', 'Photo ID required'),
    text('p', `Take a selfie ${requirement}.`, 'requirement'),
    button,
    input,
    status,
    text('p', 'Stay on the call. The photo goes straight to the agent.', 'hint'),
  );
}

async function init() {
  if (!token) return showProblem('This link is missing its code. Scan the QR code on the laptop again.');
  try {
    const res = await fetch(`/api/selfie/info?t=${encodeURIComponent(token)}`);
    if (!res.ok) return showProblem('This photo link has expired or was already used. Tell the agent.');
    const { requirement } = (await res.json()) as { requirement: string };
    showCapture(requirement);
  } catch {
    showProblem('Could not reach the help desk. Check your connection and scan the QR code again.');
  }
}

void init();
