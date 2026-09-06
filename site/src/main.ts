import * as THREE from 'three';
import { Scene, CAM_DIST, FOV } from './scene';
import { Plate, PITCH, loadManifest } from './plate';
import { Specimen, tune } from './specimen';
import { Indicator } from './indicator';
import { Card } from './card';
import { loadContent, plateLabel, roman } from './content';
import { inkUniform } from './shaders';
import type { PlateIndexEntry } from './types';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const scene = new Scene(canvas);

const index: PlateIndexEntry[] = await fetch('/plates/index.json').then(r => r.json());
const N = index.length;
document.getElementById('spacer')!.style.height = `${N * 100}vh`;
document.getElementById('plateCount')!.textContent = `of ${N}`;

const content = await loadContent();
const indicator = new Indicator(N, i => plateLabel(index[i].plateKey, index[i].specimens), i => scrollToPlate(i));

/* ------------------------------------------------------------------ */
/*  Plates: only the few around the viewport exist at any time         */
/* ------------------------------------------------------------------ */
const mounted = new Map<number, Plate>();
const KEEP = 2;
async function ensurePlates(centre: number) {
  for (const [i, p] of mounted) if (Math.abs(i - centre) > KEEP) { p.dispose(); mounted.delete(i); }
  for (let i = Math.max(0, centre - KEEP); i <= Math.min(N - 1, centre + KEEP); i++) {
    if (mounted.has(i)) continue;
    const m = await loadManifest(index[i].plateKey);
    if (mounted.has(i)) continue;
    const plate = new Plate(m, i);
    mounted.set(i, plate); scene.scene.add(plate.group);
  }
}

/* ------------------------------------------------------------------ */
/*  Scroll & routing                                                    */
/* ------------------------------------------------------------------ */
let camY = 0, camX = 0, targetPlate = 0;
let pinned: Specimen | null = null, pinnedPlate: Plate | null = null;
const hint = document.getElementById('hint')!;
function plateFromScroll() { return scrollY / innerHeight; }
function scrollToPlate(i: number, smooth = true) {
  unpin();
  scrollTo({ top: i * innerHeight, behavior: smooth ? 'smooth' : 'auto' });
}
// deep link: #n16 or #plate-3
const hash = location.hash.replace('#', '');
if (hash) {
  const byKey = index.findIndex(p => p.plateKey === hash);
  const byNum = hash.startsWith('plate-') ? parseInt(hash.slice(6)) - 1 : -1;
  const i = byKey >= 0 ? byKey : byNum;
  if (i >= 0 && i < N) { scrollToPlate(i, false); camY = -i * PITCH; }
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') unpin();
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); scrollToPlate(Math.min(N - 1, Math.round(plateFromScroll()) + 1)); }
  if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); scrollToPlate(Math.max(0, Math.round(plateFromScroll()) - 1)); }
});
let lastScroll = scrollY;
addEventListener('scroll', () => {
  if (Math.abs(scrollY - lastScroll) > 80 && pinned) unpin();
  lastScroll = scrollY; hint.classList.add('gone');
}, { passive: true });

/* ------------------------------------------------------------------ */
/*  Pointer, pinning                                                    */
/* ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-10, -10), pointerWorld = new THREE.Vector3();
const plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let hasPointer = false, pointerSpeed = 0, lastPX = 0, lastPY = 0;
const card = new Card(() => unpin());

addEventListener('pointermove', (e) => {
  hasPointer = true;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerSpeed = Math.min(1, Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / 40);
  lastPX = e.clientX; lastPY = e.clientY;
});
addEventListener('pointerleave', () => { hasPointer = false; });

function pin(sp: Specimen, plate: Plate) {
  if (pinned) pinned.pinned = false;
  pinned = sp; pinnedPlate = plate; sp.pinned = true;
  card.show(sp, plate.m.plateKey);
  document.body.classList.add('pinned');
  hint.classList.add('gone');
  history.replaceState(null, '', `#${plate.m.plateKey}`);
}
function unpin() {
  if (!pinned) return;
  pinned.pinned = false; pinned = null; pinnedPlate = null; card?.hide();
  document.body.classList.remove('pinned');
}
canvas.addEventListener('click', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, scene.camera);
  const hits: THREE.Mesh[] = [];
  for (const p of mounted.values()) for (const s of p.specimens) hits.push(s.hit);
  const hit = raycaster.intersectObjects(hits)[0];
  if (hit) {
    const sp = hit.object.userData.specimen as Specimen;
    const plate = [...mounted.values()].find(p => p.specimens.includes(sp))!;
    if (pinned === sp) unpin(); else pin(sp, plate);
  } else unpin();
});

/* ------------------------------------------------------------------ */
/*  Dev tuning panel (?tune)                                            */
/* ------------------------------------------------------------------ */
if (new URLSearchParams(location.search).has('tune')) {
  const panel = document.getElementById('tune')!; panel.hidden = false;
  for (const [id, key] of [['tAmp', 'amp'], ['tFreq', 'freq'], ['tLag', 'lag'], ['tRest', 'rest'], ['tBreath', 'breath']] as const) {
    const el = document.getElementById(id) as HTMLInputElement; const out = el.nextElementSibling as HTMLElement;
    const upd = () => { (tune as any)[key] = parseFloat(el.value); out.textContent = el.value; }; el.addEventListener('input', upd); upd();
  }
}
let inkTarget = 0;
document.getElementById('bColour')?.addEventListener('click', () => setInk(0));
document.getElementById('bInk')?.addEventListener('click', () => setInk(1));
function setInk(v: number) {
  inkTarget = v;
  document.getElementById('bColour')?.setAttribute('aria-pressed', String(v === 0));
  document.getElementById('bInk')?.setAttribute('aria-pressed', String(v === 1));
}
addEventListener('keydown', (e) => { if (e.key === 'i') setInk(inkTarget ? 0 : 1); });

