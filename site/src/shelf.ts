import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Scene } from './scene';
import { FOV } from './scene';
import type { BookConfig } from './books';
import { BOARD, SQUARE, board, edge, spine, pages, firstLeaf, pasteDown, faceMaterial, tex } from './bindings';
import { reduceMotion } from './specimen';

const GAP = 0.5;             // between books in the column
const PULL = 0.3;            // hover: how far a book comes toward the viewer
const TILT = 0.2;            // hover: radians the front board tips toward the viewer
const MARGIN = 2.4;          // world units of air either side of the longest book
const LYING = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));     // on its back, head to the left
const FACING = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));   // upright, front board to the viewer
const OPEN_Z = 4.2;          // where the opened book floats, well clear of the row
const COVER_OPEN = -2.75;    // radians the front board swings

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const span = (t: number, a: number, b: number) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);

/** One bound volume: boards, spine and page block, the front board on a hinge. */
class ShelfBook {
  group = new THREE.Group();          // origin: bottom centre, spine facing +z
  cover = new THREE.Group();          // hinge at the spine edge of the front board
  meshes: THREE.Mesh[] = [];
  slot = new THREE.Vector3();         // resting place on the shelf
  hover = 0; openT = 0;
  label!: HTMLAnchorElement;
  private disposables: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [];

  constructor(public cfg: BookConfig, onTextureReady: () => void) {
    const { h, w, d } = cfg.format;
    const mat = (c: HTMLCanvasElement, mr?: HTMLCanvasElement) => { const m = faceMaterial(c, mr); this.disposables.push(m); return m; };
    const clothEdge = mat(edge(cfg));
    const spineMat = mat(spine(cfg, false), spine(cfg, true));
    const frontMat = mat(board(cfg, true, false), board(cfg, true, true));
    const backMat = mat(board(cfg, false, false), board(cfg, false, true));
    const inside = mat(pasteDown(cfg));
    const pageTop = mat(pages(w, d, 3)), pageFore = mat(pages(h, d, 4));
    const blockW = w - BOARD - SQUARE, blockH = h - 2 * SQUARE, blockD = d - 2 * BOARD;
    const leafCanvas = firstLeaf(cfg, blockW, blockH, () => { leaf.map!.needsUpdate = true; onTextureReady(); });
    // the leaf and paste-down are lit by ambient + sun + room, which sum to well over 1; their base is scaled so
    // their cream renders as the site's paper (measured: 0xb0 lands the leaf at the paper's 223/255)
    const PAGE_BASE = 0xb0b0b0;
    const leaf = new THREE.MeshStandardMaterial({ map: tex(leafCanvas), roughness: 0.95, color: PAGE_BASE }); this.disposables.push(leaf);
    inside.color.set(PAGE_BASE);
    const cream = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, roughness: 0.95 }); this.disposables.push(cream);

    const add = (geo: THREE.BoxGeometry, mats: THREE.Material[], parent: THREE.Object3D, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mats); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
      m.userData.book = this; parent.add(m); this.meshes.push(m); this.disposables.push(geo); return m;
    };
    // face order: +x, -x, +y, -y, +z, -z
    // back board (left, -x), full height and width
    add(new THREE.BoxGeometry(BOARD, h, w), [inside, backMat, clothEdge, clothEdge, clothEdge, clothEdge], this.group, -d / 2 + BOARD / 2, h / 2, 0);
    // spine wraps the front, +z
    add(new THREE.BoxGeometry(d, h, BOARD), [clothEdge, clothEdge, clothEdge, clothEdge, spineMat, clothEdge], this.group, 0, h / 2, w / 2 - BOARD / 2);
    // page block, set in by the squares; its +x face is the first leaf, seen when the cover opens
    add(new THREE.BoxGeometry(blockD, blockH, blockW), [leaf, cream, pageTop, pageTop, cream, pageFore], this.group, 0, h / 2, -(BOARD + SQUARE) / 2 + SQUARE / 2 - 0.001);
    // front board on its hinge at the spine edge
    this.cover.position.set(d / 2 - BOARD / 2, h / 2, w / 2 - BOARD);
    this.group.add(this.cover);
    add(new THREE.BoxGeometry(BOARD, h, w - BOARD), [frontMat, inside, clothEdge, clothEdge, clothEdge, clothEdge], this.cover, 0, 0, -(w - BOARD) / 2);
  }

  private qRest = new THREE.Quaternion(); private tilt = new THREE.Quaternion();

  /** Pose for the open transition, 0 = floating in the column, 1 = open before the viewer. */
  pose(t: number, focus: THREE.Vector3) {
    const { h } = this.cfg.format;
    const rise = ease(span(t, 0, 0.55)), swing = ease(span(t, 0.1, 0.65)), open = ease(span(t, 0.45, 1));
    // at rest the book lies on its back; hover tips its front board toward the viewer
    this.tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.hover * TILT);
    this.qRest.copy(this.tilt).multiply(LYING);
    const target = new THREE.Vector3(focus.x, focus.y - h / 2 + 0.05, OPEN_Z);
    this.group.position.set(
      THREE.MathUtils.lerp(this.slot.x, target.x, rise),
      THREE.MathUtils.lerp(this.slot.y, target.y, rise) + Math.sin(rise * Math.PI) * 0.3,
      THREE.MathUtils.lerp(this.slot.z + this.hover * PULL, target.z, rise));
    this.group.quaternion.slerpQuaternions(this.qRest, FACING, swing);
    this.cover.rotation.y = COVER_OPEN * open;
  }

  dispose() { for (const d of this.disposables) d.dispose(); this.group.removeFromParent(); }
}

