# Real sky, Milky Way, and photographic Sun research

## Recommendation

Use two independent, inertial sky layers:

1. A discrete bright-star layer generated from the **Hipparcos Main Catalogue**, carrying real ICRS right ascension, declination, Johnson V apparent magnitude, proper motion, and B−V colour.
2. A very dim diffuse layer made from ESA/Gaia's **EDR3 all-sky colour map in equirectangular projection**, which supplies the unresolved Milky Way, dust lanes, star clouds, Magellanic Clouds, and other large-scale structure.

Neither layer should be a child of the Earth group. Earth rotates inside this fixed celestial frame. The Moon and Sun move independently through it.

The Sun should keep its physical ~0.5° photospheric disc for geometry and eclipses, but ordinary Earth-exposed imagery should render that disc as an overexposed white core with modest sensor bloom and a restrained optical flare. The optics must disappear when Earth fully occults the Sun.

### Implemented high-resolution variant

The 4000 × 2000 ESA outreach download is visibly undersampled in Terra's narrow 22° camera view. The implementation therefore uses CDS's official progressive **Gaia EDR3 colour flux map HiPS** (`CDS/P/DM/flux-color-Rp-G-Bp/I/350/gaiaedr3`). Four 8192 × 4096 CAR-projected quadrants were rendered through the CDS `hips2fits` service and assembled into a 16384 × 8192 equatorial texture. This preserves the Gaia registration and dust structure at approximately four times the linear resolution of the outreach image. The HiPS metadata identifies ESA/Gaia/DPAC as the underlying copyright holder and ODbL-1.0 as the HiPS licence.

## 1. Real-star catalogue

### Preferred catalogue: Hipparcos Main Catalogue

The ESA Hipparcos mission's main catalogue contains 118,218 stars. The catalogue is particularly suitable here because it includes the conspicuous naked-eye and bright telescopic stars, while Gaia EDR3 is explicitly incomplete at the bright end. The [ESA Hipparcos mission page](https://www.cosmos.esa.int/web/Hipparcos) describes the 118,218-star high-precision catalogue. The [CDS catalogue record I/239](https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/I/239?format=html&tex=true) documents the downloadable `hip_main.dat` fields:

- `RAdeg`, `DEdeg`: ICRS position at epoch J1991.25
- `Vmag`: Johnson V apparent magnitude
- `pmRA`, `pmDE`: proper motions in mas/year (`pmRA` is μRA cos δ)
- `B-V`: Johnson colour index
- `HIP`: stable Hipparcos identifier

