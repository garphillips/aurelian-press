import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Scene, FOV } from '../scene';
import { loadBooks, type BookConfig } from '../books';
import { preloadCovers, spine, firstLeaf, pasteDown, BOARD, SQUARE } from '../bindings';
import { ShelfBook, GAP, PULL, TILT, MARGIN, LYING, OPEN_Z, ease, span } from '../shelf';
import { reduceMotion } from '../specimen';

/**
 * How it's made, part II: the shelf and the opening. One WebGL canvas sits behind the page; each figure is a
 * rectangle the renderer is scissored to, so every stage shows the site's own book class, materials and scene.
 */
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const el = (t: string, cls = '', html = '') => { const e = document.createElement(t); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const canvas = $('#gl') as unknown as HTMLCanvasElement;
const scene = new Scene(canvas);
const pmrem = new THREE.PMREMGenerator(scene.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.renderer.setScissorTest(true);

const books = await loadBooks();
await Promise.all([document.fonts.load('20px "IM Fell English"'), document.fonts.load('20px "EB Garamond"')]).catch(() => {});
await preloadCovers(books);
const cfg = (id: string) => books.find(b => b.id === id)!;

/* ---------------- the two light setups, as the site sets them ---------------- */
const READING = { offset: new THREE.Vector3(-1.8, 2.6, 6.5), radius: 9, samples: 16, sun: 1.25, ambient: 1.85, env: 0 };
const SHELF = { offset: new THREE.Vector3(-0.5, 0.8, 7.5), radius: 30, samples: 48, sun: 0.75, ambient: 2.3, env: 0.35 };
function applyLight(k: number, offsetOverride?: THREE.Vector3) {
  const L = THREE.MathUtils.lerp;
  scene.sunOffset.copy(offsetOverride ?? READING.offset.clone().lerp(SHELF.offset, k));
  scene.sun.shadow.radius = L(READING.radius, SHELF.radius, k);
  scene.sun.shadow.blurSamples = Math.round(L(READING.samples, SHELF.samples, k));
  scene.sun.intensity = L(READING.sun, SHELF.sun, k);
  scene.ambient.intensity = L(READING.ambient, SHELF.ambient, k);
  scene.scene.environment = k > 0.5 ? pmrem : null;
  (scene.scene as any).environmentIntensity = L(READING.env, SHELF.env, k);
}

/* ---------------- views: one per figure, each its own group in the shared scene ---------------- */
interface View {
  el: HTMLElement; group: THREE.Group; cam: THREE.PerspectiveCamera; focus: THREE.Vector3;   // focus in group space
  light: number; sunOffset?: THREE.Vector3;
  update(dt: number, now: number, rect: DOMRect): void;
}
const views: View[] = [];
const SPACING = 40;
function makeView(el: HTMLElement, light: number, update: View['update']): View {
  const group = new THREE.Group(); group.position.y = -SPACING * views.length; scene.scene.add(group);
  const v: View = { el, group, cam: new THREE.PerspectiveCamera(FOV, 4 / 3, 0.1, 100), focus: new THREE.Vector3(), light, update };
  group.add(v.cam);      // the camera lives in the group, so every position, look-at and projection is in group space
  views.push(v); return v;
}
/** lookAt takes a world-space target; the cameras think in group space. */
const lookAt = (v: View, x: number, y: number, z: number) => v.cam.lookAt(x + v.group.position.x, y + v.group.position.y, z + v.group.position.z);
/** Where a group-space point lands inside a figure, in CSS pixels. */
const proj = new THREE.Vector3();
function place(v: View, p: THREE.Vector3, rect: DOMRect, node: HTMLElement, clamp = false) {
  proj.copy(p).applyMatrix4(v.group.matrixWorld).project(v.cam);
  let x = (proj.x * 0.5 + 0.5) * rect.width; const y = (-proj.y * 0.5 + 0.5) * rect.height;
  if (clamp) x = Math.min(x, rect.width - node.offsetWidth - 12);
  node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${node.classList.contains('tag') ? 'translate(-50%,-50%)' : 'translate(0,-50%)'}`;
}
/** A book in its shelf slot at the group's origin, as layout() places a single book. */
function slotBook(b: ShelfBook) {
  const { h, w } = b.cfg.format;
  b.slot.set(h / 2, 0, w / 2 + 0.02); b.group.position.copy(b.slot); b.group.quaternion.copy(LYING);
}
/** The shelf's camera distance for a viewport of this aspect. */
const camDist = (longest: number, aspect: number) => (longest + MARGIN) / 2 / (Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect) + 2;
const pointerIn = (e: PointerEvent, rect: DOMRect, out: THREE.Vector2) => out.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);

/* ---------------- I: four boxes ---------------- */
{
  const f = $('#f1'), b = new ShelfBook(cfg('lucas'), () => {});
  const { h, w, d } = b.cfg.format;
  const v = makeView(f, 1, update);
  v.group.add(b.group);
  b.group.position.set(0, -h / 2, w / 2 + 0.05);
  const rest = b.meshes.map(m => m.position.clone()), coverRest = b.cover.position.clone();
  const explode = $('#explode') as HTMLInputElement;
  let auto = true, e = 1, t0 = -1;
  explode.addEventListener('input', () => { auto = false; });
  const tags = [
    ['back board', () => new THREE.Vector3(-d / 2 - e * 0.5, h * 0.35, 0)],
    ['spine', () => new THREE.Vector3(0, h * 0.7, w / 2 + e * 0.5)],
    ['page block · first leaf outward', () => new THREE.Vector3(0.05, -h * 0.25, -w * 0.15)],
    ['front board, on its hinge', () => new THREE.Vector3(d / 2 + e * 0.5, h * 0.05, -w * 0.5)],
  ].map(([name, at]) => { const n = el('div', 'tag', name as string); f.appendChild(n); return { n, at: at as () => THREE.Vector3 }; });
  v.cam.position.set(0, 0.4, 8.2); lookAt(v, 0, 0, 0); v.focus.set(0, 0, 0);
  function update(dt: number, now: number, rect: DOMRect) {
    if (t0 < 0) t0 = now;
    if (auto && !reduceMotion) { const u = Math.min(1, (now - t0) / 3200); e = 1 - ease(u); explode.value = e.toFixed(2); }
    else e = parseFloat(explode.value);
    if (reduceMotion && auto) e = 0.35;
    // each part slides out along its own outward direction
    b.meshes[0].position.x = rest[0].x - e * 0.5;                 // back board, -x
    b.meshes[1].position.z = rest[1].z + e * 0.5;                 // spine, +z
    b.cover.position.x = coverRest.x + e * 0.5;                   // front board (in its hinge group), +x
    b.group.rotation.y = reduceMotion ? -0.6 : -0.6 + Math.sin(now / 6000) * 0.9;
    tags.forEach((t, i) => { place(v, t.at().applyQuaternion(b.group.quaternion).add(b.group.position), rect, t.n); t.n.classList.toggle('on', now - t0 > 600 + i * 350); });
  }
}

/* ---------------- II: cloth and gilt ---------------- */
{
  const f = $('#f2'), c = cfg('british-moths'), b = new ShelfBook(c, () => {});
  const { h } = c.format;
  const v = makeView(f, 1, update);
  v.group.add(b.group); b.group.position.set(0, -h / 2, c.format.w / 2 + 0.05);        // upright, spine to the viewer, in front of the paper
  v.cam.position.set(0, 0, 7.6); lookAt(v, 0, 0, 0);
  v.sunOffset = new THREE.Vector3();
  const strip = $('#strip2');
  const colour = spine(c, false), mr = spine(c, true);
  for (const [cv, cap] of [[colour, 'colour: grain photograph, gilt title with its shadow and highlight'], [mr, 'roughness (green) and metalness (blue): the gilt is the blue']] as const) {
    const fig = el('figure'); const sm = document.createElement('canvas');
    // the spines are tall and thin; show them turned on their side
    sm.width = cv.height; sm.height = cv.width; const g = sm.getContext('2d')!; g.translate(sm.width / 2, sm.height / 2); g.rotate(-Math.PI / 2); g.drawImage(cv, -cv.width / 2, -cv.height / 2);
    fig.append(sm, el('figcaption', '', cap)); strip.append(fig);
  }
  function update(_dt: number, now: number) {
    const a = reduceMotion ? 0.6 : now / 2600;
    v.sunOffset!.set(Math.sin(a) * 4.5, 1.2 + Math.cos(a * 0.7) * 1.2, 6.5);
    b.group.rotation.y = reduceMotion ? 0 : Math.sin(now / 5000) * 0.35;
  }
}

/* ---------------- III: the first leaf (2D) ---------------- */
{
  const c = cfg('lucas'), { h, w, d } = c.format, strip = $('#strip3');
  const blockW = w - BOARD - SQUARE, blockH = h - 2 * SQUARE;
  const leaf = firstLeaf(c, blockW, blockH, () => {}), pd = pasteDown(c);
  for (const [cv, cap] of [[pd, 'paste-down: cream, darker toward the hinge'], [leaf, `first leaf: the portrait multiplied onto cream, ${blockW.toFixed(2)} × ${blockH.toFixed(2)} units at 420 px per unit`]] as const) {
    const fig = el('figure'); fig.append(cv, el('figcaption', '', cap)); strip.append(fig);
  }
  void d;
}

/* ---------------- IV: the light ---------------- */
{
  const f = $('#f4'), b = new ShelfBook(cfg('british-moths'), () => {});
  const v = makeView(f, 0, update);
  v.group.add(b.group); slotBook(b);
  const slider = $('#light') as HTMLInputElement, out = $('#lightOut');
  let auto = true, t0 = -1;
  slider.addEventListener('input', () => { auto = false; });
  function update(_dt: number, now: number) {
    if (t0 < 0) t0 = now;
    if (auto && !reduceMotion) slider.value = ease(Math.min(1, (now - t0) / 2600)).toFixed(2);
    if (auto && reduceMotion) slider.value = '1';
    v.light = parseFloat(slider.value);
    const k = v.light, L = THREE.MathUtils.lerp;
    out.textContent = `sun (${L(-1.8, -0.5, k).toFixed(2)}, ${L(2.6, 0.8, k).toFixed(2)}, ${L(6.5, 7.5, k).toFixed(2)})  penumbra ${L(9, 30, k).toFixed(0)}  samples ${Math.round(L(16, 48, k))}  sun ${L(1.25, 0.75, k).toFixed(2)}  ambient ${L(1.85, 2.3, k).toFixed(2)}  environment ${k > 0.5 ? 'room' : 'none'}`;
    b.pose(0, v.focus);
  }
  const dist = camDist(b.cfg.format.h, 4 / 3);
  v.cam.position.set(0, 0, dist); lookAt(v, 0, 0, 0);
}

/* ---------------- V: the column ---------------- */
{
  const f = $('#f5'), out = $('#colOut');
  const list = books.map(c => new ShelfBook(c, () => {}));
  const v = makeView(f, 1, update);
  // layout(): the column grows downward, one thickness and a gap at a time
  let y = 0;
  list.forEach((b, i) => {
    const { h, d, w } = b.cfg.format;
    if (i > 0) y -= d / 2;
    b.slot.set(h / 2, y, w / 2 + 0.02); b.group.position.copy(b.slot); b.group.quaternion.copy(LYING);
    v.group.add(b.group);
    y -= d / 2 + GAP;
  });
  const colTop = list[0].cfg.format.d / 2 + 0.6, colH = colTop - (y - 0.7);
  const longest = Math.max(...list.map(b => b.cfg.format.h));
  const labels = list.map(b => {
    const c = b.cfg, n = el('div', 'label', `<b>${c.shortTitle}</b><span>${c.author} · ${c.place}, ${c.year}</span><small>${c.plates} plates · ${c.specimens} ${c.noun}</small>`);
    f.appendChild(n); return n;
  });
  let dist = 12, viewH = 1;
  function update(_dt: number, now: number, rect: DOMRect) {
    const aspect = rect.width / rect.height, tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    dist = camDist(longest, aspect); viewH = 2 * (dist - 1) * tan;
    // a slow scroll down the column and back, standing in for the page's own scroll
    const fits = colH <= viewH;
    const s = reduceMotion ? 0.5 : 0.5 - Math.cos(now / 9000) * 0.5;
    v.focus.set(0, fits ? colTop - colH / 2 : colTop - viewH / 2 - s * (colH - viewH), 0);
    v.cam.position.set(0, v.focus.y, dist); lookAt(v, v.focus.x, v.focus.y, 0);
    list.forEach((b, i) => {
      b.pose(0, v.focus);
      const p = new THREE.Vector3(b.cfg.format.h / 2 + 0.3, b.slot.y, b.slot.z + b.cfg.format.w / 2);
      place(v, p, rect, labels[i], true); labels[i].classList.toggle('on', true);
    });
    out.textContent = `column ${colH.toFixed(2)} units tall · visible ${viewH.toFixed(2)} · camera at ${dist.toFixed(2)} · spacer ${fits ? '100vh' : ((colH / viewH) * 100).toFixed(0) + 'vh'}`;
  }
}

/* ---------------- VI: hover ---------------- */
{
  const f = $('#f6'), b = new ShelfBook(cfg('lucas'), () => {}), out = $('#hoverOut');
  const v = makeView(f, 1, update);
  v.group.add(b.group); slotBook(b);
  const label = el('div', 'label', `<b>${b.cfg.shortTitle}</b><span>${b.cfg.author} · ${b.cfg.place}, ${b.cfg.year}</span><small>${b.cfg.plates} plates · ${b.cfg.specimens} ${b.cfg.noun}</small>`);
  f.appendChild(label);
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(-10, -10);
  let has = false;
  f.addEventListener('pointermove', (e) => { has = true; pointerIn(e, f.getBoundingClientRect(), pointer); });
  f.addEventListener('pointerleave', () => { has = false; pointer.set(-10, -10); });
  const dist = camDist(b.cfg.format.h, 4 / 3), camTarget = new THREE.Vector3();
  v.cam.position.set(0, 0, dist);
  function update(dt: number, _now: number, rect: DOMRect) {
    ray.setFromCamera(pointer, v.cam);
    const hit = has && ray.intersectObjects(b.meshes, false).length > 0;
    const k = 1 - Math.pow(0.002, dt);
    b.hover += ((hit ? 1 : 0) - b.hover) * k * (reduceMotion ? 8 : 1);
    b.pose(0, v.focus);
    const px = has ? pointer.x : 0, py = has ? pointer.y : 0;
    camTarget.set(px * 0.35, py * 0.22, dist); v.cam.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
    lookAt(v, px * 0.1, py * 0.06, 0);
    f.style.cursor = hit ? 'pointer' : 'default';
    place(v, new THREE.Vector3(b.cfg.format.h / 2 + 0.3, b.slot.y, b.slot.z + b.cfg.format.w / 2 + b.hover * PULL), rect, label, true);
    label.classList.toggle('on', hit);
    out.textContent = `hover ${b.hover.toFixed(2)} → pull ${(b.hover * PULL).toFixed(2)} units, tilt ${(b.hover * TILT).toFixed(2)} rad · camera offset (${(px * 0.35).toFixed(2)}, ${(py * 0.22).toFixed(2)})`;
  }
}

/* ---------------- VII: the opening, and the curtain ---------------- */
{
  const f = $('#f7'), b = new ShelfBook(cfg('lucas'), () => {});
  const v = makeView(f, 1, update);
  v.group.add(b.group); slotBook(b);
  const dist = camDist(b.cfg.format.h, 4 / 3);
  const curtain = el('div', 'curtain'), reading = el('div', 'reading'); f.append(curtain, reading);
  // the reading session, in still life: plate I of the Lucas, its layers placed by the manifest
  fetch('/books/lucas/plates/index.json').then(r => r.json()).then(async (idx: any) => {
    // the first plate that was scanned head-up, so its layers sit where the manifest says without a rotation
    const first = idx.find((p: any) => (p.rotate ?? []).every((r: string) => r === 'none')) ?? idx[0]; const key = first.plateKey;
    const man = await fetch(`/books/lucas/plates/${key}/manifest.json`).then(r => r.json());
    const [W, H] = man.canvas;
    reading.append(el('div', 'plateNum', `Plate<b>${['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][first.order] ?? first.order}</b>`));
    for (const s of man.specimens) for (const [name, part] of Object.entries<any>(s.parts)) {
      if (!part) continue;
      const img = new Image(); img.src = `/books/lucas/plates/${key}/${s.id}_${name}.webp`;
      const [x0, y0, x1, y1] = part.bbox;
      // the colour layer alone, unmasked, would show its white ground; use the alpha as a CSS mask
      img.style.cssText = `left:${(x0 / W) * 100}%;top:${(y0 / H) * 100}%;width:${((x1 - x0) / W) * 100}%;height:${((y1 - y0) / H) * 100}%;mix-blend-mode:multiply;` +
        `-webkit-mask:url(/books/lucas/plates/${key}/${s.id}_${name}_a.webp) center/100% 100%;mask:url(/books/lucas/plates/${key}/${s.id}_${name}_a.webp) center/100% 100%;` +
        (name === 'wing-L' ? 'transform:scaleX(-1);' : '');
      reading.append(img);
    }
  }).catch(() => {});

  // phases of the round trip, in seconds
  const PH = [
    { id: 'shelf', label: 'shelf', dur: 1.2 }, { id: 'open', label: 'lift, swing, open · 1.7 s', dur: 1.7 }, { id: 'linger', label: 'frontispiece · 1.6 s', dur: 1.6 },
    { id: 'curtain1', label: 'curtain · 0.56 s', dur: 0.56 }, { id: 'reading', label: 'reading', dur: 2.6 }, { id: 'curtain2', label: 'curtain', dur: 0.56 },
    { id: 'close', label: 'close · 1.5 s', dur: 1.5 }, { id: 'rest', label: 'shelf', dur: 1.4 },
  ];
  const total = PH.reduce((a, p) => a + p.dur, 0);
  const phases = $('#phases'); const chips = PH.map(p => { const s = el('span', '', p.label); phases.append(s); return s; });
  const scrub = $('#scrub') as HTMLInputElement, play = $('#play') as HTMLButtonElement;
  let mode: 'play' | 'scrub' = 'play', t0 = -1, t = 0;
  scrub.addEventListener('input', () => { mode = 'scrub'; });
  play.addEventListener('click', () => { mode = 'play'; t0 = -1; });

  // the timeline graph
  const tl = $('#timeline'), NS = 'http://www.w3.org/2000/svg', Wg = 600, Hg = 150, x = (u: number) => 40 + u * (Wg - 60), yy = (k: number) => Hg - 24 - k * (Hg - 44);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${Wg} ${Hg}`);
  const curves: [string, (u: number) => number][] = [
    ['rise', u => ease(span(u, 0, 0.55))], ['swing', u => ease(span(u, 0.1, 0.65))], ['open', u => ease(span(u, 0.45, 1))], ['dolly', u => ease(span(u, 0, 0.7))],
  ];
  const mk = (tag: string, attrs: Record<string, string | number>, text?: string) => { const n = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(attrs)) n.setAttribute(k, String(val)); if (text) n.textContent = text; svg.append(n); return n; };
  mk('line', { x1: x(0), x2: x(1), y1: yy(0), y2: yy(0), class: 'axis' }); mk('line', { x1: x(0), x2: x(0), y1: yy(0), y2: yy(1), class: 'axis' });
  mk('text', { x: x(0), y: Hg - 6 }, 't = 0'); mk('text', { x: x(1) - 30, y: Hg - 6 }, 't = 1 · 1.7 s'); mk('text', { x: 4, y: yy(1) + 4 }, '1'); mk('text', { x: 4, y: yy(0) + 4 }, '0');
  curves.forEach(([name, fn], i) => {
    let d = ''; for (let s = 0; s <= 100; s++) { const u = s / 100; d += `${s ? 'L' : 'M'}${x(u).toFixed(1)},${yy(fn(u)).toFixed(1)} `; }
    mk('path', { d, class: `curve ${name}` });
    mk('text', { x: x(1) + 6, y: yy(1) + 12 + i * 14, class: name }, name);
  });
  const head = mk('line', { x1: x(0), x2: x(0), y1: yy(0), y2: yy(1), class: 'head' });
  tl.append(svg);

  const camTarget = new THREE.Vector3();
  const setPose = (u: number) => {
    t = u; b.hover = 0; b.pose(u, v.focus);
    camTarget.set(0, 0, THREE.MathUtils.lerp(dist, OPEN_Z + 7.4, ease(span(u, 0, 0.7))));
    v.cam.position.copy(camTarget); lookAt(v, 0, 0, 0);
    head.setAttribute('x1', String(x(u))); head.setAttribute('x2', String(x(u)));
  };
  function update(_dt: number, now: number) {
    let phase = 'shelf';
    if (mode === 'scrub') { setPose(parseFloat(scrub.value)); curtain.classList.remove('up'); reading.classList.remove('on'); phase = t > 0 ? 'open' : 'shelf'; }
    else {
      if (t0 < 0) t0 = now;
      let s = ((now - t0) / 1000) % total; let u = 0;
      for (const p of PH) { if (s < p.dur) { phase = p.id; u = s / p.dur; break; } s -= p.dur; }
      if (reduceMotion) u = 1;
      switch (phase) {
        case 'shelf': case 'rest': setPose(0); break;
        case 'open': setPose(u); break;
        case 'linger': case 'curtain1': setPose(1); break;
        case 'reading': case 'curtain2': setPose(1); break;
        case 'close': setPose(1 - u); break;
      }
      curtain.classList.toggle('up', phase === 'curtain1' || phase === 'curtain2' || (phase === 'reading' && u < 0.02));
      reading.classList.toggle('on', phase === 'reading' || phase === 'curtain2');
      scrub.value = t.toFixed(3);
    }
    chips.forEach((c, i) => c.classList.toggle('on', PH[i].id === phase));
  }
  setPose(0);
}

/* ---------------- the render loop: clear the whole canvas, then draw each visible figure ---------------- */
const clock = new THREE.Clock();
const paperCss = () => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#e8dec4';
const worldFocus = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), now = performance.now();
  const r = scene.renderer;
  r.setScissorTest(false); r.setClearColor(new THREE.Color(paperCss())); r.clear();
  r.setScissorTest(true);
  for (const v of views) {
    const rect = v.el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || rect.width < 2) continue;
    v.update(dt, now, rect);
    v.cam.aspect = rect.width / rect.height; v.cam.updateProjectionMatrix();
    applyLight(v.light, v.sunOffset);
    worldFocus.copy(v.focus).add(v.group.position); scene.follow(worldFocus);
    const y = innerHeight - rect.bottom;
    r.setViewport(rect.left, y, rect.width, rect.height); r.setScissor(rect.left, y, rect.width, rect.height);
    r.render(scene.scene, v.cam);
  }
  requestAnimationFrame(frame);
}
frame();
