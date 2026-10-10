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
  pairing: { radius: 1.9, base: '#8d8a86', accents: ['#6f6c68', '#aaa6a0', '#5d5a57'], kind: 'craters' },
  language: { radius: 3.45, base: '#2f6db5', accents: ['#3f8a52', '#8a7a4a', '#ffffff'], kind: 'earth' },
  selfie: { radius: 2.6, base: '#b5502e', accents: ['#8e3a1f', '#d27a4a', '#6e2c18'], kind: 'craters' },
  humanCheck: { radius: 1.4, base: '#c9a27a', accents: ['#a87b57', '#e2c9a6', '#8f5f42', '#f0e2cc'], kind: 'bands' },
  ticket: { radius: 4.8, base: '#dcc58f', accents: ['#c3a96f', '#efdcae', '#b09257'], kind: 'bands', ring: true },
};

const POSITIONS: Record<Stage, THREE.Vector3> = Object.fromEntries(
  STAGES.map((stage, i) => [stage, new THREE.Vector3(i * 13 - 26, Math.sin(i * 1.4) * 3.0, -Math.cos(i * 0.9) * 4)]),
) as Record<Stage, THREE.Vector3>;

const LED_RED = new THREE.Color('#ff4a3d');
const PASS_TEAL = new THREE.Color('#2ee6c8');
const OVERVIEW_POSITION = new THREE.Vector3(0, 9, 58);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, -2);

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
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = i % 3 === 0 ? (spec.accents[1] ?? '#8a7a4a') : (spec.accents[0] ?? '#3f8a52');
      ctx.beginPath();
      ctx.ellipse(rand() * w, 90 + rand() * (h - 180), 20 + rand() * 90, 14 + rand() * 50, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 120; i++) {
      ctx.globalAlpha = 0.12 + rand() * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(rand() * w, rand() * h, 30 + rand() * 90, 4 + rand() * 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#f2f6fa';
    ctx.fillRect(0, 0, w, 26);
    ctx.fillRect(0, h - 26, w, 26);
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
  renderer.setClearColor(0x070b16);
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

  scene.add(new THREE.AmbientLight(0x3a4a78, 0.9));
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-30, 14, 28);
  scene.add(sun);

  // Starfield
  const starCount = 1800;
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
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfd9f5, size: 0.7, sizeAttenuation: true }));
  scene.add(stars);

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

    if (stage === 'humanCheck') {
      const radius = spec.radius * 1.06;
      const yarn = new THREE.MeshStandardMaterial({
        map: planetTexture({ radius, base: '#ffe36e', accents: ['#ffe36e', '#ff6aa2', '#54e0c1', '#a48bff'], kind: 'knit' }, 81),
        roughness: 1,
        side: THREE.DoubleSide,
      });
      const cardigan = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 64, 40, Math.PI / 2 + 0.22, Math.PI * 2 - 0.44, 0.6, 2.15),
        yarn,
      );
      mesh.add(cardigan);

      for (const side of [-1, 1]) {
        const sleeve = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.35, 32, 24), yarn);
        sleeve.scale.set(0.8, 1.65, 0.85);
        sleeve.position.set(side * radius * 0.96, -radius * 0.12, 0);
        sleeve.rotation.z = side * 0.22;
        mesh.add(sleeve);
      }

      const trim = new THREE.MeshStandardMaterial({ color: '#e5cfac', roughness: 1 });
      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.055, 8, 64, 2.15), trim);
        edge.rotation.set(0, Math.PI / 2 - side * 0.22, Math.PI / 2 - 2.75);
        mesh.add(edge);
      }
      for (let i = 0; i < 4; i++) {
        const y = radius * (0.35 - i * 0.25);
        const button = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.055, 12, 8),
          new THREE.MeshStandardMaterial({ color: '#523d31', roughness: 0.7 }));
        button.position.set(radius * 0.25, y, Math.sqrt(radius * radius - y * y - (radius * 0.25) ** 2));
        mesh.add(button);
      }

      const rand = mulberry32(82);
      const fibers: number[] = [];
      for (let i = 0; i < 2200; i++) {
        const phi = Math.PI / 2 + 0.22 + rand() * (Math.PI * 2 - 0.44);
        const theta = 0.6 + rand() * 2.15;
        const direction = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
        fibers.push(...direction.clone().multiplyScalar(radius).toArray(), ...direction.multiplyScalar(radius + 0.02 + rand() * 0.035).toArray());
      }
      const fuzz = new THREE.BufferGeometry();
      fuzz.setAttribute('position', new THREE.Float32BufferAttribute(fibers, 3));
      mesh.add(new THREE.LineSegments(fuzz, new THREE.LineBasicMaterial({ color: '#e5cfac', transparent: true, opacity: 0.35 })));
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
  scene.add(tardis);

  const tardisLabel = document.createElement('div');
  tardisLabel.className = 'planet-label tardis-label';
  tardisLabel.innerHTML = '<strong>Start here</strong>';
  labelRoot.appendChild(tardisLabel);

  // Click (not drag) to explore a planet or open the TARDIS welcome dialog.
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDownAt: { x: number; y: number } | null = null;
  let focusedStage: Stage | null = null;

  function sceneHit(clientX: number, clientY: number): Stage | 'tardis' | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects([tardis, ...planets.map((planet) => planet.mesh)], true)[0];
    if (!hit) return null;
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
    if (hit === 'tardis') {
      onTardisClick();
    } else if (hit && hit !== focusedStage) {
      frame(hit);
      focusedStage = hit;
      onViewChange();
    } else if (focusedStage !== null) {
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

  function frame(stage: Stage) {
    const p = POSITIONS[stage];
    cameraTarget.set(p.x + 1.5, p.y + 1.4, p.z + SPECS[stage].radius * 4.8 + 5);
    lookTarget.set(p.x, p.y, p.z);
  }

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    OVERVIEW_POSITION.z = Math.max(58, 40 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) + 6);
    if (focusedStage === null && (phaseIndex <= 0 || ended)) cameraTarget.copy(OVERVIEW_POSITION);
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

    for (const p of planets) {
      const index = STAGES.indexOf(p.stage);
      p.mesh.rotation.y += dt * (0.06 + index * 0.012);

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
      p.label.style.opacity = visible ? (isCurrent ? '1' : '0.62') : '0';
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
    tardis.position.y = 11 + (reduceMotion ? 0 : Math.sin(t * 0.8) * 0.4);

    tmp.copy(tardis.position);
    tmp.y += 1.9;
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
    },
  };
}
