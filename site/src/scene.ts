import * as THREE from 'three';

export const CAM_DIST = 8.4;
export const FOV = 22;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Procedural aged paper. A scanned sheet can replace this later. */
export function drawPaper(): HTMLCanvasElement {
  const P = 2048;
  const c = document.createElement('canvas'); c.width = c.height = P;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece3ca'; g.fillRect(0, 0, P, P);
  const img = g.getImageData(0, 0, P, P), d = img.data, r = rng(7);
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 22; d[i] += n; d[i + 1] += n * 0.95; d[i + 2] += n * 0.8; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(120,95,60,0.10)'; g.lineWidth = 1;
  for (let i = 0; i < 2600; i++) { const x = r() * P, y = r() * P, a = r() * 6.28, l = 6 + r() * 26; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 26; i++) { const x = r() * P, y = r() * P, rad = 20 + r() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(150,110,60,${0.05 + r() * 0.08})`); gr.addColorStop(1, 'rgba(150,110,60,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.28); g.fill(); }
  const gr = g.createLinearGradient(0, 0, P, P); gr.addColorStop(0, 'rgba(255,250,235,0.18)'); gr.addColorStop(1, 'rgba(120,90,50,0.10)'); g.fillStyle = gr; g.fillRect(0, 0, P, P);
  return c;
}

export class Scene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  sun: THREE.DirectionalLight;
  paper: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0, CAM_DIST);

    const paperTex = new THREE.CanvasTexture(drawPaper());
    paperTex.colorSpace = THREE.SRGBColorSpace;
    paperTex.wrapS = paperTex.wrapT = THREE.MirroredRepeatWrapping;
    paperTex.repeat.set(6, 6);
    paperTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ map: paperTex }));
    this.paper.receiveShadow = true;
    this.scene.add(this.paper);

    this.scene.add(new THREE.AmbientLight(0xfff6e6, 1.85));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.25);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 20;
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -3.6; sc.right = sc.top = 3.6;
    this.sun.shadow.radius = 9; this.sun.shadow.blurSamples = 16; this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun); this.scene.add(this.sun.target);

    addEventListener('resize', () => this.resize()); this.resize();
  }

  /** Keep the light (and its shadow frustum) centred on what the camera looks at. */
  follow(focus: THREE.Vector3) {
    this.sun.position.set(focus.x - 1.8, focus.y + 2.6, 6.5);
    this.sun.target.position.copy(focus); this.sun.target.updateMatrixWorld();
    this.paper.position.y = focus.y;      // the paper is a window that travels with the camera
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Visible world height at the paper plane. */
  get viewHeight() { return 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)); }
  get viewWidth() { return this.viewHeight * this.camera.aspect; }

  render() { this.renderer.render(this.scene, this.camera); }
}
