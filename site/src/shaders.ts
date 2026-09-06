import * as THREE from 'three';

/** Uniforms shared between a wing's visible material and its shadow-depth material. */
export interface WingUniforms {
  uPhase: { value: number }; uAmp: { value: number }; uRest: { value: number }; uLag: { value: number };
}
export const makeWingUniforms = (): WingUniforms => ({
  uPhase: { value: 0 }, uAmp: { value: 0.04 }, uRest: { value: 0.14 }, uLag: { value: 0.85 },
});

/** 0 = hand-coloured print, 1 = sepia ink only. Shared by every material. */
export const inkUniform = { value: 0 };

const WING_UNIFORMS = /* glsl */ `
  uniform float uPhase; uniform float uAmp; uniform float uRest; uniform float uLag;
  void main() {`;

// Hinge about the body axis (local x = 0) with a bend that lags toward the tip.
const WING_VERT = /* glsl */ `
  vec3 transformed = vec3(position);
  float u = clamp(position.x, 0.0, 1.0);
  float th = uRest + uAmp * sin(uPhase - uLag * pow(u, 1.5));
  transformed.x = position.x * cos(th);
  transformed.z = position.x * sin(th);
`;

// Textures store (scan / paper) / 1.3, so 1.0 means paper and values above it are pigment lighter than the paper.
// The multiply pass darkens the paper with pigment; the additive pass lightens it where the print is whiter.
const INK_FRAG = /* glsl */ `
  #include <map_fragment>
  {
    vec3 c = diffuseColor.rgb * 1.3;                     // raw stored ratio, display space
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 sepia = vec3(l) * vec3(1.0, 0.96, 0.90);
    c = mix(c, sepia, uInk);
    vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2));       // to linear, where blending happens
    diffuseColor.rgb = uMode < 0.5 ? min(lin, vec3(1.0)) : max(lin - 1.0, vec3(0.0)) * 0.85;
  }
`;

/** Inject the hinge (vertex) and ink toggle (fragment) into a built-in material. */
export function inject(mat: THREE.Material, wing: WingUniforms | null, mode = 0) {
  mat.onBeforeCompile = (shader) => {
    (shader.uniforms as any).uInk = inkUniform;
    (shader.uniforms as any).uMode = { value: mode };
    if (wing) {
      Object.assign(shader.uniforms, wing);
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', WING_UNIFORMS)
        .replace('#include <begin_vertex>', WING_VERT);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uInk; uniform float uMode;\nvoid main() {')
      .replace('#include <map_fragment>', INK_FRAG);
  };
  mat.customProgramCacheKey = () => `${wing ? 'wing' : 'body'}-${mode}`;
}