The ESA catalogue page confirms that the original [Hipparcos-1 Main Catalogue contains 118,218 records](https://www.cosmos.esa.int/web/esdc/esasky-catalogues). The optical Hipparcos frame was the original optical realization of ICRS, according to the [IERS reference-frame history](https://www.iers.org/iers/en/dataproducts/icrf/icrf).

Bundle a build-time-derived compact subset, not a runtime network query. A threshold around `Vmag <= 7.5` gives headroom below normal naked-eye visibility without flooding the scene. Preserve the required source attribution and catalogue citation in the app's hover information/credits.

Gaia DR3 is an excellent alternative for fainter stars and offers `ra`, `dec`, `phot_g_mean_mag`, `bp_rp`, `pmra`, and `pmdec`; the official [Gaia DR3 table definition](https://gea.esac.esa.int/archive/documentation/GDR3/Gaia_archive/chap_datamodel/sec_dm_main_source_catalogue/ssec_dm_gaia_source.html) documents these fields. However, Gaia's own validation says that the catalogue is incomplete at the bright end and essentially complete only from G=12 to G=17 ([Gaia EDR3 completeness documentation](https://gea.esac.esa.int/archive/documentation/GEDR3/Catalogue_consolidation/chap_cu9val/sec_cu9val_introduction/ssec_cu9val_intro_completeness.html)). That makes Gaia alone a poor choice for the most recognizable stars. Gaia data are open and free to use with `ESA/Gaia/DPAC` credit under the [official Gaia credit terms](https://gea.esac.esa.int/archive/documentation/FPR/Miscellaneous/sec_credit_and_citation_instructions/).

### Proper motion and epoch

For Hipparcos epoch 1991.25 and display year `Y`, let `dt = Y - 1991.25`. For normal stars, a sufficient update is:

```text
dec_now = dec + pmDE * dt / 3_600_000
ra_now  = ra  + pmRA * dt / (3_600_000 * cos(dec))
```

Angles are degrees and proper motions mas/year. This correction matters most for a handful of nearby high-proper-motion stars; without it, most differences remain sub-pixel at this app's field of view. A production converter should instead update the full Cartesian direction/tangent vector so it remains stable near the celestial poles.

### Brightness and colour rendering

Apparent magnitude is logarithmic. Relative linear flux should follow:

```text
flux = 10^(-0.4 * (m - m0))
```

Use flux primarily for HDR intensity and only weakly for point size. Large discs make bright stars look like planets. Recommended treatment:

- all stars: sub-pixel/1-pixel Gaussian core where possible;
- brightest stars: small bloom halo, still centered on a catalogued point;
- do not give every star identical opacity or diameter;
- preserve B−V colour differences, but desaturate dim stars because human colour perception falls off at low light;
- clamp extreme blue/red display colours: catalogued colour is photometry, not a ready-made sRGB value.

The resulting constellations and relative brightnesses will be real. A B−V-to-display-RGB conversion is necessarily a visualization transform, not a reconstruction of a star's spectrum.

## 2. Real Milky Way layer

### Preferred asset: Gaia EDR3 all-sky colour map

ESA publishes [the colour of the sky from Gaia EDR3 in equirectangular projection](https://www.esa.int/ESA_Multimedia/Images/2020/12/The_colour_of_the_sky_from_Gaia_s_Early_Data_Release_32), specifically described as suitable for full-dome presentation. It combines measured total brightness with Gaia blue and red photometry from more than 1.8 billion stars. It contains the Milky Way plane and centre, dark interstellar dust, clusters, galaxies, and the Large and Small Magellanic Clouds.

The image is offered under **CC BY-SA 3.0 IGO or the ESA Standard Licence** with this exact credit:

> ESA/Gaia/DPAC; CC BY-SA 3.0 IGO. Acknowledgement: A. Moitinho.

The credit must remain visible and associated with the image. If the image is modified for the sky texture, retain the attribution and comply with the selected licence's adaptation terms.

This is a data visualization, not a single camera photograph. That is an advantage here: it has clean, complete sky coverage and documented equirectangular geometry. Render it at low intensity as unresolved background structure, then overlay the Hipparcos points. A slight low-pass filter or low-intensity presentation reduces duplicated point stars, but any modified asset should be documented as an adaptation.

### Photographic alternative

ESO publishes Serge Brunier's [6000 × 3000, 360° full-celestial-sphere visible-light Milky Way panorama](https://www.eso.org/public/images/eso0932a/), credited `ESO/S. Brunier`. ESO states that public images are normally [CC BY 4.0 and cleared for reuse with clear, visible credit](https://www.eso.org/public/copyright/). It is the more photographic-looking option, but it has disadvantages for a scientific sky renderer:

- it already contains resolved stars that would duplicate the catalogue layer;
- observations were assembled over several months and include transient Solar System objects such as Venus and Jupiter;
- the ESO page documents a 360° all-sky projection and horizontal Galactic plane, but not enough pixel-coordinate conventions to guarantee alignment without calibration.

Use the ESO panorama as a visual reference or carefully processed alternative, not the first choice for a coordinate-true composite.

## 3. Coordinate mapping and inertial behavior

### ICRS RA/Dec to this Three.js scene

The current app convention is:

- +Y: north celestial pole
- +X: RA = 0 h, Dec = 0°
- −Z: RA = 6 h, Dec = 0°

For right ascension `a`, declination `d`, and arbitrary large sky radius `R`:

```text
x =  R cos(d) cos(a)
y =  R sin(d)
z = -R cos(d) sin(a)
```

This is exactly the convention already produced by `latLonVector(dec, raDegrees, R)` in `src/main.ts`.

The star catalogue and Milky Way sphere must be attached directly to the **scene**, never to `planet`. Earth alone receives the sidereal rotation. Greenwich sidereal time is the right ascension crossing the Greenwich meridian; the [US Naval Observatory sidereal-time notes](https://aa.usno.navy.mil/data/siderealtime) give that observational definition. The IERS explains that modern Greenwich sidereal time combines Earth Rotation Angle with precession/nutation terms ([IERS Earth-rotation explanation](https://www.iers.org/iers/en/service/faqs/thenewiauresolutions/howstellaranglethetadifferfromgst-104-145)).

At this app's scale, the existing approximate GMST is adequate visually. For a standards-level implementation, use IAU SOFA Earth-attitude routines and UT1 rather than UTC; the [IAU SOFA cookbooks](https://www.iausofa.org/cookbooks) cover the reference-system and Earth-attitude transformations.

Behavior after the fix:

- Earth and its surface/cloud texture rotate once per sidereal day relative to the fixed star catalogue.
- The Milky Way remains registered to the stars.
- The Sun advances against the stars by roughly 1° per day through the year.
- The Moon advances independently by roughly 13° per day and has its own parallax/orbit.
- A Sun-tracking camera may slowly reframe the inertial sky, but must not drag the sky with Earth.

### Mapping the Galactic-coordinate panorama

ESA's Gaia documentation gives the ICRS-to-Galactic orthogonal matrix directly ([Gaia astrometric transformation documentation, Eq. 4.62](https://gea.esac.esa.int/archive/documentation/GEDR3/Data_processing/chap_cu3ast/sec_cu3ast_intro/ssec_cu3ast_intro_tansforms.html)):

```text
M_icrs_to_gal =
[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132]
[+0.4941094278755837, -0.4448296299600112, +0.7469822444972189]
[-0.8676661490190047, -0.1980763734312015, +0.4559837761750669]
```

For a panorama pixel interpreted as Galactic longitude `l` and latitude `b`:

```text
g = [cos(l) cos(b), sin(l) cos(b), sin(b)]
q_icrs = transpose(M_icrs_to_gal) * g
threeDirection = [q_icrs.x, q_icrs.z, -q_icrs.y]
```

Equirectangular files frequently differ in whether longitude increases left-to-right or right-to-left, especially because a sky sphere is viewed from the inside. Do not guess the U flip. Validate all three of these landmarks after mapping:

- Galactic centre: RA ≈ 266.405°, Dec ≈ −28.936°
- North Galactic Pole: RA = 192.85948°, Dec = +27.12825°
- Large Magellanic Cloud: approximately RA = 80.9°, Dec = −69.8°

The Gaia documentation defines the North Galactic Pole and longitude origin precisely and recommends vector/matrix transformations instead of spherical-angle shortcuts.

## 4. Sun appearance in space

### Geometry must remain physical

NASA states that the Sun subtends roughly half a degree from Earth ([NASA Basics of Space Flight](https://science.nasa.gov/learn/basics-of-space-flight/chapter1-1/)); a NASA eclipse calculation gives about 0.525° near aphelion ([NASA Solar Math](https://www.nasa.gov/wp-content/uploads/2013/05/solar_math.pdf)). Continue deriving angular radius from physical Sun radius and current Sun–observer distance. Do not enlarge the physical mesh to create glare.

### Photographic display model

The user's criticism of a flat white disc is visually correct even though a resolved, properly filtered Sun really is a disc. In a camera exposure that also shows Earth, direct sunlight overwhelms the sensor. NASA explains that very bright sources can saturate detectors, bleed along detector columns, bloom, and produce extended diffraction patterns ([NASA solar-imager artifact guide](https://science.nasa.gov/blogs/the-sun-spot/2019/02/08/artifacts-and-other-imaging-anomalies-taken-by-nasas-solar-imagers/)). NASA's astrophotography guide likewise notes that without strong filtration the solar disc is lost against glare, while filtering reveals a small disc comparable in angular size to the Moon ([NASA Astrophotography Guide](https://science.nasa.gov/wp-content/uploads/2023/09/Astrophotography_Guide.pdf)).

Recommended implementation:

1. Keep a depth-tested physical disc at the correct angular size for transits and eclipses.
2. Render it at very high **linear HDR radiance**, near neutral white (the photosphere is not yellow in space).
3. Let ACES tone mapping clip the center to white.
4. Add a modest post-process bloom around only above-threshold HDR pixels. The bloom is the main visible Sun; the geometric disc remains underneath.
5. Use only a short, aperture-like starburst. Long symmetric crosshairs look synthetic unless they match a chosen camera aperture.
6. Do not show a large visible corona in ordinary exposure. The corona is vastly fainter than the photosphere and normally requires an eclipse/coronagraph.

Occlusion is non-negotiable:

- the physical disc must depth-test behind Earth;
- post-process bloom must originate only from visible Sun pixels;
- lens-flare ghosts must be visibility-gated by an analytical camera-to-Sun segment/sphere test or a depth/occlusion query;
- when the Sun is fully behind Earth, all Sun bloom and flare disappear;
- at partial occultation, the exposed crescent may bloom around the limb, which is a plausible optical effect.

## 5. Subtle lens flare

Lens flare is not part of the Sun or space. It is internal reflection/scattering in a camera lens or spacecraft window. NASA explicitly identifies haze from Sun glare on Cassini's camera lens in a natural-colour image ([NASA/JPL Cassini “Glare on the Window”](https://science.nasa.gov/photojournal/glare-on-the-window/)). Therefore a restrained flare is realistic **for the implied camera**, not for a naked-eye astronomical view.

Recommended style:

- one faint broad veil around the Sun;
- optionally one or two extremely faint, desaturated ghosts along the line from the Sun through screen centre;
- no rainbow chain, oversized hexagons, or persistent flare when the Sun is off-screen;
- strength falls rapidly as the Sun leaves the frame and is zero when the camera faces away;
- flare responds to Earth occultation as described above;
- subtle chromatic variation is acceptable, but the core should stay neutral white.

Diffraction rays are also instrument-dependent. Their number and angle encode aperture blades or telescope supports rather than solar physics. The renderer may pick a photographic aperture identity, but should keep it restrained and consistent.

## 6. Dynamic-range caveat: “real view” versus a useful jewel

A single photographic exposure cannot simultaneously show:

- the directly visible Sun,
- detailed sunlit Earth,
- night-side city lights,
- and a rich Milky Way/star field.

The brightness range is too large. Spacecraft images expose for one regime, composite multiple exposures, or deliberately overexpose bright objects. NASA notes that spacecraft teams choose exposures for the scientific target and may intentionally overexpose bright bodies to reveal faint nearby objects ([NASA Cassini camera FAQ](https://science.nasa.gov/mission/cassini/faq/)).

Terra should therefore be described as **astronomically registered HDR**:

- all positions, angular sizes, rotations, and occultations are physically consistent;
- brightness is tone-mapped so Earth, stars, and the Sun remain legible together;
- when the Sun is in frame, automatically dim the Milky Way and most faint stars substantially;
- when looking away from the Sun or when it is fully eclipsed, let the viewer's simulated exposure/dark adaptation slowly reveal more of the Milky Way.

This is more honest and more convincing than pretending a saturated ISS-style Sun and a bright Milky Way can coexist in one normal exposure.

## Implementation acceptance checks

1. Orion, Ursa Major, Cassiopeia, Sirius, Vega, Arcturus, and the Southern Cross appear in their real relative positions.
2. Star brightness order is recognizably correct and star colours are subtle.
3. The Galactic centre, North Galactic Pole, and Magellanic Clouds align with the catalogue landmarks.
4. Over 10 simulated minutes, Earth rotates relative to the stars; the sky does not move with the Earth group.
5. Over a simulated year, the Sun moves against the fixed stars along the ecliptic.
6. The physical solar disc measures approximately 0.52–0.54° depending on date/distance.
7. Sun optics vanish completely during full Earth occultation and return smoothly during egress.
8. With the Sun visible, only brighter stars and a very subtle Milky Way remain; with the Sun hidden or behind the camera, sky exposure recovers gradually.
9. The hover credits include the selected catalogue citation and the exact required ESA/Gaia or ESO image credit.
