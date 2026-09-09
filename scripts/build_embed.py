"""
Build a single-file, embeddable page of one specimen from the site's cut layers: the plate's paper, the same
hinged-wing rig and print shading the site uses, hover to startle, an occasional flutter of its own, click to see
the plate as engraved (ink only). Textures are inlined as data URIs; three.js comes from cdnjs.
    python3 scripts/build_embed.py lucas n132-3 imperial-jezebel
Writes site/public/embed/<slug>.html (a full document, hosted at aurelianpress.co.uk/embed/<slug>.html) and
<slug>.artifact.html beside it in the scratchpad when SCRATCH is set (the body only, for the Artifact tool).
Options on the page: ?caption=0 hides the caption, ?bg=transparent drops the paper and keeps only the shadow,
?bg=dark sets the specimen as a cut-out of its paper on a deep ink-brown ground, ?text=light gives a pale caption for a dark host. --dark / --transparent make one of
those the page's default. Off the paper (dark or transparent) the print is drawn as a cut-out of its own paper, since
the books' multiply shading needs paper beneath it.
"""
import json, base64, os, sys, html as H

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
book, sid, slug = sys.argv[1], sys.argv[2], sys.argv[3]
DEFAULT_BG = 'dark' if '--dark' in sys.argv else 'transparent' if '--transparent' in sys.argv else 'paper'   # what the page opens on unless ?bg= says otherwise
key = sid.split('-')[0]
base = f'{ROOT}/site/public/books/{book}'
content = json.load(open(f'{base}/content/plates.json', encoding='utf-8'))
manifest = json.load(open(f'{base}/plates/{key}/manifest.json'))
sp = next(s for s in manifest['specimens'] if s['id'] == sid)
info = content['specimens'].get(sid, {}); plate = content['plates'][key]
bookmeta = content['book']

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
title_short = bookmeta['title'].replace('Histoire naturelle des lépidoptères exotiques', 'Lépidoptères exotiques')
credit = f"{bookmeta['title']}, {bookmeta['years']}"
place_year = 'Paris 1835' if book == 'lucas' else bookmeta['years']

head = f'''<title>{H.escape(name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=EB+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>
  :root{{ --paper:#e8dec4; --ink:#211a13; --ink-soft:#4a3f33; --rule:#8a7a62;
         --serif:"IM Fell English","EB Garamond",Georgia,serif; --body:"EB Garamond",Georgia,serif; }}
  html,body{{margin:0;height:100%;background:var(--paper);color:var(--ink);font-family:var(--body);}}
  body{{overflow:hidden;}}
  html.transparent,body.transparent{{background:transparent;}}
  html.dark,body.dark{{background:#17130f;}}
  body.dark #caption, body.light-text #caption{{color:#e8dec4;}} body.dark #caption i, body.dark #caption small, body.light-text #caption i, body.light-text #caption small{{color:#b9ac92;}}
  body.dark #vignette{{background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,.45) 100%);box-shadow:none;}}
  #gl{{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;}}
  #vignette{{position:fixed;inset:0;pointer-events:none;
    background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(70,48,22,.22) 100%);box-shadow:inset 0 0 90px rgba(60,40,15,.18);}}
  body.transparent #vignette{{display:none;}}
  #caption{{position:fixed;left:22px;bottom:18px;pointer-events:none;font-family:var(--serif);color:var(--ink);line-height:1.25;}}
  #caption b{{display:block;font-weight:400;font-size:17px;letter-spacing:.02em;}}
  #caption i{{display:block;font-size:13px;color:var(--ink-soft);}}
  #caption small{{display:block;margin-top:5px;font-family:var(--body);font-size:11px;color:var(--ink-soft);letter-spacing:.02em;}}
  #caption a{{color:inherit;text-decoration:none;pointer-events:auto;}}
  #caption a:hover{{color:var(--ink);}}
  body.nocaption #caption{{display:none;}}
  @media (max-width:420px){{ #caption b{{font-size:15px;}} #caption small{{display:none;}} }}
</style>

<canvas id="gl" aria-label="A hand-coloured engraving of {H.escape(name)}, its wings moving"></canvas>
<div id="vignette"></div>
<div id="caption">
  <b>{H.escape(name)}</b>
  <i>{H.escape(latin)} · Plate {numeral}, figure {fig}</i>
  <small>Lucas, <em>{H.escape(title_short)}</em>, {H.escape(place_year)} · <a href="https://aurelianpress.co.uk/{book}/#{key}" target="_blank" rel="noopener">The Aurelian Press</a></small>
</div>
'''

