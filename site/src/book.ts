import * as THREE from 'three';
import { Scene, CAM_DIST, FOV } from './scene';
import { Plate, PITCH, loadManifest } from './plate';
import { Specimen, tune } from './specimen';
import { Indicator } from './indicator';
import { Card } from './card';
import { loadContent, clearContent, plateLabel, roman } from './content';
import { inkUniform } from './shaders';
import { volumesOf, romanVol, type BookConfig } from './books';
import type { PlateIndexEntry } from './types';

export interface BookSession { stop(): void }

/**
 * The reading experience for one book: scroll plate by plate, hover to stir the
 * specimens, click to pin one and read its card. Everything it attaches to the page
 * is undone by stop(), so the shelf can open another book in the same scene.
 */
export async function startBook(scene: Scene, book: BookConfig, onShelf: () => void): Promise<BookSession> {
  const ac = new AbortController(); const { signal } = ac;
  const on = <K extends keyof WindowEventMap>(k: K, fn: (e: WindowEventMap[K]) => void, opts: AddEventListenerOptions = {}) =>
    addEventListener(k, fn as any, { ...opts, signal });
  const canvas = scene.renderer.domElement;

  document.body.classList.add('reading'); document.body.classList.remove('shelf');
  document.getElementById('mastSub')!.textContent = book.masthead ?? `${book.title} · ${book.place}, ${book.year}`;
  document.getElementById('credit')!.innerHTML = book.credit ?? '';
  document.getElementById('hint')!.classList.remove('gone');
  document.querySelectorAll<HTMLAnchorElement>('#masthead a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); onShelf(); }, { signal }));

  /* ---------------- volumes: one scroll through every volume that exists ---------------- */
  interface Entry extends PlateIndexEntry { root: string; vol: number; volStart: number; volCount: number; hash: string }
  const volumes = volumesOf(book), multi = volumes.length > 1;
  const index: Entry[] = [];
  for (const v of volumes) {
    if (v.status !== 'ready') continue;
    const [list] = await Promise.all([fetch(`${v.root}/plates/index.json`).then(r => r.json()) as Promise<PlateIndexEntry[]>, loadContent(v.root)]);
    const volStart = index.length;
    for (const e of list) index.push({ ...e, root: v.root, vol: v.n, volStart, volCount: list.length, hash: multi ? `v${v.n}-${e.plateKey}` : e.plateKey });
  }
  const N = index.length;
  document.getElementById('spacer')!.style.height = `${N * 100}vh`;
  const plateCount = document.getElementById('plateCount')!;

  // the volume switcher under the masthead; volumes still to come are shown but dimmed
  const volNav = document.getElementById('volumes')!; volNav.innerHTML = '';
  const volLinks = new Map<number, HTMLAnchorElement>();
  if (multi) {
    const lead = document.createElement('span'); lead.textContent = 'Volume'; volNav.appendChild(lead);
    for (const v of volumes) {
      const a = document.createElement('a'); a.textContent = romanVol(v.n);
      const first = index.find(e => e.vol === v.n);
      if (first) { a.href = `#${first.hash}`; a.addEventListener('click', (e) => { e.preventDefault(); scrollToPlate(first.volStart); }, { signal }); }
      else { a.classList.add('coming'); a.title = 'to follow'; a.setAttribute('aria-disabled', 'true'); }
      volNav.appendChild(a); volLinks.set(v.n, a);
    }
  }

  const indicator = new Indicator(N,
    i => multi && i === index[i].volStart
      ? `Vol. ${romanVol(index[i].vol)} · ${plateLabel(index[i].root, index[i].plateKey, index[i].specimens).replace(/^[IVXLC]+ · /, '')}`
      : plateLabel(index[i].root, index[i].plateKey, index[i].specimens),
    i => scrollToPlate(i),
    i => roman(i - index[i].volStart + 1),
    i => i === index[i].volStart);

  /* ---------------- plates: only the few around the viewport exist ---------------- */
  const mounted = new Map<number, Plate>();
  const KEEP = 2;
  async function ensurePlates(centre: number) {
    for (const [i, p] of mounted) if (Math.abs(i - centre) > KEEP) { p.dispose(); mounted.delete(i); }
    for (let i = Math.max(0, centre - KEEP); i <= Math.min(N - 1, centre + KEEP); i++) {
      if (mounted.has(i)) continue;
      const m = await loadManifest(index[i].root, index[i].plateKey);
      if (signal.aborted || mounted.has(i)) continue;
      const plate = new Plate(m, i, index[i].root);
      mounted.set(i, plate); scene.scene.add(plate.group);
    }
  }

  /* ---------------- scroll & routing ---------------- */
  let camY = 0, camX = 0;
  let pinned: Specimen | null = null;
  const hint = document.getElementById('hint')!;
  const plateFromScroll = () => scrollY / innerHeight;
  function scrollToPlate(i: number, smooth = true) {
    unpin();
    scrollTo({ top: i * innerHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  // deep link: #n16 (or #v2-n7 in a multi-volume book) or #plate-3
  const hash = location.hash.replace('#', '');
  let start = 0;
  if (hash) {
    const byKey = index.findIndex(p => p.hash === hash);
    const byNum = hash.startsWith('plate-') ? parseInt(hash.slice(6)) - 1 : -1;
    const i = byKey >= 0 ? byKey : byNum;
    if (i >= 0 && i < N) start = i;
  }
  scrollToPlate(start, false); camY = -start * PITCH;

  on('keydown', (e) => {
    if (e.key === 'Escape') { if (pinned) unpin(); else onShelf(); }
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') { e.preventDefault(); scrollToPlate(Math.min(N - 1, Math.round(plateFromScroll()) + 1)); }
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') { e.preventDefault(); scrollToPlate(Math.max(0, Math.round(plateFromScroll()) - 1)); }
    if (e.key === 'i') setInk(inkTarget ? 0 : 1);
  });
  let lastScroll = scrollY;
  on('scroll', () => {
    if (Math.abs(scrollY - lastScroll) > 80 && pinned) unpin();
    lastScroll = scrollY; hint.classList.add('gone');
  }, { passive: true });

  /* ---------------- pointer, pinning ---------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(-10, -10), pointerWorld = new THREE.Vector3();
  const plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let hasPointer = false, pointerSpeed = 0, lastPX = 0, lastPY = 0;
  const card = new Card(() => unpin(), book.unreadNote);

  on('pointermove', (e) => {
    hasPointer = true;
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerSpeed = Math.min(1, Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / 40);
    lastPX = e.clientX; lastPY = e.clientY;
  });
  on('pointerleave', () => { hasPointer = false; });

  function pin(sp: Specimen, plate: Plate) {
    if (pinned) pinned.pinned = false;
    pinned = sp; sp.pinned = true;
    card.show(sp, plate.m.plateKey, plate.root);
    document.body.classList.add('pinned');
    hint.classList.add('gone');
    history.replaceState(null, '', `#${index[plate.index].hash}`);
  }
  function unpin() {
    if (!pinned) return;
    pinned.pinned = false; pinned = null; card.hide();
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
  }, { signal });

  /* ---------------- dev tuning panel (?tune) ---------------- */
  if (new URLSearchParams(location.search).has('tune')) {
    const panel = document.getElementById('tune')!; panel.hidden = false;
    for (const [id, key] of [['tAmp', 'amp'], ['tFreq', 'freq'], ['tLag', 'lag'], ['tRest', 'rest'], ['tBreath', 'breath']] as const) {
      const el = document.getElementById(id) as HTMLInputElement; const out = el.nextElementSibling as HTMLElement;
      const upd = () => { (tune as any)[key] = parseFloat(el.value); out.textContent = el.value; }; el.addEventListener('input', upd, { signal }); upd();
    }
  }
  let inkTarget = inkUniform.value > 0.5 ? 1 : 0;
  document.getElementById('bColour')?.addEventListener('click', () => setInk(0), { signal });
  document.getElementById('bInk')?.addEventListener('click', () => setInk(1), { signal });
  function setInk(v: number) {
    inkTarget = v;
    document.getElementById('bColour')?.setAttribute('aria-pressed', String(v === 0));
    document.getElementById('bInk')?.setAttribute('aria-pressed', String(v === 1));
  }

  /* ---------------- frame loop ---------------- */
  const clock = new THREE.Clock();
  const focus = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const plateNum = document.getElementById('plateNum')!;
  let lastEnsure = -1, raf = 0;
  scene.camera.position.set(0, camY, CAM_DIST); scene.camera.fov = FOV; scene.camera.updateProjectionMatrix();

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    const progress = plateFromScroll();
    const nearest = Math.max(0, Math.min(N - 1, Math.round(progress)));
    if (nearest !== lastEnsure) {
      lastEnsure = nearest; ensurePlates(nearest); indicator.set(nearest);
      const e = index[nearest];
      plateNum.textContent = roman(nearest - e.volStart + 1);
      plateCount.textContent = multi ? `vol. ${romanVol(e.vol)} · of ${e.volCount}` : `of ${e.volCount}`;
      if (multi) for (const [n, a] of volLinks) a.classList.toggle('current', n === e.vol);
    }

    // camera follows scroll; when pinned it eases onto the specimen
    let wantY = -progress * PITCH, wantX = 0, wantFov = FOV;
    if (pinned) {
      pinned.centre(tmp2);
      wantY = tmp2.y; wantX = tmp2.x + (innerWidth > 640 ? pinned.span * 0.36 : 0);
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
    raf = requestAnimationFrame(frame);
  }
  ensurePlates(start);
  frame();

  // keep the URL hash in step with the page for sharing
  const hashTimer = setInterval(() => {
    if (!pinned) { const k = index[Math.round(plateFromScroll())]?.hash; if (k && location.hash !== `#${k}`) history.replaceState(null, '', `#${k}`); }
  }, 800);
  (window as any).__dbg = { get pinned() { return pinned; }, mounted, scene, get camY() { return camY; } };

  return {
    stop() {
      ac.abort(); cancelAnimationFrame(raf); clearInterval(hashTimer);
      unpin();
      for (const p of mounted.values()) p.dispose(); mounted.clear();
      clearContent(); volNav.innerHTML = '';
      document.body.classList.remove('reading');
      document.getElementById('spacer')!.style.height = '0px';
      scrollTo({ top: 0, behavior: 'auto' });
    },
  };
}
