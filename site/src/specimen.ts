import * as THREE from 'three';
import type { PartRef, SpecimenManifest } from './types';
import { inject, makeWingUniforms, type WingUniforms } from './shaders';

export const tune = { amp: 0.38, freq: 1.1, lag: 0.85, rest: 0.14, breath: 0.05 };
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const loader = new THREE.TextureLoader();
const wingGeo = new THREE.PlaneGeometry(1, 1, 40, 40); wingGeo.translate(0.5, 0, 0);   // root at x = 0

function loadTex(url: string, srgb: boolean) {
  const t = loader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/**
 * One specimen: a body plane plus hinged wing planes, built from the cutter's manifest.
 * `scale` converts upright-specimen pixels to world units. The group origin is the
 * specimen's centre; the caller positions the group on the plate.
 */
export class Specimen {
  group = new THREE.Group();
  hit: THREE.Mesh;
  span: number;                // world width
  private body!: THREE.Mesh;
  private bodyTwin?: THREE.Mesh;
  private uniforms: Record<string, WingUniforms> = {};
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  // motion state
  phase = Math.random() * 6.28; energy = 0; burst = 0; nextBurst = 3 + Math.random() * 8;
  lift = 0; amp = 0.04; freq = 0.6; pinned = false;
  private baseFreq: number;

  constructor(public m: SpecimenManifest, base: string, public scale: number) {
    const [x0, y0, x1, y1] = m.bbox;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.span = (x1 - x0) * scale;
    // bigger specimens beat slower
    this.baseFreq = THREE.MathUtils.clamp(0.9 - this.span * 0.18, 0.35, 0.9);

    const place = (mesh: THREE.Mesh, part: PartRef, hingeX: number | null, side: number, z: number) => {
      const bcx = (part.bbox[0] + part.bbox[2]) / 2, bcy = (part.bbox[1] + part.bbox[3]) / 2;
      if (hingeX !== null) {
        mesh.scale.set(side * part.w * scale, part.h * scale, 1);
        mesh.position.set((hingeX - cx) * scale, -(bcy - cy) * scale, z);
      } else {
        mesh.position.set((bcx - cx) * scale, -(bcy - cy) * scale, z);
      }
      this.group.add(mesh);
    };

    const materials = (id: string, wing: WingUniforms | null) => {
      const map = loadTex(`${base}/${id}.webp`, false), alpha = loadTex(`${base}/${id}_a.webp`, false);   // map is a raw ratio, decoded in the shader
      this.textures.push(map, alpha);
      const mat = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      mat.alphaTest = 0.5; inject(mat, wing, 0);
      const add = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      add.alphaTest = 0.5; inject(add, wing, 1);
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      if (wing) inject(dm, wing);
      this.materials.push(mat, add, dm);
      return { mat, add, dm };
    };
    // the additive twin sits a hair above its multiply mesh and casts no shadow of its own
    const twin = (mesh: THREE.Mesh, add: THREE.Material) => {
      const t = new THREE.Mesh(mesh.geometry, add);
      t.position.copy(mesh.position); t.position.z += 0.0005; t.scale.copy(mesh.scale); t.renderOrder = mesh.renderOrder + 10;
      this.group.add(t); return t;
    };

    const wingNames = m.parts['fore-L'] ? ['hind-L', 'hind-R', 'fore-L', 'fore-R'] : ['wing-L', 'wing-R'];
    for (const name of wingNames) {
      const part = (m.parts as any)[name] as PartRef | null; if (!part) continue;
      const side = name.endsWith('R') ? 1 : -1;
      const kind = name.startsWith('hind') ? 'hind' : 'fore';
      const u = (this.uniforms[kind] ??= makeWingUniforms());
      const { mat, add, dm } = materials(`${m.id}_${name}`, u);
      const mesh = new THREE.Mesh(wingGeo, mat);
      mesh.customDepthMaterial = dm; mesh.castShadow = true;
      mesh.renderOrder = kind === 'fore' ? 2 : 1;
      place(mesh, part, m.axis + side * m.bodyHalf, side, kind === 'fore' ? 0.006 : 0.002);
      twin(mesh, add);
    }
    if (m.parts.body) {
      const { mat, add, dm } = materials(`${m.id}_body`, null);
      this.body = new THREE.Mesh(new THREE.PlaneGeometry(m.parts.body.w * scale, m.parts.body.h * scale), mat);
      this.body.customDepthMaterial = dm; this.body.castShadow = true; this.body.renderOrder = 3;
      place(this.body, m.parts.body, null, 1, 0.012);
      this.bodyTwin = twin(this.body, add);
    }
    this.hit = new THREE.Mesh(new THREE.PlaneGeometry(this.span * 1.02, (y1 - y0) * scale * 1.02), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.specimen = this;
    this.group.add(this.hit);
  }

  /** World-space centre. */
  centre(target: THREE.Vector3) { return this.group.getWorldPosition(target); }

  /** Per-frame motion. `pointer` is the cursor in world space (or null), `speed` its recent velocity 0..1. */
  update(dt: number, t: number, pointer: THREE.Vector3 | null, speed: number, tmp: THREE.Vector3) {
    if (pointer && !reduceMotion) {
      const d = tmp.copy(pointer).sub(this.centre(tmp.clone())).length() / (this.span * 0.6);
      if (d < 1) this.energy = Math.min(1, this.energy + dt * (0.35 + 0.6 * speed) * (1 - d));
    }
    this.nextBurst -= dt;
    if (this.nextBurst < 0 && !reduceMotion) { this.burst = 1.2 + Math.random() * 1.5; this.nextBurst = 6 + Math.random() * 10; }
    if (this.burst > 0) { this.burst -= dt; this.energy = Math.min(0.6, this.energy + dt * 0.3); }
    this.energy *= Math.pow(0.55, dt);
    if (this.pinned) this.energy *= Math.pow(0.02, dt);

    const breathing = reduceMotion ? 0 : tune.breath;
    const targetAmp = this.pinned ? 0 : breathing + this.energy * tune.amp;
    const targetFreq = this.pinned ? 0.25 : this.baseFreq * 0.6 + this.energy * tune.freq;
    this.amp += (targetAmp - this.amp) * (1 - Math.pow(0.08, dt));
    this.freq += (targetFreq - this.freq) * (1 - Math.pow(0.15, dt));
    this.phase += 6.2831 * this.freq * dt;
    this.lift += ((this.pinned ? 0 : this.energy * 0.3) - this.lift) * (1 - Math.pow(0.08, dt));
    const rest = this.pinned ? 0.03 : tune.rest + 0.04 * Math.sin(t * 0.7 + this.phase * 0.01);

    for (const [kind, u] of Object.entries(this.uniforms)) {
      u.uAmp.value = this.amp; u.uRest.value = rest; u.uLag.value = tune.lag;
      u.uPhase.value = this.phase - (kind === 'hind' ? 0.35 : 0);
    }
    this.group.position.z = this.lift;
    if (this.body) { this.body.position.z = 0.012 + Math.max(0, -Math.sin(this.phase)) * 0.02 * this.amp; if (this.bodyTwin) this.bodyTwin.position.z = this.body.position.z + 0.0005; }
  }

  /** Whether the cursor is within hover range (for the pointer cursor). */
  hovered(pointer: THREE.Vector3, tmp: THREE.Vector3) {
    return tmp.copy(pointer).sub(this.centre(tmp.clone())).length() < this.span * 0.5;
  }

  dispose() {
    this.textures.forEach(t => t.dispose());
    this.materials.forEach(m => m.dispose());
    (this.hit.material as THREE.Material).dispose(); this.hit.geometry.dispose();
    this.body?.geometry.dispose();
  }
}
