import * as THREE from 'three';
import { AURORA_WIDTH, AURORA_HEIGHT, auroraEmissionGrid } from './aurora-model.js';
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
  const material = new THREE.ShaderMaterial({
    transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    uniforms: {
      auroraMap: { value: texture }, cameraLocal: { value: new THREE.Vector3() },
      sunLocal: { value: new THREE.Vector3(1,0,0) }, time: { value: 0 }, latitudeFloor: { value: 0 }, activityGain: { value: 1 },
      transmittanceLut: { value: transmittance },
    },
    vertexShader: `varying vec3 bodyPosition; void main(){bodyPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec3 bodyPosition;
      uniform vec3 cameraLocal, sunLocal;
      uniform sampler2D auroraMap, transmittanceLut;
      uniform float time, activityGain, latitudeFloor;
      ${ATMOSPHERE_MODEL_GLSL}
      ${ATMOSPHERE_TRANSMITTANCE_GLSL}
      ${AURORA_SHELL_GLSL}
      vec2 auroraUv(vec3 normal){
        float longitude=fract(atan(-normal.z,normal.x)/6.28318530718+1.0);
        float latitude=asin(clamp(normal.y,-1.0,1.0))/3.14159265359+.5;
        return vec2((longitude*360.0+.5)/360.0,(latitude*180.0+.5)/181.0);
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
        float stepLength=total/32.0;
        for(int i=0;i<32;i++){
          float travelled=(float(i)+.5)*stepLength;
          float along=travelled<front?segments.x+travelled:segments.z+travelled-front;
          vec3 point=cameraLocal+ray*along;
          float radius=length(point), height=(radius-1.0)*6378.137;
          vec3 normal=point/radius;
          // Percent probabilities guide activity; this is not a radiometric conversion.
          float probability=texture2D(auroraMap,auroraUv(normal)).r*255.0/100.0;
          float activity=clamp(probability*activityGain,0.0,1.0);
          if(activity<.005) continue;
          float night=1.0-smoothstep(-.16,.08,dot(normal,normalize(sunLocal)));
          if(night<.001) continue;
          float lon=atan(-normal.z,normal.x), lat=asin(normal.y);
          float phase=lat*85.0+2.7*sin(lon*7.0+time*.035)+1.3*sin(lon*19.0+lat*13.0-time*.022);
          float ribbons=pow(.5+.5*sin(phase),9.0);
          float rays=.72+.28*sin(lon*160.0+sin(lon*37.0)+time*.18);
          float structure=.5+.5*sin(lon*11.0+lat*17.0+time*.014);
          float curtain=(.08+.92*ribbons)*rays*(.35+.65*structure);
          float lower=smoothstep(85.0,103.0,height);
          float green=lower*exp(-pow((height-128.0)/42.0,2.0));
          float red=exp(-pow((height-285.0)/90.0,2.0))*.16;
          float violet=exp(-pow((height-103.0)/11.0,2.0))*.07;
          vec3 colour=vec3(.15,1.0,.26)*green+vec3(1.0,.055,.025)*red+vec3(.35,.12,1.0)*violet;
          vec3 transmission=vec3(1.0);
          if(radius<ATMOSPHERE_RADIUS) transmission=atmosphereTransmittanceToTop(transmittanceLut,radius,dot(normal,-ray));
          else if(dot(point,ray)>0.0) transmission=chordTransmission;
          emission+=transmission*colour*activity*curtain*night*stepLength*6378.137*.003;
        }
        gl_FragColor=vec4(emission,1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(AURORA_OUTER_RADIUS, 96, 64), material);
  mesh.visible = false;
  mesh.renderOrder = 10;
  planet.add(mesh);
  let installed: AuroraForecast | undefined;
  const inverseBody = new THREE.Quaternion();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    inverseBody.copy(planet.quaternion).invert();
    material.uniforms.cameraLocal.value.copy(camera.position).applyQuaternion(inverseBody);
  };
  return {
    update(sun: THREE.Vector3, seconds: number, forecast: AuroraForecast | undefined, gain: number) {
      mesh.visible = !!forecast && gain > 0;
      if (!mesh.visible) return;
      if (forecast !== installed) {
        const displayGrid = auroraEmissionGrid(forecast!);
        texture.image.data = displayGrid;
        texture.needsUpdate = true;
        let lowestLatitude = 90;
        for (let i = 0; i < displayGrid.length; i++) {
          if (displayGrid[i] > 0) lowestLatitude = Math.min(lowestLatitude, Math.abs(Math.floor(i / 360) - 90));
        }
        material.uniforms.latitudeFloor.value = Math.sin(Math.max(0, lowestLatitude - 1) * Math.PI / 180);
        installed = forecast;
      }
      material.uniforms.sunLocal.value.copy(sun);
      material.uniforms.time.value = seconds % 10000;
      material.uniforms.activityGain.value = gain;
    },
  };
}
