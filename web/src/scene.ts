import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLANETS, STAGES, STAGE_LABELS, type Phase, type Stage } from '../../shared/protocol.js';

export interface SceneApi {
  readonly focusedStage: Stage | null;
  goToLolzitron(): void;
  setPhase(phase: Phase): void;
  /** A short visual reaction to a test result on that stage's planet. */
  flash(stage: Stage, passed: boolean): void;
  /** Show (or clear) the caller's selfie as an ID card floating beside Snapturn. */
  setPhoto(dataUrl: string | null): void;
  dispose(): void;
}

type Kind = 'craters' | 'earth' | 'bands' | 'knit';

interface PlanetSpec {
  radius: number;
  base: string;
  accents: string[];
  kind: Kind;
  ring?: boolean;
}

const SPECS: Record<Stage, PlanetSpec> = {
  pairing: { radius: 1.9, base: '#ef946f', accents: ['#dc7858', '#ffc39b', '#b65b47'], kind: 'craters' },
  language: { radius: 3.45, base: '#2f6db5', accents: ['#3f8a52', '#8a7a4a', '#ffffff'], kind: 'earth' },
  selfie: { radius: 2.6, base: '#b5502e', accents: ['#8e3a1f', '#d27a4a', '#6e2c18'], kind: 'craters' },
  humanCheck: { radius: 1.4, base: '#c9a27a', accents: ['#a87b57', '#e2c9a6', '#8f5f42', '#f0e2cc'], kind: 'bands' },
  ticket: { radius: 4.8, base: '#dcc58f', accents: ['#c3a96f', '#efdcae', '#b09257'], kind: 'bands', ring: true },
};

const POSITIONS: Record<Stage, THREE.Vector3> = {
  pairing: new THREE.Vector3(-27, -3, 3),
  language: new THREE.Vector3(-15, 9, -5),
  selfie: new THREE.Vector3(0, 14, -10),
  humanCheck: new THREE.Vector3(15, 9, -5),
  ticket: new THREE.Vector3(29, -3, 3),
};

