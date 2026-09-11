import * as THREE from 'three';
import { createAuroraEmission } from './aurora-emission.js';
import { auroraMagneticField, auroraRayleighLuminance, AURORA_NIGHT_EXPOSURE, AURORA_PHYSICS_GLSL } from './aurora-physics.js';
import { AURORA_WIDTH, AURORA_HEIGHT, auroraEmissionGrid, auroraLatitudeFloor, auroraPatternNeedsUpdate } from './aurora-model.js';
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
      vec2 emissionUv(vec3 point,vec3 normal,float radius){
        float mu=dot(normal,axis), c2=max(0.0,1.0-mu*mu);
        // A dipole field line preserves magnetic longitude. Compute its
        // reference latitude directly, without reconstructing and projecting
        // the three-dimensional footpoint at every integration sample.
        if(c2<.000001){
          vec3 footpoint=auroraFootpoint(point,axis);
          return vec2(atan(dot(footpoint,dusk),dot(footpoint,noon))/6.28318530718+.5,
                      asin(clamp(dot(footpoint,axis),-1.0,1.0))/3.14159265359+.5);
        }
        float referenceMu=(mu>=0.0?1.0:-1.0)*sqrt(max(0.0,1.0-clamp(AURORA_REFERENCE/radius*c2,0.0,1.0)));
        float longitude=atan(dot(normal,dusk),dot(normal,noon));
        return vec2(longitude/6.28318530718+.5,asin(referenceMu)/3.14159265359+.5);
      }
      vec3 layerSegment(vec3 ray,vec2 segment,float channel,float thickness,vec3 chordTransmission){
        float lengthKm=(segment.y-segment.x)*6378.137;
        if(lengthKm<=0.0)return vec3(0.0);
        vec3 point=cameraLocal+ray*(segment.x+segment.y)*.5;
        float radius=length(point);vec3 normal=point/radius;
        float sunCosine=dot(normal,sunLocal);
        if(sunCosine>=.08)return vec3(0.0);
        vec3 column=texture2D(emissionMap,emissionUv(point,normal,radius)).rgb;
        float amount=channel<.5?column.r:(channel<1.5?column.g:column.b);
        vec3 colour=channel<.5?vec3(.17,1.3468,.01)*${auroraRayleighLuminance(1)}:
          (channel<1.5?vec3(4.7037,0.0,0.0)*${auroraRayleighLuminance(1,630,.265)}:
          vec3(.25,0.0,13.1143)*${auroraRayleighLuminance(1,427.8,.011)});
        vec3 transmission=vec3(1.0);
        if(radius<ATMOSPHERE_RADIUS) transmission=atmosphereTransmittanceToTop(transmittanceLut,radius,dot(normal,-ray));
        else if(dot(point,ray)>0.0) transmission=chordTransmission;
        return transmission*colour*amount*(1.0-smoothstep(-.16,.08,sunCosine))*lengthKm/thickness*${AURORA_NIGHT_EXPOSURE.toFixed(1)};
      }
      vec3 emissionLayer(vec3 ray,float peak,float width,float channel,vec3 chordTransmission){
        // A finite layer preserves the original vertical column and variance.
        // Its exact chord length gives finite limb brightening without ray marching.
        float thickness=3.46410161514*width;
        vec4 segment=auroraLayerSegments(cameraLocal,ray,
          1.0+(peak-thickness*.5)/6378.137,1.0+(peak+thickness*.5)/6378.137);
        return layerSegment(ray,segment.xy,channel,thickness,chordTransmission)
          +layerSegment(ray,segment.zw,channel,thickness,chordTransmission);
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
        // Projection onto the Sun direction is linear along each interval.
        // If even its lowest endpoint exceeds the maximum shell radius times
        // the daylight cutoff, every sample has exactly zero display contrast.
        vec4 sunDistances=vec4(dot(cameraLocal,sunLocal))+segments*dot(ray,sunLocal);
        if(min(min(sunDistances.x,sunDistances.y),min(sunDistances.z,sunDistances.w))>=.08*AURORA_OUTER) discard;
        float impact=length(cross(cameraLocal,ray));
        vec3 chordTransmission=vec3(1.0);
        if(impact<ATMOSPHERE_RADIUS&&impact>=GROUND_RADIUS){
          vec3 halfChord=atmosphereTransmittanceToTop(transmittanceLut,impact,0.0);
          chordTransmission=halfChord*halfChord;
        }
        vec3 emission=emissionLayer(ray,130.0,17.0,0.0,chordTransmission)
          +emissionLayer(ray,260.0,60.0,1.0,chordTransmission)
          +emissionLayer(ray,108.0,8.0,2.0,chordTransmission);
        gl_FragColor=vec4(emission,1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AURORA_OUTER_RADIUS, 96, 64), material);
  mesh.visible = false;
  mesh.renderOrder = 10;
  planet.add(mesh);
  let installed: AuroraForecast | undefined;
  let latitudeFloor: number | undefined;
  let patternTime: number | undefined;
  let patternGain: number | undefined;
  const inverseBody = new THREE.Quaternion();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverseBody.copy(planet.quaternion).invert();
    material.uniforms.cameraLocal.value.copy(camera.position).applyQuaternion(inverseBody);
  };
  return {
    update(renderer: THREE.WebGLRenderer, sun: THREE.Vector3, seconds: number, sceneTime: number, forecast: AuroraForecast | undefined, gain: number) {
      mesh.visible = !!forecast && gain > 0;
      if (!mesh.visible) { emission.reset(); installed=undefined; latitudeFloor=undefined; patternTime=undefined; return; }
      material.uniforms.sunLocal.value.copy(sun);
      const sourceChanged = forecast !== installed;
      const settingsChanged = gain !== patternGain;
      if (!sourceChanged && !settingsChanged && !auroraPatternNeedsUpdate(patternTime, seconds)) return;
      if (sourceChanged) {
        const displayGrid = auroraEmissionGrid(forecast!);
        texture.image.data = displayGrid;
        texture.needsUpdate = true;
        latitudeFloor=auroraLatitudeFloor(latitudeFloor,displayGrid);
        material.uniforms.latitudeFloor.value=latitudeFloor;
        installed = forecast;
      }
      // Keep the texture and its magnetic coordinate basis together between
      // minute snapshots. Camera projection and daylight contrast still update.
      if (sourceChanged || settingsChanged || patternTime === undefined || seconds < patternTime) emission.reset();
      const field=auroraMagneticField(sceneTime);
      const axis=material.uniforms.axis.value as THREE.Vector3;
      const noon=material.uniforms.noon.value as THREE.Vector3;
      const dusk=material.uniforms.dusk.value as THREE.Vector3;
      axis.fromArray(field.axis);
      noon.copy(sun).addScaledVector(axis,-sun.dot(axis));
      if(noon.lengthSq()<1e-8)noon.set(1,0,0).addScaledVector(axis,-axis.x);
      noon.normalize();dusk.crossVectors(axis,noon).normalize();
      material.uniforms.emissionMap.value=emission.update(renderer,axis,noon,dusk,field.equatorialNanoTesla,seconds,gain);
      patternTime = seconds;
      patternGain = gain;
    },
  };
}
