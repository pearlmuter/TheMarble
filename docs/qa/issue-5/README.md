# Issue #5 fixed-time visual verification

Captured from the Vite/WebGL renderer at 1280×720 on 25 August 2026 after the bundled manifest and all twelve seasonal image payloads had passed checksum, decode, and 5400×2700 dimension verification.

| Artifact | Fixed scene | Verification |
| --- | --- | --- |
| `august-day.png` | `?time=2026-08-25T12:00:00Z&view=day` | 5.4K surface sharpness, clean land beneath the independent cloud shell, water/land separation, summer state |
| `august-terminator.png` | `?time=2026-08-25T12:00:00Z&view=terminator` | shared astronomical Sun direction, terminator, city-light transition, restrained water reflection |
| `december-day.png` | `?time=2026-12-25T12:00:00Z&view=day` | distinct winter seasonal blend, snow/ice coverage, physical ocean, packaged fallback |
| `month-midpoint-before.png` | `?time=2026-08-16T11:59:59.999Z&view=day` | final instant of the July→August pair |
| `month-midpoint-at.png` | `?time=2026-08-16T12:00:00.000Z&view=day` | first instant of the August→September pair; no visible seam or calendar jump against the preceding artifact |

The fixed `time` and `view` query parameters are deterministic QA controls only; without them TheMarble continues to use the real current time and its normal physically positioned Sun-tracking view.

Surface source: [NASA Earth Observatory, Blue Marble Next Generation monthly base maps](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/).
