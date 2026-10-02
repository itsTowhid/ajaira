import * as THREE from 'three'

/**
 * Additive point sprite material: per-particle colour, size and a gentle
 * twinkle, with a soft circular falloff so overlapping points bloom nicely.
 */
export function createParticleMaterial(scale = 120): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uScale: { value: scale },
      uOpacity: { value: 1 },
      uIntensity: { value: 1 },
      uTwinkle: { value: 0.35 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uScale;
      uniform float uTwinkle;

      attribute vec3 aColor;
      attribute float aSize;
      attribute float aTwinkle;

      varying vec3 vColor;
      varying float vFlicker;

      void main() {
        vColor = aColor;
        float flicker = sin(uTime * 1.6 + aTwinkle) * 0.5 + 0.5;
        vFlicker = mix(1.0, 0.55 + 0.45 * flicker, uTwinkle);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (uScale / max(-mvPosition.z, 0.001));
        gl_PointSize = clamp(gl_PointSize, 0.5, 16.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uIntensity;

      varying vec3 vColor;
      varying float vFlicker;

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv) * 2.0;
        if (d > 1.0) discard;

        float core = pow(1.0 - d, 3.0);
        float halo = pow(1.0 - d, 1.0) * 0.10;
        float alpha = core + halo;

        gl_FragColor = vec4(vColor * vFlicker * uIntensity, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  })
}
