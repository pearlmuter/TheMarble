// Positive cubic B-spline reconstruction: no ringing or added fine-scale detail.
// Only magnified textures pay for four bilinear taps; distant views use mipmaps.
export const CLOUD_SAMPLING_GLSL = `
  uniform vec2 cloudCoverageFrom;
  uniform vec2 cloudCoverageTo;
  float cloudCoverageWeight(vec2 uv,vec2 band){
    float latitude=(uv.y-.5)*180.0;
    float south=band.x<=-89.9?1.0:smoothstep(band.x,band.x+1.5,latitude);
    float north=band.y>=89.9?1.0:1.0-smoothstep(band.y-1.5,band.y,latitude);
    return south*north;
  }
  vec4 smoothCloudSample(sampler2D map,vec2 uv){
    vec2 size=vec2(textureSize(map,0));
    vec2 footprint=fwidth(uv)*size;
    float magnification=1.0-smoothstep(.5,1.0,max(footprint.x,footprint.y));
    vec4 ordinary=texture2D(map,uv);
    if(magnification<=.001) return ordinary;
    vec2 pixel=uv*size-.5, f=fract(pixel), base=floor(pixel);
    vec2 w0=pow(1.0-f,vec2(3.0))/6.0;
    vec2 w1=(3.0*f*f*f-6.0*f*f+4.0)/6.0;
    vec2 w2=(-3.0*f*f*f+3.0*f*f+3.0*f+1.0)/6.0;
    vec2 w3=f*f*f/6.0;
    vec2 g0=w0+w1,g1=w2+w3;
    vec2 a=(base-1.0+w1/g0+.5)/size;
    vec2 b=(base+1.0+w3/g1+.5)/size;
    vec4 filtered=texture2D(map,a)*g0.x*g0.y
      +texture2D(map,vec2(b.x,a.y))*g1.x*g0.y
      +texture2D(map,vec2(a.x,b.y))*g0.x*g1.y
      +texture2D(map,b)*g1.x*g1.y;
    return mix(ordinary,filtered,magnification*.75);
  }
`;

export function cloudCoverageWeight(latitude, [south, north]) {
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t); };
  return (south <= -89.9 ? 1 : smooth(south,south+1.5,latitude))
    * (north >= 89.9 ? 1 : 1-smooth(north-1.5,north,latitude));
}
