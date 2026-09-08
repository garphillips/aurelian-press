import * as THREE from 'three';
import type { PlateManifest } from './types';
import { Specimen } from './specimen';
import { speciesFor } from './content';

/** World height of one printed page. Plates are stacked with PLATE_GAP between them. */
export const PLATE_H = 3.0;
export const PLATE_GAP = 0.6;
export const PITCH = PLATE_H + PLATE_GAP;

/**
 * A plate is a page of the book: its specimens placed where they were printed.
 * Sideways-printed specimens stand upright at the same spot on the page.
 */
export class Plate {
  group = new THREE.Group();
  specimens: Specimen[] = [];
  readonly scale: number;

  constructor(public m: PlateManifest, public index: number, public root: string, hide: Set<string> = new Set()) {
    const [pw, ph] = m.canvas;
    this.scale = PLATE_H / ph;
    this.group.position.y = -index * PITCH;
    const base = `${root}/plates/${m.plateKey}`;
    for (const sm of m.specimens) {
      if (!sm.parts.body && !sm.parts['wing-L']) continue;
      if (sm.role && hide.has(sm.role)) continue;
      if (speciesFor(root, sm.id).hidden) continue;      // cut badly; left off the page until re-cut
      const sp = new Specimen(sm, base, this.scale);
      const [x0, y0, x1, y1] = sm.plateBox;
      sp.group.position.set(((x0 + x1) / 2 - pw / 2) * this.scale, -((y0 + y1) / 2 - ph / 2) * this.scale, 0);
      this.group.add(sp.group);
      this.specimens.push(sp);
    }
  }

  dispose() {
    for (const s of this.specimens) s.dispose();
    this.group.removeFromParent();
  }
}

const cache = new Map<string, Promise<PlateManifest>>();
export function loadManifest(root: string, plateKey: string): Promise<PlateManifest> {
  const key = `${root}/${plateKey}`;
  let p = cache.get(key);
  if (!p) { p = fetch(`${root}/plates/${plateKey}/manifest.json`).then(r => r.json()); cache.set(key, p); }
  return p;
}
