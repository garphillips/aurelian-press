import * as THREE from 'three';
import { Scene, FOV } from './scene';
import { loadBooks, bookForPath, type BookConfig } from './books';
import { startBook, type BookSession } from './book';
import { Shelf } from './shelf';
import { preloadCovers } from './bindings';

/**
 * Front door. "/" is the shelf; each book has a route ("/lucas/") that opens straight
 * into the reading experience. Opening a book from the shelf lifts it, opens the cover and
 * fades through paper into the plates; closing reverses the move.
 */
document.body.classList.add('js');
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const scene = new Scene(canvas);
(window as any).__scene = scene;   // for inspection in the browser
const books = await loadBooks();
await Promise.all([document.fonts.load('20px "IM Fell English"'), document.fonts.load('20px "EB Garamond"')]).catch(() => {});

const mastSub = document.getElementById('mastSub')!;
const curtainEl = document.getElementById('curtain')!;
const SITE = 'The Aurelian Press';

/** Paper-coloured curtain between the two scenes. Resolves once the fade is done. */
function curtain(up: boolean): Promise<void> {
  return new Promise((res) => {
    if (curtainEl.classList.contains('up') === up) return res();
    curtainEl.classList.toggle('up', up);
    setTimeout(res, matchMedia('(prefers-reduced-motion: reduce)').matches ? 30 : 560);
  });
}

// pointer, shared by the shelf loop for parallax
const pointer = new THREE.Vector2(0, 0); let hasPointer = false;
addEventListener('pointermove', (e) => { hasPointer = true; pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
addEventListener('pointerleave', () => { hasPointer = false; });

let session: BookSession | null = null; let current: BookConfig | null = null;
let shelf: Shelf | null = null;
let shelfRaf = 0; let busy = false;

/* ---------------- the shelf ---------------- */
function runShelf() {
  const clock = new THREE.Clock();
  const camTarget = new THREE.Vector3(), look = new THREE.Vector3();
  const frame = () => {
    if (!shelf) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const hovering = shelf.update(dt, hasPointer);
    const px = hasPointer ? pointer.x : 0, py = hasPointer ? pointer.y : 0;
    const settle = 1 - shelf.openT;
    shelf.cameraTarget(camTarget, shelf.openT); camTarget.x += px * 0.35 * settle; camTarget.y += py * 0.22 * settle;
    scene.camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt));
    look.copy(shelf.focus); look.x += px * 0.1 * settle; look.y += py * 0.06 * settle;
    scene.camera.lookAt(look);
    scene.follow(shelf.focus);
    canvas.style.cursor = hovering ? 'pointer' : 'default';
    scene.render();
    shelfRaf = requestAnimationFrame(frame);
  };
  frame();
}

async function showShelf(closing?: BookConfig) {
  document.title = SITE;
  mastSub.textContent = 'Antique books of butterflies and moths, brought to life';
  await preloadCovers(books);
  shelf = new Shelf(scene, books, (b) => openBook(b, true));
  scene.camera.fov = FOV; scene.camera.updateProjectionMatrix();
  if (closing) {
    // the book is still open before the viewer; settle the camera there, then close it
    shelf.setOpen(closing, 1); shelf.openT = 1;
    shelf.cameraTarget(scene.camera.position, 1); scene.camera.lookAt(shelf.focus);
    runShelf();
    await curtain(false);
    await shelf.animateOpen(closing, -1, 1.5);
  } else {
    shelf.cameraTarget(scene.camera.position, 0); scene.camera.lookAt(shelf.focus);
    runShelf();
    await curtain(false);
  }
}
function hideShelf() { cancelAnimationFrame(shelfRaf); shelf?.dispose(); shelf = null; }

/* ---------------- transitions ---------------- */
/** A book that is not yet cut: lift it, open to the frontispiece, linger, and put it back. */
async function previewBook(b: BookConfig) {
  if (busy || session || !shelf) return; busy = true;
  await shelf.animateOpen(b, 1, 1.7);
  await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 800 : 2600));
  if (shelf) await shelf.animateOpen(b, -1, 1.5);
  busy = false;
}

async function openBook(b: BookConfig, push: boolean) {
  if (b.status !== 'ready') return previewBook(b);
  if (busy || session) return; busy = true;
  if (push) history.pushState(null, '', b.route);
  document.title = `${b.shortTitle} · ${SITE}`;
  if (shelf) {
    await shelf.animateOpen(b, 1, 1.7);
    // linger on the frontispiece before the pages take over
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(r => setTimeout(r, 1600));
  }
  await curtain(true);
  hideShelf();
  session = await startBook(scene, b, () => closeBook(b, true)); current = b;
  busy = false;
  await curtain(false);
}
async function closeBook(b: BookConfig, push: boolean) {
  if (busy || !session) return; busy = true;
  await curtain(true);
  session.stop(); session = null; current = null;
  if (push) history.pushState(null, '', '/');
  await showShelf(b);
  busy = false;
}

/* ---------------- routing ---------------- */
function routed(): BookConfig | undefined { return bookForPath(books, location.pathname); }
addEventListener('popstate', () => {
  const b = routed();
  if (b && b.status === 'ready' && !session) openBook(b, false);
  else if (!b && current) closeBook(current, false);
});

{
  const b = routed();
  if (b && b.status === 'ready') {
    document.title = `${b.shortTitle} · ${SITE}`;
    session = await startBook(scene, b, () => closeBook(b, true)); current = b;
    await curtain(false);
  } else {
    if (location.pathname !== '/') history.replaceState(null, '', '/');
    await showShelf();
  }
}
