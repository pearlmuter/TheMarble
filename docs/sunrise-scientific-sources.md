# Scientific checks for orbital sunrise

Research date: 2026-09-05. This is an independent source and geometry audit for the
classroom review, not a claim that every criterion below has passed. Runtime and
numerical test results belong in the accompanying validation report.

## What observations establish

The blue upper limb above a warmer lower layer is real. NASA's explanation of
ISS photograph ISS062-E-5419 attributes upper blue to molecular scattering and
lower orange to light modified by particles along long atmospheric paths. That
image used a 400 mm lens, was cropped and contrast enhanced, and had lens artifacts
removed. It establishes a qualitative color pattern, not a target RGB value or
brightness ratio. Aerosol plumes also vary by location and date.
([NASA: Smoke in the Stratosphere](https://science.nasa.gov/earth/earth-observatory/smoke-in-the-stratosphere-148276/))

An atmosphere sample can receive sunlight while the solid Earth still hides the
Sun from the observer. Scattered light can therefore precede direct emergence.
This is a geometric inference from spherical Earth shadow and scattering, not a
brightness measurement inferred from the supplied photograph. The user's image
already contains the visible Sun, so it cannot by itself establish the earlier
sequence. NASA's orbital photographs support the blue-to-warm vertical ordering.
([NASA: Sunset from the International Space Station](https://science.nasa.gov/earth/earth-observatory/sunset-from-the-international-space-station-44267/))

Do not promise an identical blue band for every sunrise. Aerosols, clouds, viewing
geometry, exposure, and the position of the Sun relative to each atmospheric
sample affect the result. A uniform atmosphere can explain the mechanism but
cannot reproduce the atmosphere at a particular date and place.

## Distance and the thickness of the arc

The following numbers are calculations, not values measured from NASA imagery.
Use a spherical Earth of radius `R = 6371 km`, an observer at `d = 7R` from the
center, an Earth-centered pinhole view, and an Earth diameter of 1000 pixels.
The projected radius of a shell of radius `r`, apart from focal length, is:

```text
p(r) = tan(asin(r/d)) = r / sqrt(d²-r²)
shell thickness in pixels = 500 * (p(R+h)/p(R) - 1)
```

| Height above surface | Projected thickness above solid limb |
| --- | ---: |
| 8 km | 0.64 px |
| 20 km | 1.60 px |
| 40 km | 3.21 px |
| 60 km | 4.81 px |
| 127.42 km, current integration boundary | 10.21 px |

The 20–40 km row is a scale illustration, not a claim that the luminous atmosphere
has a hard boundary there. Molecular density falls exponentially; the numerical
127 km integration boundary must not become a visible edge or a uniformly bright
10-pixel outline. The earlier conversational estimate of 2–3 pixels was roughly
right, but 1.6–3.2 pixels is the result for these explicit assumptions.

Farther distance reduces angular size. It does not apply a separate inverse-square
dimming factor to the radiance of an already resolved patch along the same vacuum
ray. Once a thin arc occupies only part of a pixel, pixel averaging reduces its
visible contrast. This follows from the radiance definition for an extended
source, distinct from point-source irradiance.
([NASA human integration handbook, section 8.7.2.4](https://www.nasa.gov/wp-content/uploads/2023/03/human-integration-design-handbook-revision-1.pdf))

At these same dimensions a 0.0093-radian solar diameter occupies approximately
32.2 pixels at frame center, before glare and perspective displacement. Any pixel
comparison must use the actual camera and output resolution rather than an ISS
photo's crop or lens. The solar angular scale is consistent with the reference
model's value of 0.00935 radians.
([Bruneton Earth demo source](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/demo/demo.cc.html))

## Refraction and exposure limits

Refraction bends near-limb rays, shifts apparent emergence and distorts the solar
disc. NASA's Mercury-era theory/observation comparison specifically concerns an
observer in space; it documents flattening. Straight-ray occultation is therefore
an internally valid approximation, not the physically exact solar profile or
sunrise timing. A terrestrial 34-arcminute horizon correction should not simply
be pasted onto a space-to-space grazing ray.
([NASA technical report: The Effect of Refraction on the Setting Sun as Seen from Space in Theory and Observation](https://ntrs.nasa.gov/citations/19630006416))

NASA explains why short exposures for bright Earth omit stars, while slower
nighttime settings can reveal stars and aurora. Consequently, a deliberately
readable rendering of the Sun, night clouds, city lights and dense stars should
not be presented as a calibrated single-exposure photograph or an exact naked-eye
view. This does not mean stars can never appear in an orbital sunrise photograph;
their visibility depends on settings and the resulting saturation/glare.
([NASA: Where are the stars?](https://science.nasa.gov/blogs/earth-matters/2011/09/28/where-are-the-stars/),
[NASA astronaut photography FAQ](https://esrs.jsc.nasa.gov/FAQ/))

An explicit local calibration limit appears in `src/solar-disc.js`: peak solar
radiance is set to 80 for display. With atmospheric solar irradiance `E = pi`
and angular radius `a = 0.00465`, radiance conservation instead gives average
disc radiance approximately `E/(pi*a²) = 46,248`. For the shader's limb-darkening
law `.4 + .6*mu`, disc-average intensity is 0.8 of peak, giving peak about 57,811.
Thus 80 compresses the physical source ratio by roughly 723 times. These are
derived small-angle values, not measured lux. This artistic compression and the
separate star/night-light gains preclude validating absolute relative brightness
from the screenshot. They should not be silently called a scientific exposure.

## What constitutes stronger validation

Bruneton's authored implementation includes full spectral CPU reference images,
solar spectral irradiance, ozone absorption and comparison of RGB approximations.
That is a stronger color-validation target than testing CPU mirrors of our own
shader alone. Local defaults resemble its 8 km molecular / 1.2 km aerosol scale
heights and 10–40 km ozone profile, but matching those coefficients does not
establish equivalent output. In particular, three selected wavelengths treated
as display RGB are not a spectral-to-CIE color calculation.
([Bruneton reference implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/),
[Earth parameter source](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/demo/demo.cc.html))

Hillaire's multiple-scattering approximation is a legitimate real-time method;
its authored sample also has a path-tracing comparison mode. A matched-parameter
comparison would quantify the approximation. Reading the paper or using its
equations does not itself prove an implementation matches the reference.
([Hillaire paper](https://onlinelibrary.wiley.com/doi/10.1111/cgf.14050),
[author's reference and path tracer](https://github.com/sebh/UnrealEngineSkyAtmosphere))

Practical acceptance criteria for this review:

1. **Geometry:** capture a fixed-camera sequence with the solar upper limb still
   below the geometric Earth limb, first contact, partial emergence and clear
   Sun. Report geometric versus refracted assumptions. No direct-disc pixels
   may pass through solid Earth; an optical bloom extending over its image is a
   separate effect.
2. **Pre-emergence:** record atmospheric radiance independently of solar bloom.
   Sunlit air should contribute before direct emergence where the geometry allows
   it. The result must not rely on an always-emissive outline or a hidden Sun
   sprite.
3. **Optical depth:** compare independent high-resolution spherical quadrature
   against the transmittance LUT at 0, 2, 5, 10, 20, 30, 40 and 60 km tangent
   heights. Require transmission in [0,1], decreasing with added extinction and
   convergence on increasing quadrature. A tolerance such as 1% absolute
   transmission is a chosen engineering criterion, not a published accuracy claim.
4. **Sampling:** compare the production atmospheric march and texture resolution
   to a substantially denser reference specifically during dawn. Whole-frame
   average error can conceal errors in a 1–3 pixel arc; report limb-only maximum
   and percentile errors and compare linear radiance before tone mapping.
5. **Visual sequence:** inspect at native output size and enlarged crop. Check
   for narrow blue upper air, any warmer lower air supported by the calculation,
   smooth extinction, no hard integration boundary, flicker or sudden onset.
   Color ordering is qualitative; no particular RGB triplet is prescribed.
6. **Scope:** publish remaining limitations alongside results: omitted
   refraction, simplified globally uniform profiles, approximate multiple
   scattering/RGB conversion, and display-adjusted brightness. Passing geometry
   and numerical convergence does not validate an exact human visual experience.

A responsible classroom description is: “This visualization calculates how
sunlight scatters and is absorbed in a simplified Earth atmosphere. Brightness
is adjusted so features remain visible; actual colors and visibility vary with
conditions and exposure.” Exact apparent sunrise timing and solar flattening
should not be taught from a model that omits refraction.
