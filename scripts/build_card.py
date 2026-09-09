"""
Build the "I like to build stuff" card for garphillips.com: one of his project cards (eyebrow row, hairline rule,
heavy title, media well) with a live specimen fluttering in the media well, the whole card a link to the site.
Standalone page for now: his plum ground, his card geometry, Google Fonts stand-ins for his self-hosted faces
(Funnel Display for North East, Funnel Sans, JetBrains Mono for Wowmeta). The markup mirrors his card classes
so it can be dropped into the Astro component and pick up the real faces.
    python3 scripts/build_card.py lucas n134-1 aurelian-press-card
Writes site/public/embed/<slug>.html and, with SCRATCH set, <slug>.artifact.html in the scratchpad.
"""
import json, base64, os, sys, html as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
book, sid, slug = sys.argv[1], sys.argv[2], sys.argv[3]
key = sid.split('-')[0]
base = f'{ROOT}/site/public/books/{book}'
content = json.load(open(f'{base}/content/plates.json', encoding='utf-8'))
manifest = json.load(open(f'{base}/plates/{key}/manifest.json'))
sp = next(s for s in manifest['specimens'] if s['id'] == sid)
info = content['specimens'].get(sid, {}); plate = content['plates'][key]

def roman(n):
    out = ''
    for v, s in [(100, 'C'), (90, 'XC'), (50, 'L'), (40, 'XL'), (10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]:
        while n >= v: out += s; n -= v
    return out

parts = {}
for name, part in sp['parts'].items():
    if not part: continue
    p = dict(part)
    for k, suffix in (('rgb', ''), ('alpha', '_a')):
        p[k] = 'data:image/webp;base64,' + base64.b64encode(open(f'{base}/plates/{key}/{sid}_{name}{suffix}.webp', 'rb').read()).decode()
    parts[name] = p
spec = dict(id=sid, bbox=sp['bbox'], axis=sp['axis'], bodyHalf=sp['bodyHalf'], parts=parts)
name = info.get('name') or info.get('latin') or sid
latin = info.get('latin') or ''
numeral = roman(plate['order']); fig = sid.split('-')[1]

head = f'''<title>The Aurelian Press</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@700;800&family=Funnel+Sans:wght@400;500&family=JetBrains+Mono:wght@400&family=IM+Fell+English:ital@1&display=swap" rel="stylesheet">
<style>
  /* garphillips.com: plum ground, lilac ink. Card geometry as on the site; faces are Google stand-ins for his own. */
  :root{{
    --ground:#1c1217; --ink:#f2e2ff; --ink-64:rgba(242,226,255,.64); --ink-42:rgba(242,226,255,.42);
    --card:rgba(242,226,255,.03); --card-hover:rgba(242,226,255,.05); --rule:rgba(242,226,255,.14);
    --paper:#e8dec4;
    --display:"North East","Funnel Display",Georgia,sans-serif;
    --sans:"Funnel Sans",ui-sans-serif,system-ui,sans-serif;
    --mono:"Wowmeta","JetBrains Mono",ui-monospace,monospace;
    --fell:"IM Fell English",Georgia,serif;
  }}
  html,body{{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);}}
  body{{min-height:100vh;display:grid;place-items:center;padding:32px 16px;box-sizing:border-box;}}

  .card{{position:relative;display:flex;flex-direction:column;gap:16px;width:min(748px,100%);padding:24px;border-radius:24px;
    background:var(--card);color:inherit;text-decoration:none;transition:background .35s ease;}}
  .card:hover,.card:focus-visible{{background:var(--card-hover);outline:none;}}
  .card:focus-visible{{box-shadow:0 0 0 2px var(--ink-42);}}
  .card__meta{{display:flex;justify-content:space-between;gap:16px;}}
  .t-eyebrow{{margin:0;font-family:var(--mono);font-size:11px;line-height:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-64);}}
  .card__rule{{height:1px;background:var(--rule);margin:12px 0 18px;}}
  .card__title{{margin:0;font-family:var(--display);font-weight:800;font-size:clamp(30px,5.6vw,42px);line-height:.9;letter-spacing:-.03em;text-wrap:balance;}}
  .card__desc{{margin:14px 0 0;max-width:34em;font-size:16px;line-height:1.45;color:var(--ink-64);}}
  .card__media{{position:relative;height:clamp(300px,52vw,440px);border-radius:16px;overflow:hidden;background:
      radial-gradient(ellipse at 50% 60%, rgba(242,226,255,.06), rgba(242,226,255,0) 70%);}}
  .card__media canvas{{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;}}
  .card__plate{{position:absolute;left:18px;bottom:14px;margin:0;font-family:var(--fell);font-style:italic;font-size:13px;color:var(--ink-42);pointer-events:none;}}
  .card__foot{{display:flex;justify-content:space-between;align-items:baseline;gap:16px;}}
  .card__link{{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);}}
  .card__link::after{{content:" \\2197";}}
  @media (prefers-reduced-motion: reduce){{ .card{{transition:none;}} }}
</style>

<a class="card" href="https://aurelianpress.co.uk" target="_blank" rel="noopener">
  <div class="card__head">
    <div class="card__meta">
      <p class="t-eyebrow">Side project : Antique books, brought to life</p>
      <p class="t-eyebrow">2026</p>
    </div>
    <div class="card__rule"></div>
    <h3 class="card__title">The Aurelian Press</h3>
    <p class="card__desc">Three natural‑history books from 1835 to 1903, scanned plate by plate. Every hand‑coloured butterfly and moth is cut into layers and rigged to move; hover to startle this one.</p>
  </div>
  <div class="card__media">
    <canvas id="gl" aria-label="A hand-coloured engraving of {H.escape(name)}, its wings moving"></canvas>
    <p class="card__plate">{H.escape(name)} · <em>{H.escape(latin)}</em> · Lucas 1835, plate {numeral}, figure {fig}</p>
  </div>
  <div class="card__foot">
    <p class="t-eyebrow">Three.js · WebGL · a Python cutter</p>
    <span class="card__link">aurelianpress.co.uk</span>
  </div>
</a>
'''

script = r'''<script type="module">
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js';
const SPEC = __SPEC__;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('gl'), well = canvas.parentElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const FOV = 22, CAM_DIST = 8.4;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100); camera.position.set(0, 0, CAM_DIST);
// the ground is the card: only the shadow lands on it
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.35 })); ground.receiveShadow = true; scene.add(ground);
scene.add(new THREE.AmbientLight(0xfff6e6, 1.85));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 20; const sc = sun.shadow.camera; sc.left = sc.bottom = -3.6; sc.right = sc.top = 3.6;
sun.shadow.radius = 9; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0005; sun.position.set(-1.8, 2.6, 6.5); scene.add(sun); scene.add(sun.target);

/* the print as a cut-out of its own paper, hinged wings with a bend that lags toward the tip */
const inkUniform = { value: 0 };
const uniforms = { uPhase:{value:0}, uAmp:{value:0.04}, uRest:{value:0.14}, uLag:{value:0.85} };
const WING_UNIFORMS = `uniform float uPhase; uniform float uAmp; uniform float uRest; uniform float uLag;\nvoid main() {`;
const WING_VERT = `vec3 transformed = vec3(position);
  float u = clamp(position.x, 0.0, 1.0);
  float th = uRest + uAmp * sin(uPhase - uLag * pow(u, 1.5));
  transformed.x = position.x * cos(th);
  transformed.z = position.x * sin(th);`;
const INK_FRAG = `#include <map_fragment>
  { vec3 c = diffuseColor.rgb * 1.3;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(l) * vec3(1.0, 0.96, 0.90), uInk);
    vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2));
    diffuseColor.rgb = min(lin, vec3(1.08)) * pow(vec3(0.910, 0.871, 0.769), vec3(2.2)); }`;
function inject(mat, wing){
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = inkUniform;
    if (wing){ Object.assign(shader.uniforms, wing); shader.vertexShader = shader.vertexShader.replace('void main() {', WING_UNIFORMS).replace('#include <begin_vertex>', WING_VERT); }
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float uInk;\nvoid main() {').replace('#include <map_fragment>', INK_FRAG);
  };
  mat.customProgramCacheKey = () => wing ? 'wing' : 'body';
}
const loader = new THREE.TextureLoader();
const loadTex = (uri) => { const t = loader.load(uri); t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
const wingGeo = new THREE.PlaneGeometry(1, 1, 40, 40); wingGeo.translate(0.5, 0, 0);
const group = new THREE.Group(); scene.add(group);
const [x0, y0, x1, y1] = SPEC.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
const SPAN = 2.6, scale = SPAN / (x1 - x0);
function materials(part, wing){
  const map = loadTex(part.rgb), alpha = loadTex(part.alpha);
  const mat = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mat.alphaTest = 0.5; inject(mat, wing);
  const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }); if (wing) inject(dm, wing);
  return { mat, dm };
}
for (const nm of ['wing-L', 'wing-R']){
  const part = SPEC.parts[nm]; if (!part) continue;
  const side = nm.endsWith('R') ? 1 : -1, { mat, dm } = materials(part, uniforms);
  const mesh = new THREE.Mesh(wingGeo, mat); mesh.customDepthMaterial = dm; mesh.castShadow = true; mesh.renderOrder = 1;
  const bcy = (part.bbox[1] + part.bbox[3]) / 2, hinge = SPEC.axis + side * SPEC.bodyHalf;
  mesh.scale.set(side * part.w * scale, part.h * scale, 1); mesh.position.set((hinge - cx) * scale, -(bcy - cy) * scale, 0.002); group.add(mesh);
}
let body = null;
if (SPEC.parts.body){
  const part = SPEC.parts.body, { mat, dm } = materials(part, null);
  body = new THREE.Mesh(new THREE.PlaneGeometry(part.w * scale, part.h * scale), mat); body.customDepthMaterial = dm; body.castShadow = true; body.renderOrder = 3;
  body.position.set(((part.bbox[0] + part.bbox[2]) / 2 - cx) * scale, -((part.bbox[1] + part.bbox[3]) / 2 - cy) * scale, 0.012); group.add(body);
}

/* motion: calm breathing, a startle when the pointer comes near, a flutter of its own now and then */
const tune = { amp: 0.38, freq: 1.1, lag: 0.85, rest: 0.14, breath: 0.05 };
const S = { phase: Math.random() * 6.28, energy: 0, burst: 0, nextBurst: 2.5, lift: 0, amp: 0.04, freq: 0.6 };
const baseFreq = THREE.MathUtils.clamp(0.9 - SPAN * 0.18, 0.35, 0.9);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(-10, -10), pointerWorld = new THREE.Vector3(), plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let hasPointer = false, pointerSpeed = 0, lastPX = 0, lastPY = 0, inkTarget = 0, W = 1, Hh = 1;
well.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect(); hasPointer = true;
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  pointerSpeed = Math.min(1, Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / 40); lastPX = e.clientX; lastPY = e.clientY;
});
well.addEventListener('pointerleave', () => { hasPointer = false; });
function resize(){
  const r = well.getBoundingClientRect(); W = Math.max(1, r.width); Hh = Math.max(1, r.height);
  renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.updateProjectionMatrix();
  const viewW = 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect, viewH = viewW / camera.aspect;
  group.scale.setScalar(Math.min(1, (viewW * 0.78) / SPAN, (viewH * 0.72) / ((y1 - y0) * scale)));
}
new ResizeObserver(resize).observe(well); resize();

const clock = new THREE.Clock(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
let visible = true;
new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(well);
function frame(){
  requestAnimationFrame(frame);
  if (!visible) return;                                   // idle when scrolled away
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const px = hasPointer ? pointer.x : 0, py = hasPointer ? pointer.y : 0;
  camTarget.set(px * 0.18, py * 0.12, CAM_DIST); camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt)); camera.lookAt(px * 0.05, py * 0.03, 0);
  raycaster.setFromCamera(pointer, camera); raycaster.ray.intersectPlane(plane0, pointerWorld);
  if (hasPointer && !reduceMotion){ const d = tmp.copy(pointerWorld).length() / (SPAN * 0.6 * group.scale.x); if (d < 1) S.energy = Math.min(1, S.energy + dt * (0.35 + 0.6 * pointerSpeed) * (1 - d)); }
  S.nextBurst -= dt;
  if (S.nextBurst < 0 && !reduceMotion){ S.burst = 1.2 + Math.random() * 1.5; S.nextBurst = 6 + Math.random() * 10; }
  if (S.burst > 0){ S.burst -= dt; S.energy = Math.min(0.6, S.energy + dt * 0.3); }
  S.energy *= Math.pow(0.55, dt);
  const breathing = reduceMotion ? 0 : tune.breath;
  S.amp += ((breathing + S.energy * tune.amp) - S.amp) * (1 - Math.pow(0.08, dt));
  S.freq += ((baseFreq * 0.6 + S.energy * tune.freq) - S.freq) * (1 - Math.pow(0.15, dt));
  S.phase += 6.2831 * S.freq * dt;
  S.lift += ((S.energy * 0.3) - S.lift) * (1 - Math.pow(0.08, dt));
  uniforms.uAmp.value = S.amp; uniforms.uRest.value = tune.rest + 0.04 * Math.sin(t * 0.7 + S.phase * 0.01); uniforms.uLag.value = tune.lag; uniforms.uPhase.value = S.phase;
  group.position.z = S.lift;
  if (body) body.position.z = 0.012 + Math.max(0, -Math.sin(S.phase)) * 0.02 * S.amp;
  pointerSpeed *= Math.pow(0.001, dt);
  renderer.render(scene, camera);
}
frame();
</script>
'''.replace('__SPEC__', json.dumps(spec))

os.makedirs(f'{ROOT}/site/public/embed', exist_ok=True)
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
       + head.split('<a class="card"')[0] + '</head>\n<body>\n<a class="card"' + head.split('<a class="card"', 1)[1] + script + '</body>\n</html>\n')
out = f'{ROOT}/site/public/embed/{slug}.html'
open(out, 'w', encoding='utf-8').write(doc)
if os.environ.get('SCRATCH'):
    open(f"{os.environ['SCRATCH']}/{slug}.artifact.html", 'w', encoding='utf-8').write(head + script)
print(out, os.path.getsize(out) // 1024, 'KB', '|', name, latin, f'Plate {numeral} fig {fig}')
