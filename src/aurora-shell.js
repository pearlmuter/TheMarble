export const AURORA_INNER_RADIUS = 1 + 85 / 6378.137;
export const AURORA_OUTER_RADIUS = 1 + 500 / 6378.137;

// Two disjoint emitting intervals avoid wasting samples inside the empty sphere.
export function auroraRaySegments(origin, ray, innerRadius = AURORA_INNER_RADIUS, outerRadius = AURORA_OUTER_RADIUS) {
  const interval = radius => {
    const b = origin.reduce((sum, x, i) => sum + x * ray[i], 0);
    const h = b * b - origin.reduce((sum, x) => sum + x * x, 0) + radius * radius;
    return h < 0 ? [1, -1] : [-b - Math.sqrt(h), -b + Math.sqrt(h)];
  };
  const outer = interval(outerRadius), ground = interval(1), inner = interval(innerRadius);
  const start = Math.max(0, outer[0]);
  const end = ground[0] > 0 && ground[1] >= ground[0] ? Math.min(outer[1], ground[0]) : outer[1];
  if (end <= start) return [];
  if (inner[1] >= inner[0] && inner[1] > start && inner[0] < end) {
    return [[start, Math.max(start, inner[0])], [Math.min(end, inner[1]), end]].filter(([a,b]) => b > a);
  }
  return [[start, end]];
}

export const AURORA_SHELL_GLSL = `
const float AURORA_INNER = ${AURORA_INNER_RADIUS.toFixed(12)};
const float AURORA_OUTER = ${AURORA_OUTER_RADIUS.toFixed(12)};
vec2 auroraSphereInterval(vec3 origin, vec3 ray, float radius) {
  float b=dot(origin,ray), h=b*b-dot(origin,origin)+radius*radius;
  if(h<0.0) return vec2(1.0,-1.0);
  return vec2(-b-sqrt(h),-b+sqrt(h));
}
vec4 auroraLayerSegments(vec3 origin,vec3 ray,float innerRadius,float outerRadius) {
  vec2 outer=auroraSphereInterval(origin,ray,outerRadius);
  vec2 ground=auroraSphereInterval(origin,ray,1.0);
  float start=max(0.0,outer.x), end=outer.y;
  if(ground.x>0.0&&ground.y>=ground.x) end=min(end,ground.x);
  if(end<=start) return vec4(0.0);
  vec2 inner=auroraSphereInterval(origin,ray,innerRadius);
  if(inner.y>=inner.x&&inner.y>start&&inner.x<end)
    return vec4(start,max(start,inner.x),min(end,inner.y),end);
  return vec4(start,end,end,end);
}
vec4 auroraSegments(vec3 origin,vec3 ray) {
  return auroraLayerSegments(origin,ray,AURORA_INNER,AURORA_OUTER);
}
`;
