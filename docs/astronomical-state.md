# Astronomical scene state

TheMarble computes one geocentric astronomical state for each rendered time. `astronomicalStateAt(date)` owns the ephemerides and physical quantities; `celestialSceneFrameAt(date)` maps that state into the renderer's coordinate convention. Surface lighting, ocean glint, cloud lighting and shadows, atmospheric scattering, the Sun, and the Moon all consume the same frame. Hipparcos stars and the Gaia Milky Way remain fixed in the J2000 mean-equator (EQJ) sky while Earth rotates beneath them.

## Ephemeris model

The implementation pins Astronomy Engine 2.1.19. Astronomy Engine uses VSOP87 and NOVAS-derived models, documents accuracy within one arcminute, and tests its implementations against NOVAS and JPL Horizons. It supplies geocentric EQJ vectors, Greenwich apparent sidereal time, lunar phase and illumination, lunar libration, and IAU 2015 rotational elements.

Physical sizes are not screen-space decoration:

- astronomical unit: 149,597,870.7 km
- Earth equatorial radius: 6,378.137 km
- Moon equatorial radius: 1,737.4 km
- Sun equatorial radius: 695,700 km

The renderer places the Sun and Moon at their current geocentric distances. Their angular diameters therefore vary with distance; the solar diameter remains approximately 0.52–0.54 degrees over the year.

## Coordinate convention

Astronomy Engine's EQJ vector is `[x, y, z]`, where `x` points toward the J2000 March equinox, `y` toward right ascension 6h, and `z` toward the north celestial pole. TheMarble maps this to Three.js as:

```text
scene = [EQJ.x, EQJ.z, -EQJ.y]
```

The star catalogue and Milky Way already use this mapping. The Earth body transform combines Greenwich apparent sidereal time with the equator-of-date to EQJ rotation, including precession and nutation. The camera receives one initial EQJ placement and is then left inertial, so an untouched view watches Earth rotate instead of silently following the Sun. The Moon body transform uses its IAU north pole and prime-meridian angle, so the rendered texture presents the computed libration and pole orientation instead of always facing the camera.

UTC is the application time input. Greenwich rotation is therefore limited by the normal UTC–UT1 difference; UTC remains within 0.9 seconds of UT1. No screen-pixel tolerances are used.

## Verification

Deterministic tests use literal reference values for:

- 8 April 2024 at 18:00 UTC, during the total solar eclipse;
- 21 June 2025 at 12:00 UTC, near the June solstice.

Greenwich apparent sidereal time is compared with the US Naval Observatory. Geocentric ICRF right ascension, declination, distance, angular diameter, lunar illumination, phase angle, sub-observer libration, and lunar north-pole position angle are compared with JPL Horizons DE441. Position tolerances are bounded in degrees, astronomical units, and physical time—not screenshot pixels.

Primary references:

- [USNO Sidereal Time](https://aa.usno.navy.mil/data/siderealtime)
- [IAU SOFA Earth-attitude cookbooks](https://www.iausofa.org/cookbooks)
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
- [Astronomy Engine](https://github.com/cosinekitty/astronomy)
- [IAU Working Group on Cartographic Coordinates and Rotational Elements 2015](https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf)
