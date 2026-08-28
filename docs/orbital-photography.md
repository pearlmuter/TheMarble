# Orbital photography model

TheMarble treats its presentation as one simulated orbital photograph rather than a collection of independent effects. The verified EQJ scene frame supplies the Sun, Moon, and rotating Earth. `orbitalPhotographyState(...)` then evaluates the apparent solar disc from the current camera, including continuous Earth and Moon occultation, direct-Sun sensor response, lens-flare visibility, and sky exposure.

## Atmosphere and surface

The atmosphere is a spherical participating shell. Ten camera-ray samples and five Sun-ray samples integrate exponential Rayleigh and Mie density, an ozone layer, wavelength-dependent extinction, and the solid Earth’s shadow. The surface, ocean, clouds, atmosphere, and Moon all receive the same scene-space Sun vector.

The surface and cloud terminators use narrow illumination transitions. Night is not ambiently illuminated: the deep night side is carried by the night-light texture, attenuated by cloud optical depth, while the solar atmosphere falls into Earth shadow. Long atmospheric paths warm low sunlight; the tangent limb shifts outward from warm lower air to a cyan-blue molecular haze.

## Camera response

The Sun remains a physical sphere at its ephemeris distance and radius. That geometry is retained for lighting and occultation. A direct view is presented as a compact saturated core, short diffraction rays, and modest bloom. Earth and Moon occultation are calculated as overlap between apparent angular discs, so every optical artifact fades continuously during ingress and egress.

Faint-sky exposure responds to both visible direct sunlight and the illuminated fraction of Earth. A daylight Earth suppresses Hipparcos stars and the Gaia Milky Way even when the Sun is behind the camera. A dark Earth with the Sun occulted permits slow recovery of the real sky.

## Golden scenes

The `golden` URL parameter selects one of eight deterministic photographs:

- `daylight`
- `crescent-earth`
- `terminator`
- `sunrise-limb`
- `visible-sun`
- `solar-occultation`
- `moon`
- `milky-way`

Each preset fixes UTC, camera phase, distance, field of view, and target. Reference captures are stored in [`docs/golden-scenes`](golden-scenes/README.md).

## Physical references

- [Bruneton and Neyret, Precomputed Atmospheric Scattering](https://doi.org/10.1111/j.1467-8659.2008.01245.x)
- [Bruneton reference implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/)
- [NASA: Exploring Earth’s Limb](https://svs.gsfc.nasa.gov/11901)
- [NASA Earth Observatory: Sunset from the ISS](https://earthobservatory.nasa.gov/images/44267/sunset-from-the-international-space-station)
- [NASA solar-imager artifact guide](https://science.nasa.gov/blogs/the-sun-spot/2019/02/08/artifacts-and-other-imaging-anomalies-taken-by-nasas-solar-imagers/)