const LED_RED = new THREE.Color('#ff4a3d');
const PASS_TEAL = new THREE.Color('#2ee6c8');
const OVERVIEW_POSITION = new THREE.Vector3(0, 9, 58);
const OVERVIEW_TARGET = new THREE.Vector3(0, -2, -2);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function planetTexture(spec: PlanetSpec, seed: number): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const rand = mulberry32(seed);
  const pick = () => spec.accents[Math.floor(rand() * spec.accents.length)] ?? spec.base;

  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, w, h);

  if (spec.kind === 'knit') {
    for (let y = 0; y < h; y += 64) {
      ctx.fillStyle = spec.accents[(y / 64) % spec.accents.length] ?? spec.base;
      ctx.fillRect(0, y, w, 64);
    }
    ctx.lineWidth = 1.5;
    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 8) {
        ctx.strokeStyle = (x + y) % 16 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(40,25,20,0.18)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 4, y + 6);
        ctx.lineTo(x + 8, y);
        ctx.stroke();
      }
    }
  } else if (spec.kind === 'bands') {
    let y = 0;
    while (y < h) {
      const bandHeight = 10 + rand() * 46;
      ctx.fillStyle = pick();
      ctx.globalAlpha = 0.35 + rand() * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x / 90 + y) * 5);
      for (let x = w; x >= 0; x -= 32) ctx.lineTo(x, y + bandHeight + Math.sin(x / 70 + y) * 5);
      ctx.closePath();
      ctx.fill();
      y += bandHeight * (0.6 + rand() * 0.6);
    }
  } else if (spec.kind === 'earth') {
    const layers = [4, 8, 16, 32, 64, 128].map((size) => ({
      size, values: Float32Array.from({ length: size * size }, () => rand()),
    }));
    const noise = (u: number, v: number) => {
      let value = 0;
      let weight = 0;
      layers.forEach(({ size, values }, index) => {
        const x = u * size;
        const y = v * size;
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (dx: number, dy: number) => values[((iy + dy) % size) * size + ((ix + dx) % size)]!;
        const amplitude = 1 / (2 ** index);
        value += ((at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) +
          (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy) * amplitude;
        weight += amplitude;
      });
      return value / weight;
    };
    const pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const latitude = Math.abs(y / h * 2 - 1);
      for (let x = 0; x < w; x++) {
        const elevation = noise(x / w, y / h);
        const detail = rand() * 0.06;
        let color: number[];
        if (latitude > 0.91 + (elevation - 0.5) * 0.16) color = [210, 225, 232];
        else if (elevation < 0.5) {
          const coast = Math.max(0, (elevation - 0.46) / 0.04);
          color = [9 + coast * 12, 28 + coast * 35, 56 + coast * 32];
        } else {
          const mountain = Math.max(0, (elevation - 0.61) * 4);
          const dry = Math.max(0, 1 - Math.abs(latitude - 0.35) * 7);
          color = [42 + dry * 70 + mountain * 90, 67 + dry * 29 + mountain * 65, 39 + dry * 24 + mountain * 70];
        }
        const offset = (y * w + x) * 4;
        for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = color[channel]! * (0.94 + detail);
        pixels.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  } else {
    // craters
    for (let i = 0; i < 1400; i++) {
      ctx.globalAlpha = 0.06 + rand() * 0.12;
      ctx.fillStyle = pick();
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 4, 2 + rand() * 4);
    }
    for (let i = 0; i < 90; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = 4 + rand() * 26;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = spec.accents[spec.accents.length - 1] ?? '#444';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = spec.accents[1] ?? '#ccc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x - r * 0.12, y - r * 0.12, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface PlanetNode {
  stage: Stage;
  mesh: THREE.Mesh;
  halo: THREE.Mesh;
  haloMaterial: THREE.MeshBasicMaterial;
  label: HTMLElement;
  home: THREE.Vector3;
  shake: number;
  pulse: number;
  tint: number;
}

export function createScene(container: HTMLElement, labelRoot: HTMLElement, onTardisClick: () => void, onViewChange: () => void): SceneApi | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x02040b);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);

  // Lets the caller drag to look around the scene. The automatic per-stage framing below still
  // drives where the camera sits and points; this just layers a user-controlled orbit on top of it.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 140;

  scene.add(new THREE.AmbientLight(0x526b9b, 0.25));
  const sun = new THREE.DirectionalLight(0xffedd6, 3.6);
  sun.position.set(-45, 22, 8);
  scene.add(sun);

  // Starfield
  const starCount = 11000;
  const starPositions = new Float32Array(starCount * 3);
  const starRand = mulberry32(7);
  for (let i = 0; i < starCount; i++) {
    const r = 90 + starRand() * 160;
    const theta = starRand() * Math.PI * 2;
    const phi = Math.acos(2 * starRand() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfd9f5, size: 0.23, sizeAttenuation: true }));
  scene.add(stars);

  const galaxyPositions = new Float32Array(16000 * 3);
  for (let i = 0; i < 16000; i++) {
    const angle = starRand() * Math.PI * 2;
    const radius = 155 + starRand() * 85;
    const spread = (starRand() + starRand() + starRand() - 1.5) * 22;
    galaxyPositions[i * 3] = Math.cos(angle) * radius;
    galaxyPositions[i * 3 + 1] = Math.sin(angle) * radius * 0.45 + spread;
    galaxyPositions[i * 3 + 2] = Math.sin(angle) * radius * 0.9;
  }
  const galaxyGeometry = new THREE.BufferGeometry();
  galaxyGeometry.setAttribute('position', new THREE.BufferAttribute(galaxyPositions, 3));
  const galaxyBand = new THREE.Points(galaxyGeometry, new THREE.PointsMaterial({
    color: '#adc2e5', size: 0.18, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  galaxyBand.rotation.z = -0.35;
  scene.add(galaxyBand);
  const hazeCanvas = document.createElement('canvas');
  hazeCanvas.width = hazeCanvas.height = 256;
  const hazeContext = hazeCanvas.getContext('2d')!;
  const hazeGradient = hazeContext.createRadialGradient(128, 128, 0, 128, 128, 128);
  hazeGradient.addColorStop(0, 'rgba(110,125,185,0.16)');
  hazeGradient.addColorStop(0.35, 'rgba(75,83,145,0.08)');
  hazeGradient.addColorStop(1, 'rgba(20,25,60,0)');
  hazeContext.fillStyle = hazeGradient;
  hazeContext.fillRect(0, 0, 256, 256);
  const hazeTexture = new THREE.CanvasTexture(hazeCanvas);
  for (let i = 0; i < 12; i++) {
    const haze = new THREE.Sprite(new THREE.SpriteMaterial({
      map: hazeTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    haze.position.set(-180 + i * 32, -65 + i * 11, -160);
    haze.scale.set(90, 55, 1);
    scene.add(haze);
  }

  const mustacheMaterial = new THREE.MeshBasicMaterial({
    color: '#35251e', transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false,
  });
  const mustacheLobes = [-1, 1].map((side) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(side * 0.5, 0.65, side * 1.15, 0.2, side * 1.45, 0.05);
    shape.bezierCurveTo(side * 1.9, -0.15, side * 2.15, 0.25, side * 2.25, 0.65);
    shape.bezierCurveTo(side * 2.5, -0.7, side * 1.5, -0.95, side * 0.8, -0.5);
    shape.bezierCurveTo(side * 0.4, -0.25, side * 0.2, -0.08, 0, 0);
    return shape;
  });
  const mustache = new THREE.Mesh(new THREE.ShapeGeometry(mustacheLobes, 32), mustacheMaterial);
  scene.add(mustache);

  // Planets
  const planets: PlanetNode[] = STAGES.map((stage, i) => {
    const spec = SPECS[stage];
    const home = POSITIONS[stage].clone();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius, 64, 48),
      new THREE.MeshStandardMaterial({ map: planetTexture(spec, 11 + i * 17), roughness: 0.95, metalness: 0 }),
    );
    mesh.position.copy(home);
    mesh.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.08;
    scene.add(mesh);

    if (stage === 'language') {
      const terrain = mesh.material as THREE.MeshStandardMaterial;
      terrain.bumpMap = terrain.map;
      terrain.bumpScale = 0.06;
      terrain.roughness = 0.75;
      const cloudCanvas = document.createElement('canvas');
      cloudCanvas.width = 1024;
      cloudCanvas.height = 512;
      const cloudsContext = cloudCanvas.getContext('2d')!;
      const cloudRandom = mulberry32(191);
      for (let i = 0; i < 180; i++) {
        const x = cloudRandom() * 1024;
        const y = cloudRandom() * 512;
        for (let puff = 0; puff < 24; puff++) {
          const angle = puff * 0.28;
          const distance = puff * 1.3;
          const px = (x + Math.cos(angle) * distance + 1024) % 1024;
          const py = y + Math.sin(angle) * distance * 0.45;
          cloudsContext.fillStyle = `rgba(242,249,255,${0.025 + cloudRandom() * 0.07})`;
          cloudsContext.beginPath();
          cloudsContext.ellipse(px, py, 2 + cloudRandom() * 9, 1 + cloudRandom() * 4,
            angle, 0, Math.PI * 2);
          cloudsContext.fill();
        }
      }
      const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
      cloudTexture.colorSpace = THREE.SRGBColorSpace;
      const clouds = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.012, 64, 48),
        new THREE.MeshStandardMaterial({ map: cloudTexture, transparent: true, opacity: 0.8, depthWrite: false, roughness: 1 }));
      clouds.name = 'translatopia-clouds';
      mesh.add(clouds);
      mesh.add(new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.025, 64, 48),
        new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
          vertexShader: `varying vec3 atmosphereNormal; varying vec3 atmosphereView;
            void main() {
              vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
              atmosphereNormal = normalize(normalMatrix * normal);
              atmosphereView = normalize(-viewPosition.xyz);
              gl_Position = projectionMatrix * viewPosition;
            }`,
          fragmentShader: `varying vec3 atmosphereNormal; varying vec3 atmosphereView;
            void main() {
              float rim = pow(1.0 - abs(dot(normalize(atmosphereNormal), normalize(atmosphereView))), 3.5);
              gl_FragColor = vec4(0.16, 0.43, 1.0, rim * 0.28);
            }`,
        })));
    }

    if (stage === 'pairing') {
      const globeMaterial = mesh.material as THREE.MeshStandardMaterial;
      globeMaterial.transparent = true;
      globeMaterial.opacity = 0;
      globeMaterial.depthWrite = false;
      const surface = new THREE.PlaneGeometry(spec.radius * 2.3, spec.radius * 2.3);
      mesh.add(new THREE.Mesh(surface, new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('/lolzitron-salmon.png', (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
        }),
        transparent: true,
        alphaTest: 0.1,
        toneMapped: false,
      })));
    }

    if (stage === 'humanCheck') {
      const globeMaterial = mesh.material as THREE.MeshStandardMaterial;
      globeMaterial.transparent = true;
      globeMaterial.opacity = 0;
      globeMaterial.depthWrite = false;
      mesh.add(new THREE.Mesh(new THREE.PlaneGeometry(spec.radius * 2.6, spec.radius * 2.6),
        new THREE.MeshBasicMaterial({
          map: new THREE.TextureLoader().load('/lengsdwarf-cardigan.png', (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
          }),
          transparent: true,
          alphaTest: 0.1,
          toneMapped: false,
        })));
    }

    if (spec.ring) {
      for (const [inner, outer, opacity, color] of [
        [1.45, 1.75, 0.7, '#d9c690'],
        [1.82, 2.25, 0.5, '#b8a574'],
      ] as const) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(spec.radius * inner, spec.radius * outer, 128),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.rotation.x = Math.PI / 2 - 0.45;
        mesh.add(ring);
      }
    }

    const haloMaterial = new THREE.MeshBasicMaterial({
      color: LED_RED,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.RingGeometry(spec.radius * 1.5, spec.radius * 1.56, 96), haloMaterial);
    halo.position.copy(home);
    scene.add(halo);

    const label = document.createElement('div');
    label.className = 'planet-label';
    label.innerHTML = `<strong>${PLANETS[stage]}</strong><span>${STAGE_LABELS[stage]}</span>`;
    labelRoot.appendChild(label);

    return { stage, mesh, halo, haloMaterial, label, home, shake: 0, pulse: 0, tint: 0 };
  });

  const twinPlanets = [-1, 1].map((side) => {
    const mesh = new THREE.Group();
    const globe = new THREE.Mesh(new THREE.SphereGeometry(2.5, 48, 32),
      new THREE.MeshStandardMaterial({
        map: planetTexture({ radius: 2.5, base: side < 0 ? '#d3b5ce' : '#b0cedd', accents: ['#eadce5', '#97b0c4', '#cfdaea'], kind: 'bands' }, 100),
        roughness: 0.8, metalness: 0.1,
      }));
    mesh.add(globe);
    const frames = new THREE.MeshStandardMaterial({ color: '#192235', roughness: 0.4 });
    for (const x of [-0.95, 0.95]) {
      for (const y of [-0.4, 0.9]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.15, 0.18), frames);
        edge.position.set(x, y, 2.35);
        mesh.add(edge);
      }
      for (const offset of [-0.7, 0.7]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.3, 0.18), frames);
        edge.position.set(x + offset, 0.25, 2.35);
        mesh.add(edge);
      }
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.15),
        new THREE.MeshStandardMaterial({ color: '#c2ebff', transparent: true, opacity: 0.25, roughness: 0.15, depthWrite: false }));
      lens.position.set(x, 0.25, 2.36);
      mesh.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.15), frames);
    bridge.position.set(0, 0.3, 2.35);
    mesh.add(bridge);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 1.1), frames);
      arm.position.set(side * 1.8, 0.25, 1.9);
      mesh.add(arm);
    }
    mesh.position.set(side * 8, -11, -1);
    scene.add(mesh);
    const label = document.createElement('div');
    label.className = 'planet-label';
    const title = document.createElement('strong');
    title.textContent = side < 0 ? 'Favorite' : 'Other One';
    label.appendChild(title);
    labelRoot.appendChild(label);
    return { mesh, label, homeY: -11 };
  });

  const shashune = new THREE.Group();
  const shellProfile = new THREE.Shape();
  shellProfile.moveTo(-2.35, 0.35);
  shellProfile.bezierCurveTo(-2.25, -1.9, 2.25, -1.9, 2.35, 0.35);
  shellProfile.bezierCurveTo(1.4, 0.55, -1.4, 0.55, -2.35, 0.35);
  const shellBody = new THREE.Mesh(new THREE.ExtrudeGeometry(shellProfile, {
    depth: 1.1, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 40,
  }), new THREE.MeshStandardMaterial({ color: '#e7a638', roughness: 0.85 }));
  shellBody.position.z = -0.4;
  shashune.add(shellBody);
  for (let i = 0; i < 11; i++) {
    const filling = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12),
      new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? '#ef5441' : '#67be3b', roughness: 0.9 }));
    filling.position.set(-2 + i * 0.4, 0.55 + Math.sin(i * 1.7) * 0.1, 0.2);
    shashune.add(filling);
  }
  const tacoCanvas = document.createElement('canvas');
  tacoCanvas.width = 768;
  tacoCanvas.height = 512;
  const taco = tacoCanvas.getContext('2d')!;
  taco.lineJoin = 'round';
  taco.lineCap = 'round';
  taco.lineWidth = 12;
  taco.strokeStyle = '#492a19';
  taco.fillStyle = '#9b4c26';
  taco.beginPath();
  taco.ellipse(384, 235, 307, 115, 0, 0, Math.PI * 2);
  taco.fill();
  taco.stroke();
  for (let i = 0; i < 12; i++) {
    taco.fillStyle = i % 2 ? '#70c94a' : '#43a836';
    taco.beginPath();
    taco.arc(102 + i * 51, 212 + Math.sin(i * 1.6) * 20, 40, 0, Math.PI * 2);
    taco.fill();
    taco.stroke();
  }
  for (let i = 0; i < 6; i++) {
    taco.fillStyle = '#f45443';
    taco.beginPath();
    taco.roundRect(155 + i * 86, 185 + (i % 2) * 21, 48, 38, 8);
    taco.fill();
    taco.stroke();
    taco.strokeStyle = '#ffe57b';
    taco.lineWidth = 10;
    taco.beginPath();
    taco.moveTo(129 + i * 86, 227);
    taco.lineTo(162 + i * 86, 199);
    taco.stroke();
    taco.strokeStyle = '#492a19';
    taco.lineWidth = 12;
  }
  taco.fillStyle = '#ffcc55';
  taco.beginPath();
  taco.moveTo(72, 242);
  taco.bezierCurveTo(130, 206, 640, 206, 696, 242);
  taco.bezierCurveTo(680, 513, 88, 513, 72, 242);
  taco.closePath();
  taco.fill();
  taco.stroke();
  taco.fillStyle = '#d89636';
  for (let i = 0; i < 30; i++) {
    const x = 135 + (i * 97 % 490);
    const y = 270 + (i * 43 % 125);
    taco.beginPath();
    taco.ellipse(x, y, 5, 3, i, 0, Math.PI * 2);
    taco.fill();
  }
  for (const x of [307, 461]) {
    taco.fillStyle = '#492a19';
    taco.beginPath();
    taco.ellipse(x, 311, 14, 21, 0, 0, Math.PI * 2);
    taco.fill();
    taco.fillStyle = '#ffffff';
    taco.beginPath();
    taco.arc(x - 4, 304, 4, 0, Math.PI * 2);
    taco.fill();
  }
  taco.beginPath();
  taco.arc(384, 331, 28, 0.15, Math.PI - 0.15);
  taco.stroke();
  const tacoTexture = new THREE.CanvasTexture(tacoCanvas);
  tacoTexture.colorSpace = THREE.SRGBColorSpace;
  const tacoArt = new THREE.Mesh(new THREE.PlaneGeometry(6, 4),
    new THREE.MeshBasicMaterial({ map: tacoTexture, transparent: true, alphaTest: 0.1 }));
  tacoArt.position.set(0, 0.25, 0.95);
  shashune.add(tacoArt);
  shashune.position.set(-22, -14, -1);
  scene.add(shashune);
  const shashuneLabel = document.createElement('div');
  shashuneLabel.className = 'planet-label';
  const shashuneTitle = document.createElement('strong');
  shashuneTitle.textContent = '2AM';
  shashuneLabel.appendChild(shashuneTitle);
  labelRoot.appendChild(shashuneLabel);
  twinPlanets.push({ mesh: shashune, label: shashuneLabel, homeY: -14 });

  const neigh = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: '#ad7049', roughness: 0.95 });
  const mane = new THREE.MeshStandardMaterial({ color: '#38271f', roughness: 1 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), coat);
  head.scale.set(1.35, 2.15, 1.15);
  neigh.add(head);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24),
    new THREE.MeshStandardMaterial({ color: '#dfb394', roughness: 0.9 }));
  muzzle.scale.set(1.45, 0.8, 0.95);
  muzzle.position.set(0, -1.45, 0.55);
  neigh.add(muzzle);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 24), coat);
    ear.position.set(side * 0.85, 2.2, 0);
    ear.rotation.z = side * -0.18;
    neigh.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), mane);
    eye.position.set(side * 0.73, 0.5, 1);
    neigh.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    glint.position.set(side * 0.73 - 0.04, 0.56, 1.16);
    neigh.add(glint);
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), mane);
    nostril.scale.set(1, 0.7, 0.5);
    nostril.position.set(side * 0.67, -1.5, 1.43);
    neigh.add(nostril);
  }
  for (let i = 0; i < 6; i++) {
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mane);
    tuft.scale.set(0.8, 1.4, 0.65);
    tuft.position.set(-0.15 + i * 0.12, 1.65 - i * 0.14, 0.9);
    neigh.add(tuft);
  }
  neigh.position.set(0, -23, -1);
  scene.add(neigh);
  const neighLabel = document.createElement('div');
  neighLabel.className = 'planet-label';
  const neighTitle = document.createElement('strong');
  neighTitle.textContent = 'Planet Neigh';
  neighLabel.appendChild(neighTitle);
  labelRoot.appendChild(neighLabel);
  const neighIndex = twinPlanets.length;
  twinPlanets.push({ mesh: neigh, label: neighLabel, homeY: -23 });
  const bonusEmphasis = twinPlanets.map(({ mesh }) => {
    const emphasis = { value: 0 };
    mesh.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.onBeforeCompile = (shader) => {
          shader.uniforms.bonusEmphasis = emphasis;
          shader.fragmentShader = 'uniform float bonusEmphasis;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            'float bonusGray = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));\n' +
            'outgoingLight = mix(vec3(bonusGray) * 0.55, outgoingLight, bonusEmphasis);\n' +
            '#include <opaque_fragment>');
        };
        material.customProgramCacheKey = () => 'bonus-planet-emphasis';
      }
    });
    return emphasis;
  });
  const horseGif = document.createElement('img');
  horseGif.src = '/horse.gif';
  horseGif.alt = 'Animated horse';
  horseGif.hidden = true;
  horseGif.style.cssText = 'position:absolute;transform:translate(-50%,-50%);object-fit:contain;border-radius:16px;pointer-events:none;z-index:1;';
  container.appendChild(horseGif);

  // Selfie ID card beside Snapturn
  const marsHome = POSITIONS.selfie;
  const card = new THREE.Group();
  const cardFrame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe6ebf2, transparent: true, opacity: 0 }));
  const cardPhoto = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
  cardPhoto.position.z = 0.01;
  card.add(cardFrame, cardPhoto);
  card.position.set(marsHome.x + SPECS.selfie.radius + 2.0, marsHome.y + 0.5, marsHome.z + 1.2);
  card.rotation.y = -0.35;
  card.rotation.z = 0.05;
  scene.add(card);
  let cardTarget = 0;
  let photoLoadId = 0;

  // A floating TARDIS-style police box, just for fun, hovering above the planet row.
  const tardis = new THREE.Group();
  const tardisBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 2.6, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x0a3b7a, emissive: 0x1a5bb8, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.2 }),
  );
  tardis.add(tardisBody);

  const tardisRoof = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.28, 1.25),
    new THREE.MeshStandardMaterial({ color: 0x04173d, roughness: 0.6 }),
  );
  tardisRoof.position.y = 1.44;
  tardis.add(tardisRoof);

  const tardisLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xfff3c0, emissive: 0xffd966, emissiveIntensity: 1.2 }),
  );
  tardisLamp.position.y = 1.72;
  tardis.add(tardisLamp);

  const windowOffsets: [number, number][] = [
    [-0.27, 0.6],
    [0.27, 0.6],
    [-0.27, 0.1],
    [0.27, 0.1],
  ];
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const face = new THREE.Group();
    face.rotation.y = angle;
    for (const [x, y] of windowOffsets) {
      const pane = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.4, 0.03),
        new THREE.MeshStandardMaterial({ color: 0x04173d, emissive: 0xbcd9ff, emissiveIntensity: 0.3 }),
      );
      pane.position.set(x, y, 0.56);
      face.add(pane);
    }
    tardis.add(face);
  }

  tardis.position.set(7, 11, 2);
  tardis.scale.setScalar(1.3);
  scene.add(tardis);

  const tardisLabel = document.createElement('div');
  tardisLabel.className = 'planet-label tardis-label';
  tardisLabel.innerHTML = '<strong>Click</strong>';
  labelRoot.appendChild(tardisLabel);

  // Click (not drag) to explore a planet or open the TARDIS welcome dialog.
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDownAt: { x: number; y: number } | null = null;
  let focusedStage: Stage | null = null;
  let focusedTwin: number | null = null;

  function sceneHit(clientX: number, clientY: number): Stage | 'tardis' | number | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([tardis, ...planets.map((planet) => planet.mesh), ...twinPlanets.map((twin) => twin.mesh)], true)[0];
    if (!hit) return null;
    const twinIndex = twinPlanets.findIndex((twin) => twin.mesh === hit.object || twin.mesh === hit.object.parent);
    if (twinIndex >= 0) return twinIndex;
    const planet = planets.find((planet) => planet.mesh === hit.object || planet.mesh === hit.object.parent);
    return planet?.stage ?? 'tardis';
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (pointerDownAt) return; // mid-drag; leave the cursor to OrbitControls
    renderer.domElement.style.cursor = sceneHit(event.clientX, event.clientY) ? 'pointer' : 'auto';
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    const moved = pointerDownAt ? Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) : Infinity;
    pointerDownAt = null;
    if (moved >= 6) return; // was a drag, not a click
    const hit = sceneHit(event.clientX, event.clientY);
    if (typeof hit === 'number') {
      if (focusedTwin === hit) {
        cameraTarget.copy(OVERVIEW_POSITION);
        lookTarget.copy(OVERVIEW_TARGET);
        focusedTwin = null;
      } else {
        const twin = twinPlanets[hit]!;
        cameraTarget.copy(twin.mesh.position).add(new THREE.Vector3(1.5, 1.4, 17));
        lookTarget.copy(twin.mesh.position);
        focusedTwin = hit;
      }
      focusedStage = null;
      onViewChange();
    } else if (hit === 'tardis') {
      onTardisClick();
    } else if (hit && hit !== focusedStage) {
      focusedTwin = null;
      frame(hit);
      focusedStage = hit;
      onViewChange();
    } else if (focusedStage !== null || focusedTwin !== null) {
      focusedTwin = null;
      cameraTarget.copy(OVERVIEW_POSITION);
      lookTarget.copy(OVERVIEW_TARGET);
      focusedStage = null;
      onViewChange();
    }
  });

  // Camera state
  const cameraTarget = OVERVIEW_POSITION.clone();
  const lookTarget = OVERVIEW_TARGET.clone();
  const look = OVERVIEW_TARGET.clone();
  camera.position.copy(OVERVIEW_POSITION);
  let currentIndex = -1;
  let ended = false;
  let phaseIndex = -1;
  let compactLayout = false;

  function frame(stage: Stage) {
    const p = POSITIONS[stage];
    const extent = SPECS[stage].radius * (SPECS[stage].ring ? 1.8 : 1);
    const distance = Math.max(extent * 4.5, extent * 2.8 / camera.aspect);
    cameraTarget.set(p.x + 0.6, p.y + 0.8, p.z + distance);
    lookTarget.set(p.x, p.y - 0.25, p.z);
  }

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    compactLayout = camera.aspect < 0.9;
    const layout = compactLayout
      ? [[-8, 20, 0], [8, 9, -4], [-8, -2, 0], [8, -13, -4], [-7, -27, 0]]
      : [[-27, -3, 3], [-15, 9, -5], [0, 14, -10], [15, 9, -5], [29, -3, 3]];
    planets.forEach((planet, index) => {
      const [x, y, z] = layout[index]!;
      POSITIONS[planet.stage].set(x!, y!, z!);
      planet.home.copy(POSITIONS[planet.stage]);
    });
    const bonusLayout = compactLayout
      ? [[-9, -45, -8], [9, -45, -8], [-12, -60, -12], [10, -65, -10]]
      : [[-11, -24, -12], [11, -24, -12], [-32, -25, -10], [0, -40, -16]];
    twinPlanets.forEach((planet, index) => {
      const [x, y, z] = bonusLayout[index]!;
      planet.mesh.position.set(x!, y!, z!);
      planet.homeY = y!;
    });
    tardis.position.x = compactLayout ? -1 : 0;
    OVERVIEW_TARGET.set(0, compactLayout ? -18 : -8, -3);
    OVERVIEW_POSITION.set(0, compactLayout ? -10 : 5,
      Math.max(compactLayout ? 130 : 90,
        (compactLayout ? 21 : 44) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) + 8));
    if (focusedStage !== null) frame(focusedStage);
    else if (focusedTwin === null && (phaseIndex <= 0 || ended)) {
      cameraTarget.copy(OVERVIEW_POSITION);
      lookTarget.copy(OVERVIEW_TARGET);
    } else if (focusedTwin === null && currentIndex >= 0) frame(STAGES[currentIndex]!);
    card.position.set(POSITIONS.selfie.x + SPECS.selfie.radius + 2, POSITIONS.selfie.y + 0.5, POSITIONS.selfie.z + 1.2);
    // Leave room below the planets for the prompt; the tickets menu overlays the scene.
    camera.setViewOffset(w, h, 0, Math.round(h * 0.06), w, h);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const tmp = new THREE.Vector3();
  const clock = new THREE.Clock();

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    const k = 1 - Math.exp(-dt * (reduceMotion ? 8 : 2.2));
    camera.position.lerp(cameraTarget, k);
    look.lerp(lookTarget, k);
    controls.target.copy(look);
    controls.update();

    stars.rotation.y += dt * 0.004;
    const showHorse = focusedTwin === neighIndex;
    if (showHorse && horseGif.hidden) horseGif.src = `/horse.gif?play=${Date.now()}`;
    horseGif.hidden = !showHorse;

    twinPlanets.forEach((twin, index) => {
      const emphasis = bonusEmphasis[index]!;
      emphasis.value = THREE.MathUtils.lerp(emphasis.value, focusedTwin === index ? 1 : 0, k);
      twin.mesh.position.y = twin.homeY + (reduceMotion ? 0 : Math.sin(t * 0.5 + index * Math.PI) * 0.35);
      twin.mesh.quaternion.copy(camera.quaternion);
      if (index === neighIndex && showHorse) {
        tmp.copy(twin.mesh.position).project(camera);
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        horseGif.style.left = `${((tmp.x + 1) / 2) * width}px`;
        horseGif.style.top = `${((1 - tmp.y) / 2) * height}px`;
        const edge = twin.mesh.position.clone().add(new THREE.Vector3(2.6, 0, 0).applyQuaternion(camera.quaternion)).project(camera);
        const size = Math.abs(edge.x - tmp.x) * width;
        horseGif.style.width = `${size}px`;
        horseGif.style.height = `${size}px`;
      }
      tmp.copy(twin.mesh.position);
      tmp.y += 3.8;
      tmp.project(camera);
      twin.label.style.opacity = tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15 ? (focusedTwin === index ? '1' : '0.4') : '0';
      twin.label.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * renderer.domElement.clientWidth}px, ${((1 - tmp.y) / 2) * renderer.domElement.clientHeight}px)`;
    });

    for (const p of planets) {
      const index = STAGES.indexOf(p.stage);
      if (p.stage === 'pairing' || p.stage === 'humanCheck') p.mesh.quaternion.copy(camera.quaternion);
      else p.mesh.rotation.y += dt * (0.06 + index * 0.012);
      if (p.stage === 'language' && !reduceMotion) {
        const clouds = p.mesh.getObjectByName('translatopia-clouds');
        if (clouds) clouds.rotation.y += dt * 0.015;
      }

      let shakeX = 0;
      let shakeY = 0;
      if (p.shake > 0 && !reduceMotion) {
        p.shake = Math.max(0, p.shake - dt);
        shakeX = (Math.random() - 0.5) * 0.5 * p.shake;
        shakeY = (Math.random() - 0.5) * 0.5 * p.shake;
      } else {
        p.shake = 0;
      }
      p.mesh.position.set(p.home.x + shakeX, p.home.y + shakeY, p.home.z);

      let scale = 1;
      if (p.pulse > 0 && !reduceMotion) {
        p.pulse = Math.max(0, p.pulse - dt);
        scale = 1 + Math.sin((1 - p.pulse / 0.7) * Math.PI) * 0.12;
      } else {
        p.pulse = 0;
      }
      p.mesh.scale.setScalar(scale);

      if (p.stage === 'ticket') {
        mustache.quaternion.copy(camera.quaternion);
        mustache.position.set(0, -0.4, SPECS.ticket.radius + 0.1)
          .applyQuaternion(camera.quaternion).add(p.mesh.position);
        mustache.scale.setScalar(scale);
        mustacheMaterial.opacity = reduceMotion ? 1 : (1 + Math.sin(t * Math.PI / 3)) / 2;
      }

      // Halo: red and pulsing on the current planet, teal on planets already passed.
      const isCurrent = !ended && index === currentIndex;
      const isPassed = index < phaseIndex;
      p.halo.position.copy(p.mesh.position);
      p.halo.quaternion.copy(camera.quaternion);
      if (isCurrent) {
        p.haloMaterial.color.copy(LED_RED);
        p.haloMaterial.opacity = reduceMotion ? 0.8 : 0.55 + Math.sin(t * 3) * 0.25;
      } else if (isPassed) {
        p.haloMaterial.color.copy(PASS_TEAL);
        p.haloMaterial.opacity = 0.5;
      } else {
        p.haloMaterial.opacity = 0;
      }

      // Label
      tmp.copy(p.mesh.position);
      tmp.y += SPECS[p.stage].radius * 1.75;
      tmp.project(camera);
      const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15;
      const selected = focusedStage ?? (!ended && phaseIndex > 0 && focusedTwin === null ? STAGES[currentIndex] : null);
      const overview = selected == null && focusedTwin === null;
      p.label.style.opacity = visible && (overview || selected === p.stage) ? (selected === p.stage || isCurrent ? '1' : '0.8') : '0';
      p.label.style.fontSize = compactLayout && overview ? '0.7rem' : '0.8rem';
      const subtitle = p.label.querySelector('span');
      if (subtitle) subtitle.hidden = overview;
      p.label.classList.toggle('is-current', isCurrent);
      p.label.classList.toggle('is-passed', isPassed);
      p.label.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * renderer.domElement.clientWidth}px, ${((1 - tmp.y) / 2) * renderer.domElement.clientHeight}px)`;
    }

    // Selfie card fades in and out
    const frameMat = cardFrame.material as THREE.MeshBasicMaterial;
    const photoMat = cardPhoto.material as THREE.MeshBasicMaterial;
    frameMat.opacity += (cardTarget - frameMat.opacity) * Math.min(1, dt * 4);
    photoMat.opacity = frameMat.opacity;
    card.visible = frameMat.opacity > 0.01;
    card.position.y = marsHome.y + 0.6 + Math.sin(t * 0.9) * (reduceMotion ? 0 : 0.12);

    // TARDIS: gentle bob and spin
    tardis.rotation.y += dt * 0.25;
    tardis.position.y = (compactLayout ? 25 : 24) + (reduceMotion ? 0 : Math.sin(t * 0.8) * 0.4);

    tmp.copy(tardis.position);
    tmp.y += 2.4;
    tmp.project(camera);
    const tardisVisible = tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15;
    tardisLabel.style.opacity = tardisVisible ? '1' : '0';
    tardisLabel.style.transform = `translate(-50%, -100%) translate(${((tmp.x + 1) / 2) * renderer.domElement.clientWidth}px, ${((1 - tmp.y) / 2) * renderer.domElement.clientHeight}px)`;

    renderer.render(scene, camera);
  });

  return {
    get focusedStage() {
      return focusedStage;
    },
    goToLolzitron() {
      frame('pairing');
      focusedStage = 'pairing';
      onViewChange();
    },
    setPhase(phase) {
      focusedTwin = null;
      focusedStage = null; // A call stage change returns the camera to the active step.
      const idx = (STAGES as readonly string[]).indexOf(phase);
      if (idx >= 0) {
        ended = false;
        currentIndex = idx;
        phaseIndex = idx;
        const stage = STAGES[idx];
        // Stay on the wide overview shot while waiting to be paired, so every planet is
        // visible before the caller is underway; start following the current planet from
        // the next stage onward.
        if (stage && stage !== 'pairing') {
          frame(stage);
        } else {
          cameraTarget.copy(OVERVIEW_POSITION);
          lookTarget.copy(OVERVIEW_TARGET);
        }
      } else if (phase === 'done') {
        ended = true;
        phaseIndex = STAGES.length;
        cameraTarget.copy(OVERVIEW_POSITION);
        lookTarget.copy(OVERVIEW_TARGET);
      } else {
        ended = true;
        cameraTarget.copy(OVERVIEW_POSITION);
        lookTarget.copy(OVERVIEW_TARGET);
      }
    },
    flash(stage, passed) {
      const p = planets.find((n) => n.stage === stage);
      if (!p) return;
      if (passed) p.pulse = 0.7;
      else p.shake = 0.8;
    },
    setPhoto(dataUrl) {
      photoLoadId += 1;
      const myId = photoLoadId;
      if (!dataUrl) {
        cardTarget = 0;
        return;
      }
      new THREE.TextureLoader().load(dataUrl, (texture) => {
        if (myId !== photoLoadId) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        const image = texture.image as { width: number; height: number };
        const aspect = image.width / image.height;
        const height = 2.6;
        const width = height * aspect;
        cardPhoto.scale.set(width, height, 1);
        cardFrame.scale.set(width + 0.35, height + 0.9, 1);
        cardFrame.position.y = -0.2;
        const material = cardPhoto.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.map = texture;
        material.needsUpdate = true;
        cardTarget = 1;
      });
    },
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      for (const p of planets) p.label.remove();
      tardisLabel.remove();
      horseGif.remove();
      for (const twin of twinPlanets) twin.label.remove();
    },
  };
}
