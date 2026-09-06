import * as THREE from 'three';
import type { BookConfig } from './books';

/**
 * Procedural bindings for the books on the shelf: cloth boards, gilt-stamped spines,
 * a cream page block. Each face is drawn twice on canvas — once for colour, once for
 * roughness/metalness (green = roughness, blue = metalness) so the gilt catches the light.
 * Real cover photographs (Morris) and a designed Lucas cover will replace these.
 */

export const PX = 420;            // canvas pixels per world unit
export const BOARD = 0.045;       // board thickness
export const SQUARE = 0.05;       // the boards overhang the page block by this much

const FELL = '"IM Fell English", "EB Garamond", Georgia, serif';

/** Cover photographs are fetched before the shelf is built so every face can be drawn at once. */
const images = new Map<string, HTMLImageElement>();
export function preloadCovers(cfgs: BookConfig[]): Promise<void> {
  const urls = cfgs.flatMap(c => [c.cover?.front, c.cover?.frontMr, c.cover?.grain]).filter((u): u is string => !!u);
  const fonts = cfgs.map(c => c.spineFont).filter((f): f is string => !!f).map(f => document.fonts.load(`20px "${f}"`).catch(() => []));
  return Promise.all<unknown>([...fonts, ...urls.map(u => new Promise<void>((res) => {
    if (images.has(u)) return res();
    const img = new Image(); img.onload = () => { images.set(u, img); res(); }; img.onerror = () => res(); img.src = u;
  }))]).then(() => {});
}
const image = (u?: string) => (u ? images.get(u) : undefined);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h)); return c; };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k].map(v => Math.max(0, Math.min(255, Math.round(v)))) as any;

