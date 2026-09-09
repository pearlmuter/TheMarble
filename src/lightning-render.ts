import * as THREE from 'three';
import { lightningDirection } from './lightning-model.js';
import type { ActiveFlash } from './lightning-model.js';
import { ATMOSPHERE_MODEL_GLSL, ATMOSPHERE_TRANSMITTANCE_GLSL } from './atmosphere-model.js';

export function createLightningLayer(planet:THREE.Group, cloudMaterial:THREE.ShaderMaterial, transmittance:THREE.Texture) {
  const limit=512;
  const geometry=new THREE.PlaneGeometry(2,2);
  const material=new THREE.ShaderMaterial({
    transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, depthTest:true, side:THREE.DoubleSide,
    uniforms:{sunLocal:{value:new THREE.Vector3()},cameraLocal:{value:new THREE.Vector3()},transmittanceLut:{value:transmittance},
      cloudMapFrom:cloudMaterial.uniforms.cloudMapFrom,cloudMapTo:cloudMaterial.uniforms.cloudMapTo,cloudMix:cloudMaterial.uniforms.cloudMix},
    vertexShader:`varying vec2 localUv; varying vec3 bodyPosition; varying vec3 brightness;
      void main(){localUv=uv;bodyPosition=(instanceMatrix*vec4(position,1.0)).xyz;brightness=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*vec4(bodyPosition,1.0);}`,
    fragmentShader:`varying vec2 localUv;varying vec3 bodyPosition;varying vec3 brightness;
      uniform vec3 sunLocal,cameraLocal;uniform sampler2D cloudMapFrom,cloudMapTo,transmittanceLut;uniform float cloudMix;
      ${ATMOSPHERE_MODEL_GLSL}
      ${ATMOSPHERE_TRANSMITTANCE_GLSL}
      void main(){
        float r=length((localUv-.5)*2.0);if(r>1.0)discard;
        vec3 normal=normalize(bodyPosition),toCamera=normalize(cameraLocal-bodyPosition);
        // Explicit Earth intersection also covers tangent quads at the far limb.
        float b=dot(bodyPosition,toCamera),c=dot(bodyPosition,bodyPosition)-1.0,h=b*b-c;
        if(b<0.0&&h>0.0&&-b-sqrt(h)<length(cameraLocal-bodyPosition))discard;
        vec2 uv=vec2(.5+atan(-normal.z,normal.x)/6.28318530718,.5+asin(normal.y)/3.14159265359);
        float cloud=mix(texture2D(cloudMapFrom,uv).a,texture2D(cloudMapTo,uv).a,cloudMix);
        float diffusion=exp(-5.0*r*r)*(1.0-smoothstep(.65,1.0,r));
        // The cloud map can be older than the flash. A small diffuse footprint
        // remains when its observed thundercloud is absent from that map.
        diffusion*=mix(.35,1.0,cloud);
        float contrast=mix(1.0,.015,smoothstep(-.08,.15,dot(normal,sunLocal)));
        vec3 transmission=atmosphereTransmittanceToTop(transmittanceLut,length(bodyPosition),dot(normal,toCamera));
        gl_FragColor=vec4(brightness*diffusion*contrast*transmission,1.0);
      }`,
  });
  const mesh=new THREE.InstancedMesh(geometry,material,limit);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=9;planet.add(mesh);
  const transform=new THREE.Object3D(),direction=new THREE.Vector3(),colour=new THREE.Color(),inverse=new THREE.Quaternion();
  mesh.onBeforeRender=(_r,_s,camera)=>{inverse.copy(planet.quaternion).invert();material.uniforms.cameraLocal.value.copy(camera.position).applyQuaternion(inverse);};
  return {
    update(flashes:ActiveFlash[],sun:THREE.Vector3){
      material.uniforms.sunLocal.value.copy(sun);
      mesh.count=Math.min(limit,flashes.length);mesh.visible=mesh.count>0;
      for(let i=0;i<mesh.count;i++){
        const flash=flashes[i];direction.fromArray(lightningDirection(flash.latitude,flash.longitude));
        transform.position.copy(direction).multiplyScalar(1+12/6378.137);
        transform.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
        // Measured GLM area / approximate LI footprint; diffusion isn't bolt size.
        const radius=Math.min(70,Math.max(7,Math.sqrt(flash.area/Math.PI)))/6378.137;
        transform.scale.set(radius,radius,1);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
        // GLM energy is measured at the detector, not discharge energy. Only a
        // bounded relative intensity is used; LI uses neutral intensity until calibrated.
        const relative=flash.source==='mtg'?1:Math.min(2.5,Math.max(.4,Math.log10(1+flash.optical/1e-14)*.45));
        colour.setRGB(.72,.79,1).multiplyScalar(flash.strength*relative*4);
        mesh.setColorAt(i,colour);
      }
      if(mesh.count){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    },
  };
}
