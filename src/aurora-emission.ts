import * as THREE from 'three';
import { AURORA_PHYSICS_GLSL, AURORA_GREEN_RESPONSE_SECONDS, AURORA_RED_RESPONSE_SECONDS } from './aurora-physics.js';

// A magnetic-coordinate emission history. RGB stores vertical-column kR for
// green, red and prompt nitrogen respectively, before viewing/exposure effects.
export function createAuroraEmission(source: THREE.Texture) {
  const options = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
  let previous = new THREE.WebGLRenderTarget(1024, 512, options);
  let next = previous.clone();
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      source: { value: source }, history: { value: previous.texture },
      axis: { value: new THREE.Vector3(0,1,0) }, noon: { value: new THREE.Vector3(1,0,0) }, dusk: { value: new THREE.Vector3(0,0,-1) },
      strength: { value: 30000 }, time: { value: 0 }, dt: { value: 0 }, gain: { value: 1 }, reset: { value: true },
    },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D source,history;
      uniform vec3 axis,noon,dusk;
      uniform float time,dt,gain,strength;
      uniform bool reset;
      ${AURORA_PHYSICS_GLSL}
      float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float noise(vec3 p){
        vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
      }
      vec2 geographicUv(vec3 n){return vec2((fract(atan(-n.z,n.x)/6.28318530718+1.0)*360.0+.5)/360.0,(asin(clamp(n.y,-1.0,1.0))/3.14159265359*180.0+90.5)/181.0);}
      void main(){
        float longitude=(vUv.x-.5)*6.28318530718,latitude=(vUv.y-.5)*3.14159265359;
        float c=cos(latitude),s=sin(latitude);
        vec3 footprint=axis*s+c*(noon*cos(longitude)+dusk*sin(longitude));
        float probability=texture2D(source,geographicUv(footprint)).r*255.0;
        float flux=auroraFlux(probability,gain);
        // Convection speed E/B, with E=25 mV/m assumed; strength is IGRF dipole nT.
        float field=strength*sqrt(1.0+3.0*s*s)/pow(AURORA_REFERENCE,3.0);
        float velocity=.025/(field*1e-9)/1000.0; // km/s
        float drift=velocity*time/(6488.137*max(.12,abs(c)));
        // Exact azimuthal backtrace at the representative E/B speed.
        // Longitude derivative stays one: no growing Euler-map fold. The
        // actual electric-field direction is not supplied by the forecast.
        float advected=longitude+drift*(latitude<0.0?-1.0:1.0);
        vec2 around=vec2(cos(advected),sin(advected));
        // Domain-warped magnetic-latitude contours: elongated arcs, with local
        // folds and breaks instead of evenly spaced geographic sine stripes.
        float hemi=latitude<0.0?19.0:0.0;
        float bend=noise(vec3(around*3.0,hemi+time/240.0));
        float fold=noise(vec3(around*13.0,hemi+latitude*4.0+time/90.0));
        float across=abs(latitude)*6488.137/90.0+5.5*bend+1.6*fold;
        float sheet=noise(vec3(around*2.4,across));
        float width=max(.026,fwidth(sheet)*.8);
        float ridge=exp(-pow((sheet-.53)/width,2.0));
        float breaks=smoothstep(.20,.70,noise(vec3(around*8.0,hemi+latitude*11.0+time/75.0)));
        float small=noise(vec3(around*65.0,hemi+latitude*23.0+time/8.0));
        float patches=noise(vec3(around*5.0,hemi+latitude*9.0+time/45.0));
        // Bounded [0,1]: structure cannot invent energy above the flux proxy.
        float discrete=ridge*breaks*(.6+.4*small);
        float excitation=.06+.94*discrete;
        vec3 target=flux*vec3(1.23*excitation,.08*(.35+.65*patches),.12*discrete);
        vec3 old=texture2D(history,vUv).rgb;
        vec3 retain=reset?vec3(0.0):exp(-dt/vec3(${AURORA_GREEN_RESPONSE_SECONDS},${AURORA_RED_RESPONSE_SECONDS},.02));
        gl_FragColor=vec4(mix(target,old,retain),1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  quad.frustumCulled=false; scene.add(quad);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  let lastTime: number | undefined, lastGain: number | undefined;
  return {
    update(renderer: THREE.WebGLRenderer, axis: THREE.Vector3, noon: THREE.Vector3, dusk: THREE.Vector3, strength: number, seconds: number, gain: number) {
      const reset=lastTime===undefined || lastGain!==gain || seconds<lastTime;
      const dt=lastTime===undefined?0:seconds-lastTime;
      if(!reset && dt<.05)return previous.texture;
      material.uniforms.axis.value.copy(axis);material.uniforms.noon.value.copy(noon);material.uniforms.dusk.value.copy(dusk);
      material.uniforms.strength.value=strength;material.uniforms.time.value=seconds;
      material.uniforms.gain.value=gain;material.uniforms.dt.value=dt;material.uniforms.reset.value=reset;
      material.uniforms.history.value=previous.texture;
      const target=renderer.getRenderTarget();
      renderer.setRenderTarget(next);renderer.render(scene,camera);renderer.setRenderTarget(target);
      [previous,next]=[next,previous];lastTime=seconds;lastGain=gain;
      return previous.texture;
    },
    reset(){lastTime=undefined;},
  };
}