/** Woven cloth: base colour with a fine crosshatch and slow mottling, on a canvas of the given size. */
export function cloth(g: CanvasRenderingContext2D, colour: string, seed = 3) {
  const { width: W, height: H } = g.canvas, c = hexToRgb(colour), r = rng(seed);
  g.fillStyle = colour; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const weave = ((x % 3 === 0) ? 1 : 0) * 5 + ((y % 3 === 1) ? 1 : 0) * 5;
    const n = (r() - 0.5) * 14 + weave - 5;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // mottled wear
  for (let i = 0; i < 12; i++) {
    const x = r() * W, y = r() * H, rad = (0.15 + r() * 0.4) * Math.max(W, H);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rgba(shade(c, r() < 0.5 ? 0.8 : 1.15), 0.18)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  // edges darker where hands have been
  const e = g.createLinearGradient(0, 0, 0, H); e.addColorStop(0, 'rgba(0,0,0,0.16)'); e.addColorStop(0.08, 'rgba(0,0,0,0)'); e.addColorStop(0.92, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
}

/** Gilt lettering with a hint of emboss: dark offset beneath, bright face on top. */
const MR_GILT = 'rgb(0,70,230)', MR_CLOTH = 'rgb(0,225,0)';
let inverted = false;   // while drawing an inverted spine: lettering is dark and matte on a gold ground
function giltText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, gilt: string, mr: boolean, maxW: number, font = FELL) {
  g.font = `${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  let w = g.measureText(text).width;
  if (w > maxW) { size *= maxW / w; g.font = `${size}px ${font}`; }
  if (mr) { g.fillStyle = inverted ? MR_CLOTH : MR_GILT; g.fillText(text, x, y); return size; }
  if (inverted) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillText(text, x + size * 0.015, y + size * 0.02); g.fillStyle = gilt; g.fillText(text, x, y); return size; }
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(text, x + size * 0.03, y + size * 0.04);
  g.fillStyle = gilt; g.fillText(text, x, y);
  g.fillStyle = 'rgba(255,245,210,0.35)'; g.fillText(text, x - size * 0.015, y - size * 0.02);
  return size;
}
function giltRule(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, thick: number, gilt: string, mr: boolean) {
  g.fillStyle = mr ? (inverted ? MR_CLOTH : MR_GILT) : gilt; g.fillRect(x0, y - thick / 2, x1 - x0, thick);
  if (!mr && !inverted) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0, y + thick / 2, x1 - x0, Math.max(1, thick * 0.6)); }
}
/** A roughness/metalness canvas base: cloth is rough and not metallic. */
function mrBase(g: CanvasRenderingContext2D) { g.fillStyle = 'rgb(0,225,0)'; g.fillRect(0, 0, g.canvas.width, g.canvas.height); }

/** Base of a spine or edge: the binding's own grain tiled, else procedural cloth. */
function binding(g: CanvasRenderingContext2D, cfg: BookConfig, seed: number) {
  const grain = image(cfg.cover?.grain);
  if (grain) {
    const pat = g.createPattern(grain, 'repeat')!;
    const t = new DOMMatrix().scale((0.32 * PX) / grain.width);   // a tile is about a third of a world unit
    pat.setTransform(t); g.fillStyle = pat; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    const e = g.createLinearGradient(0, 0, 0, g.canvas.height); e.addColorStop(0, 'rgba(0,0,0,0.25)'); e.addColorStop(0.06, 'rgba(0,0,0,0)'); e.addColorStop(0.94, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = e; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  } else cloth(g, cfg.cloth, seed);
}

/** Split a long title into two balanced lines at a space. */
function balance(title: string): string[] {
  if (title.length <= 28) return [title];
  const words = title.split(' '); let best = [title], diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const d = Math.abs(a.length - b.length); if (d < diff) { diff = d; best = [a, b]; }
  }
  return best;
}

/** The spine: the title in gilt running along its length, the year at the foot. */
export function spine(cfg: BookConfig, mr: boolean): HTMLCanvasElement {
  const { d, h } = cfg.format, W = d * PX, H = h * PX, c = canvas(W, H), g = c.getContext('2d')!;
  if (mr) mrBase(g); else binding(g, cfg, cfg.volume ?? 1);
  if (cfg.spine && !cfg.spineTitle) return spinePanels(cfg, g, W, H, mr);
  inverted = !!cfg.spineInverted;
  let gilt = cfg.gilt;
  if (inverted) {
    // gold laid over the whole spine, the grain showing through; lettering in the binding's own colour
    if (mr) { g.fillStyle = 'rgb(0,120,110)'; g.fillRect(0, 0, W, H); }      // half-metallic: gold leaf that still shows in diffuse light
    else { g.fillStyle = '#e2c27a'; g.globalAlpha = 0.9; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
           const e = g.createLinearGradient(0, 0, W, 0); e.addColorStop(0, 'rgba(0,0,0,0.18)'); e.addColorStop(0.5, 'rgba(255,250,230,0.10)'); e.addColorStop(1, 'rgba(0,0,0,0.22)'); g.fillStyle = e; g.fillRect(0, 0, W, H); }
    gilt = cfg.cloth;
  }
  const pad = W * 0.16, head = H * 0.07, foot = H * 0.9;
  giltRule(g, pad, W - pad, head, 3, gilt, mr); giltRule(g, pad, W - pad, head + 9, 1.5, gilt, mr);
  giltRule(g, pad, W - pad, foot, 3, gilt, mr); giltRule(g, pad, W - pad, foot - 9, 1.5, gilt, mr);
  // title, reading top to bottom, one or two lines across the width of the spine
  const lines = balance(cfg.spineTitle ?? cfg.title), n = lines.length;
  const font = cfg.spineFont ? `"${cfg.spineFont}", ${FELL}` : FELL;
  const length = foot - head - H * 0.08, across = W - pad * 1.2;
  // a single line sits at about a quarter of the spine's width; two lines share it
  const size = n === 1 ? W * 0.17 : Math.min(across / n * 0.6, W * 0.3);
  g.save(); g.translate(W / 2, (head + foot) / 2 - H * 0.02); g.rotate(Math.PI / 2);
  const lh = across / n;
  lines.forEach((t, i) => giltText(g, t, 0, (i - (n - 1) / 2) * lh * 0.9, size, gilt, mr, length, font));
  g.restore();
  // year, horizontal at the foot
  giltText(g, cfg.year.split('–')[0], W / 2, foot + (H - foot) / 2, Math.min(W * 0.17, (H - foot) * 0.5), gilt, mr, W - pad, font);
  inverted = false;
  return c;
}

/** Older spine style: raised bands and stacked gilt panels. */
function spinePanels(cfg: BookConfig, g: CanvasRenderingContext2D, W: number, H: number, mr: boolean): HTMLCanvasElement {
  const panels = cfg.spine!, bandY = [0.1, 0.42, 0.62, 0.8, 0.92];
  for (const y of bandY.map(f => f * H)) {
    if (mr) { g.fillStyle = 'rgb(0,200,0)'; g.fillRect(0, y - 4, W, 8); continue; }
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, y - 5, W, 4);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y + 2, W, 4);
  }
  const pad = W * 0.13;
  const slots: [number, number][] = [[0.13, 0.40], [0.44, 0.60], [0.64, 0.78], [0.82, 0.91]];
  panels.slice(0, 4).forEach((lines, k) => {
    const [a, b] = slots[k], top = a * H, bot = b * H, mid = (top + bot) / 2;
    if (k === 0 || k === 2) { giltRule(g, pad, W - pad, top + 6, 3, cfg.gilt, mr); giltRule(g, pad, W - pad, bot - 6, 3, cfg.gilt, mr); }
    const size = Math.min(W * 0.21, (bot - top - 30) / Math.max(1, lines.length) * 0.78);
    const lh = size * 1.22, y0 = mid - (lines.length - 1) * lh / 2;
    lines.forEach((t, i) => giltText(g, t, W / 2, y0 + i * lh, size, cfg.gilt, mr, W - pad * 2));
  });
  return g.canvas;
}

/** A board: cloth with a blind-tooled border; a gilt title cartouche on books that are not part of a set. */
export function board(cfg: BookConfig, front: boolean, mr: boolean): HTMLCanvasElement {
  const { w, h } = cfg.format, W = w * PX, H = h * PX, c = canvas(W, H), g = c.getContext('2d')!;
  const photo = image(cfg.cover?.front);
  if (photo) {
    // the photograph is the board; its left edge is the spine side. The back board is its mirror.
    const src = mr ? image(cfg.cover?.frontMr) : photo;
    if (!src) { mrBase(g); return c; }
    g.save(); if (!front) { g.translate(W, 0); g.scale(-1, 1); }
    g.drawImage(src, 0, 0, W, H); g.restore();
    return c;
  }
  if (mr) mrBase(g); else cloth(g, cfg.cloth, (cfg.volume ?? 1) * 7 + (front ? 1 : 2));
  const m = W * 0.06;
  // blind rules: pressed into the cloth, so darker with a light edge
  const rule = (inset: number, thick: number) => {
    if (mr) { g.strokeStyle = 'rgb(0,240,0)'; g.lineWidth = thick; g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset); return; }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = thick; g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
    g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1; g.strokeRect(inset + thick, inset + thick, W - 2 * inset - 2 * thick, H - 2 * inset - 2 * thick);
  };
  rule(m, 3); rule(m * 1.5, 1.5);
  if (front && !cfg.series) {
    // gilt cartouche: title, author, place and year
    const cx = W / 2, top = H * 0.30;
    giltRule(g, W * 0.28, W * 0.72, top, 3, cfg.gilt, mr);
    const words = cfg.title.toUpperCase().split(' ');
    const lines: string[] = []; let cur = '';
    for (const wd of words) { if ((cur + ' ' + wd).trim().length > 16 && cur) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim(); }
    if (cur) lines.push(cur);
    const size = W * 0.075, lh = size * 1.3; let y = top + lh * 1.1;
    for (const l of lines) { giltText(g, l, cx, y, size, cfg.gilt, mr, W * 0.76); y += lh; }
    giltRule(g, W * 0.28, W * 0.72, y - lh * 0.35, 3, cfg.gilt, mr);
    giltText(g, cfg.author.toUpperCase(), cx, y + lh * 0.6, size * 0.8, cfg.gilt, mr, W * 0.6);
    giltText(g, `${cfg.place.toUpperCase()} · ${cfg.year.split('–')[0]}`, cx, H * 0.86, size * 0.62, cfg.gilt, mr, W * 0.6);
  }
  if (front && cfg.series && cfg.volume) {
    // a set: a single gilt volume numeral low on the board
    giltText(g, ['', 'I', 'II', 'III', 'IV'][cfg.volume] ?? '', W / 2, H * 0.5, W * 0.16, cfg.gilt, mr, W * 0.5);
  }
  return c;
}

/** The narrow edges of a board: the binding's grain. */
export function edge(cfg: BookConfig): HTMLCanvasElement {
  const c = canvas(0.6 * PX, 0.6 * PX), g = c.getContext('2d')!; binding(g, cfg, 9); return c;
}

/** Page block edges: cream with fine leaf lines, a little foxing. */
export function pages(long: number, thick: number, seed = 11): HTMLCanvasElement {
  const W = long * PX, H = Math.max(thick * PX, 8), c = canvas(W, H), g = c.getContext('2d')!, r = rng(seed);
  g.fillStyle = '#e4d9bd'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 1.6) { g.fillStyle = `rgba(90,70,40,${0.04 + r() * 0.1})`; g.fillRect(0, y, W, 0.8); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(150,110,60,${0.05 + r() * 0.1})`; g.beginPath(); g.arc(r() * W, r() * H, 1 + r() * 5, 0, 6.28); g.fill(); }
  const e = g.createLinearGradient(0, 0, W, 0); e.addColorStop(0, 'rgba(0,0,0,0.18)'); e.addColorStop(0.05, 'rgba(0,0,0,0)'); e.addColorStop(0.95, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
  return c;
}

/** The first leaf: a frontispiece portrait of the author on cream paper, name and dates beneath. */
export function firstLeaf(cfg: BookConfig, faceW: number, faceH: number, onLoad: () => void): HTMLCanvasElement {
  const W = faceW * PX, H = faceH * PX, c = canvas(W, H), g = c.getContext('2d')!, r = rng(23);
  g.fillStyle = '#e9dfc6'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(150,110,60,${0.03 + r() * 0.06})`; g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 8, 0, 6.28); g.fill(); }
  const p = cfg.portrait; if (!p) return c;
  const img = new Image(); img.src = p.image;
  img.onload = () => {
    // the plate sits a little above centre, about three-fifths of the page wide
    const pw = W * 0.6, ph = Math.min(H * 0.6, pw * img.height / img.width), s = Math.min(pw / img.width, ph / img.height);
    const iw = img.width * s, ih = img.height * s, x = (W - iw) / 2, y = H * 0.14;
    g.fillStyle = 'rgba(60,40,20,0.10)'; g.fillRect(x - 6, y + 4, iw + 12, ih + 12);        // faint plate-mark
    g.drawImage(img, x, y, iw, ih);
    g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 2; g.strokeRect(x - 10, y - 10, iw + 20, ih + 20);
    g.fillStyle = 'rgba(120,90,50,0.06)'; g.fillRect(x, y, iw, ih);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#2a2018';
    const size = W * 0.062; g.font = `${size}px ${FELL}`;
    g.fillText(p.caption, W / 2, y + ih + size * 2.0);
    if (p.dates) { g.font = `italic ${size * 0.72}px ${FELL}`; g.fillStyle = '#5a4a38'; g.fillText(p.dates, W / 2, y + ih + size * 3.0); }
    onLoad();
  };
  return c;
}

/** Paste-down inside a board: plain cream, a little darker toward the hinge. */
export function pasteDown(cfg: BookConfig): HTMLCanvasElement {
  const { w, h } = cfg.format, W = w * PX * 0.5, H = h * PX * 0.5, c = canvas(W, H), g = c.getContext('2d')!;
  g.fillStyle = '#e6dcc2'; g.fillRect(0, 0, W, H);
  const e = g.createLinearGradient(0, 0, W, 0); e.addColorStop(0, 'rgba(90,70,40,0.25)'); e.addColorStop(0.12, 'rgba(90,70,40,0)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
  return c;
}

/** Shelf plank: warm wood with grain. */
export function plank(long: number, deep: number): HTMLCanvasElement {
  const W = Math.min(2048, long * 260), H = Math.max(64, deep * 260), c = canvas(W, H), g = c.getContext('2d')!, r = rng(5);
  g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 140; i++) {
    const y = r() * H, amp = 2 + r() * 6, a = 0.06 + r() * 0.16, dark = r() < 0.6;
    g.strokeStyle = dark ? `rgba(40,22,8,${a})` : `rgba(180,140,90,${a * 0.6})`; g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 24) g.lineTo(x, y + Math.sin(x * 0.01 + i) * amp + (r() - 0.5) * 1.5);
    g.stroke();
  }
  const e = g.createLinearGradient(0, 0, 0, H); e.addColorStop(0, 'rgba(255,220,170,0.10)'); e.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = e; g.fillRect(0, 0, W, H);
  return c;
}

export function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; return t;
}
/** A cloth-and-gilt face material from its colour and roughness/metalness canvases. */
export function faceMaterial(colour: HTMLCanvasElement, mr?: HTMLCanvasElement) {
  const m = new THREE.MeshStandardMaterial({ map: tex(colour), roughness: 1, metalness: 1 });
  if (mr) { const t = tex(mr, false); m.roughnessMap = t; m.metalnessMap = t; }
  else { m.roughness = 0.92; m.metalness = 0; }
  return m;
}