script = r'''<script type="module">
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js';
const SPEC = __SPEC__;
const q = new URLSearchParams(location.search);
const bg = q.get('bg') || '__DEFAULT_BG__';
const TRANSPARENT = bg === 'transparent', DARK = bg === 'dark', CUTOUT = TRANSPARENT || DARK;
if (TRANSPARENT) { document.documentElement.classList.add('transparent'); document.body.classList.add('transparent'); }
if (DARK) { document.documentElement.classList.add('dark'); document.body.classList.add('dark'); }
if (q.get('caption') === '0') document.body.classList.add('nocaption');
if (q.get('text') === 'light') document.body.classList.add('light-text');     // pale caption for a dark host page
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* paper */
function rng(seed){ let a = seed>>>0; return ()=>{ a|=0; a = a + 0x6D2B79F5|0; let t = Math.imul(a^a>>>15, 1|a); t = t + Math.imul(t^t>>>7, 61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function drawPaper(){
  const P = 2048, c = document.createElement('canvas'); c.width = c.height = P; const g = c.getContext('2d');
  g.fillStyle = '#ece3ca'; g.fillRect(0,0,P,P);
  const img = g.getImageData(0,0,P,P), d = img.data, r = rng(7);
  for (let i=0;i<d.length;i+=4){ const n=(r()-0.5)*22; d[i]+=n; d[i+1]+=n*0.95; d[i+2]+=n*0.8; }
  g.putImageData(img,0,0);
  g.strokeStyle='rgba(120,95,60,0.10)'; g.lineWidth=1;
  for (let i=0;i<2600;i++){ const x=r()*P,y=r()*P,a=r()*6.28,l=6+r()*26; g.beginPath(); g.moveTo(x,y); g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l); g.stroke(); }
  for (let i=0;i<26;i++){ const x=r()*P,y=r()*P,rad=20+r()*90; const gr=g.createRadialGradient(x,y,0,x,y,rad); gr.addColorStop(0,`rgba(150,110,60,${0.05+r()*0.08})`); gr.addColorStop(1,'rgba(150,110,60,0)'); g.fillStyle=gr; g.beginPath(); g.arc(x,y,rad,0,6.28); g.fill(); }
  const gr=g.createLinearGradient(0,0,P,P); gr.addColorStop(0,'rgba(255,250,235,0.18)'); gr.addColorStop(1,'rgba(120,90,50,0.10)'); g.fillStyle=gr; g.fillRect(0,0,P,P);
  return c;
}

/* scene: the same light as the books */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: TRANSPARENT });
if (TRANSPARENT) renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const FOV = 22, CAM_DIST = 8.4;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100); camera.position.set(0, 0, CAM_DIST);
const paperTex = new THREE.CanvasTexture(drawPaper()); paperTex.colorSpace = THREE.SRGBColorSpace;
paperTex.wrapS = paperTex.wrapT = THREE.MirroredRepeatWrapping; paperTex.repeat.set(4, 4); paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const paper = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), TRANSPARENT ? new THREE.ShadowMaterial({ opacity: 0.22 }) : DARK ? new THREE.MeshLambertMaterial({ color: 0x17130f }) : new THREE.MeshLambertMaterial({ map: paperTex }));
paper.receiveShadow = true; scene.add(paper);
scene.add(new THREE.AmbientLight(0xfff6e6, 1.85));
const sun = new THREE.DirectionalLight(0xfff1dc, 1.25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 20; const sc = sun.shadow.camera; sc.left = sc.bottom = -3.6; sc.right = sc.top = 3.6;
sun.shadow.radius = 9; sun.shadow.blurSamples = 16; sun.shadow.bias = -0.0005; sun.position.set(-1.8, 2.6, 6.5); scene.add(sun); scene.add(sun.target);

/* shaders: hinge with a bend that lags toward the tip; the print multiplied onto the paper, its whites added */
const inkUniform = { value: 0 };
const makeWingUniforms = () => ({ uPhase:{value:0}, uAmp:{value:0.04}, uRest:{value:0.14}, uLag:{value:0.85} });
const WING_UNIFORMS = `uniform float uPhase; uniform float uAmp; uniform float uRest; uniform float uLag;\nvoid main() {`;
const WING_VERT = `vec3 transformed = vec3(position);
  float u = clamp(position.x, 0.0, 1.0);
  float th = uRest + uAmp * sin(uPhase - uLag * pow(u, 1.5));
  transformed.x = position.x * cos(th);
  transformed.z = position.x * sin(th);`;
const INK_FRAG = `#include <map_fragment>
  { vec3 c = diffuseColor.rgb * 1.3;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 sepia = vec3(l) * vec3(1.0, 0.96, 0.90);
    c = mix(c, sepia, uInk);
    vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2));
    vec3 paperLin = pow(vec3(0.910, 0.871, 0.769), vec3(2.2));
    diffuseColor.rgb = uMode > 1.5 ? min(lin, vec3(1.08)) * paperLin : uMode < 0.5 ? min(lin, vec3(1.0)) : max(lin - 1.0, vec3(0.0)) * 0.85; }`;
function inject(mat, wing, mode = 0){
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInk = inkUniform; shader.uniforms.uMode = { value: mode };
    if (wing){ Object.assign(shader.uniforms, wing); shader.vertexShader = shader.vertexShader.replace('void main() {', WING_UNIFORMS).replace('#include <begin_vertex>', WING_VERT); }
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform float uInk; uniform float uMode;\nvoid main() {').replace('#include <map_fragment>', INK_FRAG);
  };
  mat.customProgramCacheKey = () => `${wing ? 'wing' : 'body'}-${mode}`;
}

/* the specimen, as the books build it */
const loader = new THREE.TextureLoader();
const loadTex = (uri) => { const t = loader.load(uri); t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
const wingGeo = new THREE.PlaneGeometry(1, 1, 40, 40); wingGeo.translate(0.5, 0, 0);
const group = new THREE.Group(); scene.add(group);
const [x0, y0, x1, y1] = SPEC.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
const SPAN = 2.6, scale = SPAN / (x1 - x0);
const uniforms = makeWingUniforms();
function materials(part, wing){
  const map = loadTex(part.rgb), alpha = loadTex(part.alpha);
  if (CUTOUT) {   // one pass: the print as a cut-out of its own paper, so the colours read as on the page
    const mat = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mat.alphaTest = 0.5; inject(mat, wing, 2);
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }); if (wing) inject(dm, wing);
    return { mat, add: null, dm };
  }
  const mat = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }); mat.alphaTest = 0.5; inject(mat, wing, 0);
  const add = new THREE.MeshBasicMaterial({ map, alphaMap: alpha, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }); add.alphaTest = 0.5; inject(add, wing, 1);
  const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }); if (wing) inject(dm, wing);
  return { mat, add, dm };
}
function twin(mesh, add){ if (!add) return null; const t = new THREE.Mesh(mesh.geometry, add); t.position.copy(mesh.position); t.position.z += 0.0005; t.scale.copy(mesh.scale); t.renderOrder = mesh.renderOrder + 10; group.add(t); return t; }
for (const name of ['wing-L', 'wing-R']){
  const part = SPEC.parts[name]; if (!part) continue;
  const side = name.endsWith('R') ? 1 : -1;
  const { mat, add, dm } = materials(part, uniforms);
  const mesh = new THREE.Mesh(wingGeo, mat); mesh.customDepthMaterial = dm; mesh.castShadow = true; mesh.renderOrder = 1;
  const bcy = (part.bbox[1] + part.bbox[3]) / 2, hinge = SPEC.axis + side * SPEC.bodyHalf;
  mesh.scale.set(side * part.w * scale, part.h * scale, 1);
  mesh.position.set((hinge - cx) * scale, -(bcy - cy) * scale, 0.002);
  group.add(mesh); twin(mesh, add);
}
let body = null, bodyTwin = null;
if (SPEC.parts.body){
  const part = SPEC.parts.body, { mat, add, dm } = materials(part, null);
  body = new THREE.Mesh(new THREE.PlaneGeometry(part.w * scale, part.h * scale), mat); body.customDepthMaterial = dm; body.castShadow = true; body.renderOrder = 3;
  body.position.set(((part.bbox[0] + part.bbox[2]) / 2 - cx) * scale, -((part.bbox[1] + part.bbox[3]) / 2 - cy) * scale, 0.012);
  group.add(body); bodyTwin = twin(body, add);
}

/* motion: calm breathing, a startle when the pointer comes near, a flutter of its own now and then */
const tune = { amp: 0.38, freq: 1.1, lag: 0.85, rest: 0.14, breath: 0.05 };
const S = { phase: Math.random() * 6.28, energy: 0, burst: 0, nextBurst: 2.5, lift: 0, amp: 0.04, freq: 0.6 };
const baseFreq = THREE.MathUtils.clamp(0.9 - SPAN * 0.18, 0.35, 0.9);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(-10, -10), pointerWorld = new THREE.Vector3(), plane0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let hasPointer = false, pointerSpeed = 0, lastPX = 0, lastPY = 0, inkTarget = 0;
addEventListener('pointermove', (e) => { hasPointer = true; pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); pointerSpeed = Math.min(1, Math.hypot(e.clientX - lastPX, e.clientY - lastPY) / 40); lastPX = e.clientX; lastPY = e.clientY; });
addEventListener('pointerleave', () => { hasPointer = false; });
canvas.addEventListener('click', () => { inkTarget = inkTarget ? 0 : 1; });     // the plate as engraved, then as painted
function resize(){
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  const viewW = 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.aspect, viewH = viewW / camera.aspect;
  group.scale.setScalar(Math.min(1, (viewW * 0.86) / SPAN, (viewH * 0.8) / ((y1 - y0) * scale)));
}
addEventListener('resize', resize); resize();

const clock = new THREE.Clock(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
function frame(){
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const px = hasPointer ? pointer.x : 0, py = hasPointer ? pointer.y : 0;
  camTarget.set(px * 0.18, py * 0.12, CAM_DIST); camera.position.lerp(camTarget, 1 - Math.pow(0.02, dt)); camera.lookAt(px * 0.05, py * 0.03, 0);
  raycaster.setFromCamera(pointer, camera); raycaster.ray.intersectPlane(plane0, pointerWorld);
  let hovering = false;
  if (hasPointer && !reduceMotion){ const d = tmp.copy(pointerWorld).length() / (SPAN * 0.6 * group.scale.x); if (d < 1){ S.energy = Math.min(1, S.energy + dt * (0.35 + 0.6 * pointerSpeed) * (1 - d)); hovering = d < 0.85; } }
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
  if (body){ body.position.z = 0.012 + Math.max(0, -Math.sin(S.phase)) * 0.02 * S.amp; if (bodyTwin) bodyTwin.position.z = body.position.z + 0.0005; }
  inkUniform.value += (inkTarget - inkUniform.value) * (1 - Math.pow(0.02, dt));
  pointerSpeed *= Math.pow(0.001, dt);
  canvas.style.cursor = hovering ? 'pointer' : 'default';
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
</script>
'''.replace('__SPEC__', json.dumps(spec)).replace('__DEFAULT_BG__', DEFAULT_BG)

os.makedirs(f'{ROOT}/site/public/embed', exist_ok=True)
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
       + head.split('<canvas')[0] + '</head>\n<body>\n<canvas' + head.split('<canvas', 1)[1] + script + '</body>\n</html>\n')
out = f'{ROOT}/site/public/embed/{slug}.html'
open(out, 'w', encoding='utf-8').write(doc)
if os.environ.get('SCRATCH'):
    open(f"{os.environ['SCRATCH']}/{slug}.artifact.html", 'w', encoding='utf-8').write(head + script)
print(out, os.path.getsize(out) // 1024, 'KB', '|', name, latin, f'Plate {numeral} fig {fig}')
