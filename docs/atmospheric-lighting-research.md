# Sunlight and Earth’s atmosphere from space

This note turns the relevant atmospheric optics into a practical real-time rendering target for Terra. The priority is physical coherence at an orbital/distant-space camera, not a stylized blue outline.

## What should be visible

- **Molecular (Rayleigh) scattering makes the illuminated limb blue.** Short wavelengths scatter much more strongly than long wavelengths. From space this appears as a thin, fuzzy blue halo where the camera ray travels tangentially through a long atmospheric path—not as a uniform emissive ring. NASA describes Earth’s limb as a blue haze that thins with altitude and notes that the limb can appear bluish or reddish depending on illumination. ([NASA GSFC atmospheric-radiation lecture](https://acd-ext.gsfc.nasa.gov/anonftp/acd/daac_ozone/Lecture4/Text/Lecture_4/lec4intro.html), [NASA SVS: Exploring Earth’s Limb](https://svs.gsfc.nasa.gov/11901))
- **The tangent path is the reason the limb is bright and twilight is colored.** At a low solar angle, sunlight crosses much more atmosphere. Blue light is preferentially scattered out of the direct beam, so the surviving illumination becomes orange/red; the atmosphere and cloud tops near the terminator receive this warmed light. NASA’s orbital photographs show deep orange/yellow in the dense lower atmosphere, pink/white above it, and blue fading into black at greater altitude. ([NASA Earth Observatory: Crepuscular Rays and Light Scattering](https://science.nasa.gov/earth/earth-observatory/crepuscular-rays-and-light-scattering-150090/), [NASA Earth Observatory: Sunset from the ISS](https://earthobservatory.nasa.gov/images/44267/sunset-from-the-international-space-station))
- **Aerosol (Mie) scattering is broader-spectrum and strongly directional.** NOAA describes aerosols as scattering longer wavelengths more efficiently than molecules and sending much of that light forward. Visually, this produces a compact, pale-gold/white aureole toward the Sun and a warmer, denser lower-atmosphere haze; it should not turn the whole limb white. ([NOAA Global Monitoring Laboratory: Global Radiation and Aerosols](https://gml.noaa.gov/grad/about/redsky/))
- **Ozone is absorption, not another glow.** Ozone has visible Chappuis absorption extending from roughly 410 nm beyond 850 nm, peaking near 600 nm. In a compact RGB model it belongs in extinction along long paths and can subtly alter twilight color; it should not be rendered as a separate saturated blue shell. ([NOAA: Radiative Processes, §7.1.7](https://csl.noaa.gov/assessments/ozone/1985/vol1/chapter7.pdf), [NASA/JSC SOLSE-2 limb explanation](https://esrs.jsc.nasa.gov/Collections/EarthFromSpace/photoinfo.pl?PHOTO=STS073-E-5113))
- **Clouds participate in the same lighting.** Water droplets scatter non-selectively, so sunlit clouds look approximately white; at low Sun angles they turn gold, and cloud tops cast elongated shadows. This is direct observational guidance for tinting the existing elevated cloud layer. ([NASA Earth Observatory: Crepuscular Rays and Light Scattering](https://science.nasa.gov/earth/earth-observatory/crepuscular-rays-and-light-scattering-150090/))
- **The night-side limb is nearly black in this exposure regime.** Sunlight-driven scattering should fall away once the atmosphere is inside Earth’s shadow. Airglow exists, but NASA identifies it as emission by excited upper-atmosphere atoms and molecules; it is a separate, very faint phenomenon and should not be confused with the daylight halo. ([NASA: Why NASA Watches Airglow](https://www.nasa.gov/solar-system/why-nasa-watches-airglow-the-colors-of-the-upper-atmospheric-wind/))

## Physically grounded model

The reference model for interactive rendering is Bruneton and Neyret’s radiative-transfer approach. It represents Earth as a spherical ground boundary inside a spherical atmosphere, with exponentially decreasing molecular and aerosol densities; precomputed transmittance, single scattering, multiple scattering, and ground irradiance make the full model constant-time at runtime. It reproduces daylight, twilight, aerial perspective, Earth shadow, and light shafts for viewpoints from the ground to space. ([Bruneton & Neyret 2008 paper](https://doi.org/10.1111/j.1467-8659.2008.01245.x), [author’s documented implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/))

Useful Earth defaults from the author’s implementation are:

| Quantity | Reference value | Terra-scale interpretation |
| --- | ---: | --- |
| Ground radius | 6,360 km | `1.0` |
| Atmosphere top | 6,420 km | `1.00943` |
| Rayleigh scale height | 8 km | `0.001258` |
| Mie scale height | 1.2 km | `0.000189` |
| Aerosol phase asymmetry `g` | `0.8` | use unchanged |
| Approximate ozone peak | 25 km | `0.00393` above surface |

These constants and the wavelength-dependent `lambda^-4` Rayleigh coefficient are taken from the model’s Earth demo. ([Bruneton atmosphere demo source](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/demo/demo.cc.html))

For an atmosphere sample point at altitude `h`:

```text
densityR = exp(-h / 8 km)
densityM = exp(-h / 1.2 km)
phaseR(mu) = 3 / (16 pi) * (1 + mu^2)
phaseM(mu, g) = Cornette–Shanks(mu, g), with g = 0.8
```

`mu` must be the cosine of the angle between the camera-to-sample ray and the sample-to-Sun direction, so the Mie lobe peaks when looking toward the Sun. The reference implementation uses separate Rayleigh and Mie phase functions and includes higher scattering orders. ([Bruneton core GLSL](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html))

## Recommended real-time implementation for Terra

### 1. Render the atmosphere as a participating shell

Use a back-face atmosphere sphere or a full-screen pass. For each atmosphere pixel:

1. Analytically intersect the camera ray with the atmosphere sphere and clamp the segment against the opaque Earth sphere.
2. March 8–12 samples along only that segment.
3. At every sample, compute exponential Rayleigh and Mie densities from altitude.
4. Estimate optical depth from the sample toward the Sun with 4–6 secondary samples (or a small 2D transmittance LUT).
5. Accumulate single-scattered radiance:

```text
L += T_camera * T_sun * E_sun
   * (betaR * densityR * phaseR + betaM * densityM * phaseM) * ds
T_camera *= exp(-(betaR*densityR + betaM_ext*densityM + betaO3*densityO3) * ds)
```

The result naturally creates a thin bright tangent limb, a dimmer face-on atmosphere, a warm terminator, a Sun-facing aerosol aureole, and Earth’s atmospheric shadow. Keep all work in linear color and apply the app’s filmic tone mapping afterward.

### 2. Couple the surface to atmospheric transmittance

Do not illuminate the surface with a colorless `dot(normal, sun)` alone. Multiply direct sunlight by wavelength-dependent atmospheric transmittance along the surface-to-Sun path. Near noon it remains nearly white; close to the terminator it becomes warmer and dimmer. Add only a restrained blue multiple-scattering fill near the terminator. The 2008 model explicitly treats both direct sunlight and skylight/ground irradiance; the documented implementation can precompute up to four scattering orders. ([Bruneton & Neyret 2008](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8659.2008.01245.x), [reference implementation overview](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/reference/model.cc.html))

### 3. Make the terminator altitude-aware

The solid Earth blocks direct sunlight when `dot(surfaceNormal, sunDirection) < 0`, but the upper atmosphere remains sunlit slightly beyond the ground terminator. In the atmosphere march, test whether the ray from each sample toward the Sun intersects the Earth sphere. If it does, set direct solar transmittance to zero at that sample. This produces the correct narrow twilight arc without manually painting an orange band.

### 4. Treat the visible Sun as an optical source

- Render a white-hot solar disc at its astronomical direction and true apparent angular radius.
- Occlude it when its camera ray intersects Earth.
- If its ray crosses the atmosphere but not Earth, attenuate its RGB by the same integrated atmosphere optical depth. It will dim and shift orange/red near the limb. NASA orbital video notes that atmospheric refraction and the long path make the setting Sun appear orange. ([NASA/JSC orbital sunset sequence](https://eol.jsc.nasa.gov/beyondthephotography/crewearthobservationsvideos/Special.htm))
- Add bloom after tone mapping/exposure, driven by the disc’s HDR luminance. The broad glow should come from the Mie phase term in the atmosphere, not from a permanently attached billboard halo.

### 5. Light clouds consistently

For each cloud fragment, use the same Sun direction and a softened day/night factor. Multiply the white cloud albedo by atmospheric solar transmittance so clouds turn cream/gold near sunset. Retain the existing offset cloud-shadow sample on the surface, but increase its offset at grazing angles and keep the shadow soft and low-opacity. Earth-shadow occlusion must also remove direct light from night-side cloud fragments.

## Visual acceptance criteria

- In a day-side view, the atmospheric rim is thin cyan/blue and strongest at the tangent limb; it fades smoothly into black space.
- At the terminator, a narrow warm orange/pink lower-atmosphere arc transitions outward to blue. It moves with the scientifically calculated Sun direction.
- On the deep night side, the atmosphere is almost absent except for an optional extremely faint airglow line.
- Looking near the Sun creates a compact pale aerosol aureole; looking away leaves mostly the blue Rayleigh component.
- The visible Sun is white in open space, reddens and dims only while grazing the atmosphere, and vanishes behind the opaque Earth.
- Surface and clouds share the same transmittance, so neither remains cold-white at sunset and neither is directly lit in Earth’s shadow.
- No screen-space glow remains fixed to a corner or fixed relative to the camera; all effects derive from camera, Earth, and astronomical Sun vectors.

## Scope recommendation

For this app, the 8–12-step single-scattering shell plus a small multiple-scattering fill is the best quality/performance compromise. A full Bruneton precomputed atmosphere is the scientifically stronger future path, but it adds several lookup textures and a precomputation/build pipeline. The proposed shell model preserves the important dependencies—density, optical depth, wavelength, phase angle, Earth shadow, and solar transmittance—without imposing that integration cost now.