/* ------------------------------------------------------------------ */
/*  Frame loop                                                          */
/* ------------------------------------------------------------------ */
const clock = new THREE.Clock();
const focus = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const plateNum = document.getElementById('plateNum')!;
let lastEnsure = -1;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

  // which plate is nearest, mount neighbours
  const progress = plateFromScroll();
  const nearest = Math.max(0, Math.min(N - 1, Math.round(progress)));
  if (nearest !== lastEnsure) { lastEnsure = nearest; ensurePlates(nearest); indicator.set(nearest); plateNum.textContent = roman(nearest + 1); }

  // camera follows scroll; when pinned it eases onto the specimen
  let wantY = -progress * PITCH, wantX = 0, wantFov = FOV;
  if (pinned) {
    pinned.centre(tmp2);
    wantY = tmp2.y; wantX = tmp2.x + (innerWidth > 640 ? pinned.span * 0.36 : 0);
    // frame the specimen plus room for the card: about 2.7 spans of view width, never wider than the page
    wantFov = Math.max(14, Math.min(FOV, THREE.MathUtils.radToDeg(2 * Math.atan((pinned.span * 2.7) / (2 * CAM_DIST) / scene.camera.aspect))));
  }
  camY += (wantY - camY) * (1 - Math.pow(0.001, dt));
  camX += (wantX - camX) * (1 - Math.pow(0.001, dt));
  scene.camera.fov += (wantFov - scene.camera.fov) * (1 - Math.pow(0.01, dt)); scene.camera.updateProjectionMatrix();

  const px = hasPointer ? pointer.x : 0, py = hasPointer ? pointer.y : 0;
  camTarget.set(px * 0.18 + camX, camY + py * 0.12, CAM_DIST);
  scene.camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
  scene.camera.lookAt(px * 0.05 + camX, camY + py * 0.03, 0);
  focus.set(camX, camY, 0); scene.follow(focus);

  // pointer in world
  raycaster.setFromCamera(pointer, scene.camera);
  raycaster.ray.intersectPlane(plane0, pointerWorld);
  let hovering = false;
  for (const p of mounted.values()) for (const s of p.specimens) {
    s.update(dt, t, hasPointer ? pointerWorld : null, pointerSpeed, tmp);
    if (hasPointer && !hovering && s.hovered(pointerWorld, tmp)) hovering = true;
  }
  pointerSpeed *= Math.pow(0.001, dt);
  canvas.style.cursor = hovering ? 'pointer' : 'default';

  inkUniform.value += (inkTarget - inkUniform.value) * (1 - Math.pow(0.02, dt));

  if (pinned) {
    pinned.centre(tmp).add(tmp2.set(pinned.span * 0.55, pinned.span * 0.3, 0)).project(scene.camera);
    card.placeAt((tmp.x * 0.5 + 0.5) * innerWidth + 28, (-tmp.y * 0.5 + 0.5) * innerHeight);
  }

  scene.render();
  requestAnimationFrame(frame);
}
ensurePlates(Math.round(plateFromScroll()));
frame();

// keep the URL hash in step with the page for sharing
setInterval(() => { if (!pinned) { const k = index[Math.round(plateFromScroll())]?.plateKey; if (k && location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`); } }, 800);
void targetPlate; void content;
(window as any).__dbg = { get pinned() { return pinned; }, mounted, scene, get camY() { return camY; } };