/**
 * The shelf: every book stands in the same light as the plates. Hover pulls one out;
 * click lifts it, opens the front board and hands over to the reading experience.
 */
export class Shelf {
  group = new THREE.Group();
  books: ShelfBook[] = [];
  focus = new THREE.Vector3();
  camDist = 12;
  private raycaster = new THREE.Raycaster();
  private hovered: ShelfBook | null = null;
  private opening: ShelfBook | null = null;
  private ac = new AbortController();
  private colTop = 0; private colH = 0; private viewH = 1;
  private lightBefore!: { offset: THREE.Vector3; radius: number; samples: number; sun: number; ambient: number };
  private labels = document.getElementById('labels')!;
  private more = document.getElementById('more')!;
  private moreSlot = new THREE.Vector3();
  private pmrem: THREE.Texture;

  constructor(private scene: Scene, configs: BookConfig[], private onOpen: (b: BookConfig) => void) {
    const pm = new THREE.PMREMGenerator(scene.renderer);
    this.pmrem = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
    scene.scene.environment = this.pmrem;
    (scene.scene as any).environmentIntensity = 0.35;
    // softer light for the floating books: sun near the viewing axis, wide penumbra, less contrast
    this.lightBefore = { offset: scene.sunOffset.clone(), radius: scene.sun.shadow.radius, samples: scene.sun.shadow.blurSamples, sun: scene.sun.intensity, ambient: scene.ambient.intensity };
    scene.sunOffset.set(-0.5, 0.8, 7.5);
    scene.sun.shadow.radius = 30; scene.sun.shadow.blurSamples = 48;
    scene.sun.intensity = 0.75; scene.ambient.intensity = 2.3;

    this.labels.innerHTML = '';
    for (const cfg of configs) {
      const b = new ShelfBook(cfg, () => {});
      b.label = this.makeLabel(cfg, b);
      this.books.push(b); this.group.add(b.group);
    }
    scene.scene.add(this.group);
    this.layout();

    const { signal } = this.ac;
    const canvas = scene.renderer.domElement;
    addEventListener('pointermove', (e) => this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), { signal });
    canvas.addEventListener('click', (e) => {
      if (this.opening) return;
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      const b = this.pick(); if (b) this.tryOpen(b);
    }, { signal });
    addEventListener('resize', () => this.layout(), { signal });
    document.body.classList.add('shelf');
  }
  pointer = new THREE.Vector2(-10, -10);

  private makeLabel(cfg: BookConfig, b: ShelfBook) {
    const li = document.createElement('li');
    const a = document.createElement('a'); a.href = cfg.route;
    const ready = cfg.volumes?.filter(v => v.status === 'ready').length;
    const vols = cfg.volumes ? ` · vol. ${ready === 1 ? 'I' : 'I–' + ['', 'I', 'II', 'III', 'IV'][ready!]} of ${['', 'I', 'II', 'III', 'IV'][cfg.volumes.length]}` : '';
    const count = cfg.plates ? `${cfg.plates} plates · ${cfg.specimens} ${cfg.noun}${vols}` : 'to follow';
    a.innerHTML = `<b>${cfg.shortTitle}</b><span>${cfg.author} · ${cfg.place}, ${cfg.year}</span><small>${count}</small>`;
    if (cfg.status !== 'ready') a.classList.add('coming');
    a.addEventListener('click', (e) => { e.preventDefault(); if (!this.opening) this.tryOpen(b); });
    a.addEventListener('pointerenter', () => { this.labelHover = b; });
    a.addEventListener('pointerleave', () => { if (this.labelHover === b) this.labelHover = null; });
    li.appendChild(a); this.labels.appendChild(li);
    return a;
  }
  private labelHover: ShelfBook | null = null;

  private tryOpen(b: ShelfBook) {
    if (b.cfg.status !== 'ready') { b.label.classList.add('nudge'); setTimeout(() => b.label.classList.remove('nudge'), 700); return; }
    this.onOpen(b.cfg);
  }

  /** Books float in one column, lying on their backs, spines to the viewer; the column grows downward. */
  layout() {
    const aspect = innerWidth / innerHeight;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const longest = Math.max(...this.books.map(b => b.cfg.format.h));
    this.camDist = (longest + MARGIN) / 2 / (tan * aspect) + 2;
    this.viewH = 2 * (this.camDist - 1) * tan;          // visible height at the books' depth
    let y = 0;
    this.books.forEach((b, i) => {
      const { h, d, w } = b.cfg.format;
      if (i > 0) y -= d / 2;
      // the group origin is the foot of the book; lying head-left it extends toward -x, so shift by h/2 to centre it
      b.slot.set(h / 2, y, w / 2 + 0.02);
      b.group.position.copy(b.slot);
      y -= d / 2 + GAP;
    });
    const last = this.books[this.books.length - 1];
    this.moreSlot.set(0, y - 0.1, 1.0);
    this.colTop = this.books[0].cfg.format.d / 2 + 0.6;
    this.colH = this.colTop - (y - 0.7);
    // the column scrolls once it outgrows the view; otherwise it sits centred
    const fits = this.colH <= this.viewH;
    document.getElementById('spacer')!.style.height = fits ? '100vh' : `${(this.colH / this.viewH) * 100}vh`;
    this.focus.set(0, fits ? this.colTop - this.colH / 2 : this.colTop - this.viewH / 2, 0);
    void last;
  }

  /** Follow the page scroll down the column. */
  private followScroll() {
    if (this.colH <= this.viewH) return;
    this.focus.y = this.colTop - this.viewH / 2 - (scrollY / innerHeight) * this.viewH;
  }

  /** The book under the pointer, if any. */
  private pick(): ShelfBook | null {
    this.raycaster.setFromCamera(this.pointer, this.scene.camera);
    const h = this.raycaster.intersectObjects(this.books.flatMap(b => b.meshes), false)[0];
    return h ? (h.object.userData.book as ShelfBook) : null;
  }

  /** Per-frame: hover, pose, labels. Returns true if a book is under the pointer. */
  update(dt: number, hasPointer: boolean) {
    const cam = this.scene.camera;
    let hit: ShelfBook | null = this.labelHover;
    if (!hit && hasPointer && !this.opening) hit = this.pick();
    if (this.opening) hit = null;
    this.hovered = hit;
    if (!this.opening) this.followScroll();
    const k = 1 - Math.pow(0.002, dt);
    for (const b of this.books) {
      const want = b === hit ? 1 : 0;
      b.hover += (want - b.hover) * k * (reduceMotion ? 8 : 1);
      if (b !== this.opening) b.pose(0, this.focus);
      b.label.classList.toggle('hover', b === hit);
      // label to the right of the book, projected to the screen
      const p = new THREE.Vector3(b.cfg.format.h / 2 + 0.3, b.slot.y, b.slot.z + b.cfg.format.w / 2 + b.hover * PULL).applyMatrix4(this.group.matrixWorld).project(cam);
      b.label.style.transform = `translate(${((p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(0, -50%)`;
      b.label.style.opacity = this.opening ? '0' : '';
    }
    const m = this.moreSlot.clone().applyMatrix4(this.group.matrixWorld).project(cam);
    this.more.style.transform = `translate(${((m.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-m.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%, -50%)`;
    this.more.style.opacity = this.opening ? '0' : '';
    return !!hit;
  }

  /** Where the camera should sit for the shelf, before pointer parallax. */
  cameraTarget(out: THREE.Vector3, openT = 0) {
    const k = ease(span(openT, 0, 0.7));
    const dolly = THREE.MathUtils.lerp(this.camDist, OPEN_Z + 7.4, k);
    return out.set(this.focus.x, this.focus.y, dolly);
  }

  /** Drive the open (or close) pose of a book; the caller animates t from 0 to 1. */
  setOpen(cfg: BookConfig, t: number) {
    const b = this.books.find(x => x.cfg.id === cfg.id)!;
    this.opening = t > 0 ? b : null;
    b.hover = 0; b.pose(t, this.focus);
    return b;
  }

  /** Animate a book from its shelf pose to open (dir 1) or back (dir -1). Resolves when done. */
  animateOpen(cfg: BookConfig, dir: 1 | -1, seconds = 1.6): Promise<void> {
    return new Promise((res) => {
      if (reduceMotion) { this.setOpen(cfg, dir > 0 ? 1 : 0); this.openT = dir > 0 ? 1 : 0; res(); return; }
      const t0 = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / (seconds * 1000));
        const t = dir > 0 ? u : 1 - u;
        this.openT = t; this.setOpen(cfg, t);
        if (u < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }
  openT = 0;

  dispose() {
    this.ac.abort();
    for (const b of this.books) b.dispose();
    this.group.removeFromParent();
    document.getElementById('spacer')!.style.height = '0px';
    this.scene.scene.environment = null; this.pmrem.dispose();
    const L = this.lightBefore, sc = this.scene;
    sc.sunOffset.copy(L.offset); sc.sun.shadow.radius = L.radius; sc.sun.shadow.blurSamples = L.samples; sc.sun.intensity = L.sun; sc.ambient.intensity = L.ambient;
    this.labels.innerHTML = '';
    document.body.classList.remove('shelf');
  }
}
