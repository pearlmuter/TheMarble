import * as THREE from 'three';
import { createAuroraEmission } from './aurora-emission.js';
import { auroraMagneticField, auroraRayleighLuminance, AURORA_NIGHT_EXPOSURE, AURORA_PHYSICS_GLSL } from './aurora-physics.js';
import { AURORA_WIDTH, AURORA_HEIGHT, auroraEmissionGrid, auroraLatitudeFloor } from './aurora-model.js';
import type { AuroraForecast } from './aurora-model.js';
import { AURORA_OUTER_RADIUS, AURORA_SHELL_GLSL } from './aurora-shell.js';
import { ATMOSPHERE_MODEL_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL } from './atmosphere-model.js';

export function createAuroraLayer(planet: THREE.Group, transmittance: THREE.Texture) {
  const texture = new THREE.DataTexture(new Uint8Array(AURORA_WIDTH * AURORA_HEIGHT), AURORA_WIDTH, AURORA_HEIGHT, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  const emission = createAuroraEmission(texture);
  const material = new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    uniforms: {
      emissionMap: { value: texture }, axis: { value: new THREE.Vector3(0,1,0) }, noon: { value: new THREE.Vector3(1,0,0) }, dusk: { value: new THREE.Vector3(0,0,-1) }, cameraLocal: { value: new THREE.Vector3() },
      sunLocal: { value: new THREE.Vector3(1,0,0) }, latitudeFloor: { value: 0 },
      transmittanceLut: { value: transmittance },
    },
    vertexShader: `varying vec3 bodyPosition; void main(){bodyPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 bodyPosition;
      uniform vec3 cameraLocal, sunLocal, axis, noon, dusk;
      uniform sampler2D emissionMap, transmittanceLut;
      uniform float latitudeFloor;
      ${ATMOSPHERE_MODEL_GLSL}
      ${ATMOSPHERE_TRANSMITTANCE_GLSL}
      ${AURORA_SHELL_GLSL}
      ${AURORA_PHYSICS_GLSL}
      vec2 emissionUv(vec3 n){
        float longitude=atan(dot(n,dusk),dot(n,noon));
        return vec2(longitude/6.28318530718+.5,asin(clamp(dot(n,axis),-1.0,1.0))/3.14159265359+.5);
      }
      void main(){
        vec3 ray=normalize(bodyPosition-cameraLocal);
        vec4 segments=auroraSegments(cameraLocal,ray);
        float front=segments.y-segments.x, back=segments.w-segments.z, total=front+back;
        if(total<=0.0) discard;
        // Bound both intervals against the actual nonzero source latitude range.
        float maxY=max(max(abs((cameraLocal+ray*segments.x).y),abs((cameraLocal+ray*segments.y).y)),
                       max(abs((cameraLocal+ray*segments.z).y),abs((cameraLocal+ray*segments.w).y)));
        if(maxY/AURORA_INNER<latitudeFloor) discard;
        float impact=length(cross(cameraLocal,ray));
        vec3 chordTransmission=vec3(1.0);
        if(impact<ATMOSPHERE_RADIUS&&impact>=GROUND_RADIUS){
          vec3 halfChord=atmosphereTransmittanceToTop(transmittanceLut,impact,0.0);
          chordTransmission=halfChord*halfChord;
        }
        vec3 emission=vec3(0.0);
        float stepLength=total/64.0;
        for(int i=0;i<64;i++){
          float travelled=(float(i)+.5)*stepLength;
          float along=travelled<front?segments.x+travelled:segments.z+travelled-front;
          vec3 point=cameraLocal+ray*along;
          float radius=length(point), height=(radius-1.0)*6378.137;
          vec3 normal=point/radius;
          vec3 footpoint=auroraFootpoint(point,axis);
          vec3 column=texture2D(emissionMap,emissionUv(footpoint)).rgb;
          if(max(column.r,max(column.g,column.b))<.0001) continue;
          // This is daylight contrast on our night-view display, not cessation
          // of auroral excitation in sunlight.
          float contrast=1.0-smoothstep(-.16,.08,dot(normal,sunLocal));
          vec3 profile=vec3(auroraProfile(height,130.0,17.0),auroraProfile(height,260.0,60.0),auroraProfile(height,108.0,8.0));
          vec3 luminance=column*profile*vec3(${auroraRayleighLuminance(1)},${auroraRayleighLuminance(1,630,.265)},${auroraRayleighLuminance(1,427.8,.011)});
          // Approximate in-gamut line colours, each with unit photopic Y.
          vec3 colour=vec3(.17,1.3468,.01)*luminance.r+vec3(4.7037,0.0,0.0)*luminance.g+vec3(.25,0.0,13.1143)*luminance.b;
          vec3 transmission=vec3(1.0);
          if(radius<ATMOSPHERE_RADIUS) transmission=atmosphereTransmittanceToTop(transmittanceLut,radius,dot(normal,-ray));
          else if(dot(point,ray)>0.0) transmission=chordTransmission;
          emission+=transmission*colour*contrast*stepLength*6378.137*${AURORA_NIGHT_EXPOSURE.toFixed(1)};
        }
        gl_FragColor=vec4(emission,1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AURORA_OUTER_RADIUS, 96, 64), material);
  mesh.visible = false;
  mesh.renderOrder = 10;
  planet.add(mesh);
  let installed: AuroraForecast | undefined;
  let latitudeFloor: number | undefined;
  const inverseBody = new THREE.Quaternion();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverseBody.copy(planet.quaternion).invert();
    material.uniforms.cameraLocal.value.copy(camera.position).applyQuaternion(inverseBody);
  };
  return {
    update(renderer: THREE.WebGLRenderer, sun: THREE.Vector3, seconds: number, sceneTime: number, forecast: AuroraForecast | undefined, gain: number) {
      mesh.visible = !!forecast && gain > 0;
      if (!mesh.visible) { emission.reset(); installed=undefined; latitudeFloor=undefined; return; }
      if (forecast !== installed) {
        const displayGrid = auroraEmissionGrid(forecast!);
        texture.image.data = displayGrid;
        texture.needsUpdate = true;
        latitudeFloor=auroraLatitudeFloor(latitudeFloor,displayGrid);
        material.uniforms.latitudeFloor.value=latitudeFloor;
        installed = forecast;
      }
      material.uniforms.sunLocal.value.copy(sun);
      const field=auroraMagneticField(sceneTime);
      const axis=material.uniforms.axis.value as THREE.Vector3;
      const noon=material.uniforms.noon.value as THREE.Vector3;
      const dusk=material.uniforms.dusk.value as THREE.Vector3;
      axis.fromArray(field.axis);
      noon.copy(sun).addScaledVector(axis,-sun.dot(axis));
      if(noon.lengthSq()<1e-8)noon.set(1,0,0).addScaledVector(axis,-axis.x);
      noon.normalize();dusk.crossVectors(axis,noon).normalize();
      material.uniforms.emissionMap.value=emission.update(renderer,axis,noon,dusk,field.equatorialNanoTesla,seconds,gain);
    },
  };
}
