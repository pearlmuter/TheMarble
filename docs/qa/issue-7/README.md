# Issue #7 visual acceptance

These fixed-time screenshots use a deliberately exaggerated deterministic cryosphere fixture. They validate renderer semantics, not the scientific accuracy of a particular observed day; the scientific behavior is covered by the accumulation, melt, cloud-over-snow, darkness, sea-ice-boundary, and Southern fallback fixtures.

| Artifact | Scene | What it verifies |
| --- | --- | --- |
| `final-daylight.png` | `?time=2026-06-21T12:00:00Z&view=day` | the final renderer consumes the scientific snow and sea-ice masks directly rather than guessing land/ocean from Blue Marble colour |
| `final-terminator.png` | `?time=2026-06-21T12:00:00Z&view=terminator` | both layers obey the astronomical terminator; snow does not glow on the night side; sea ice uses rough diffuse reflection rather than liquid-ocean glint |

Both scenes loaded the full immutable QA bundle through `latest.json`; browser logs contained no warnings or errors.
