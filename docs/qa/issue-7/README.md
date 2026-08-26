# Issue #7 visual acceptance

These fixed-time screenshots use a deliberately exaggerated deterministic cryosphere fixture. They validate renderer semantics, not the scientific accuracy of a particular observed day; the scientific behavior is covered by the accumulation, melt, cloud-over-snow, darkness, sea-ice-boundary, and Southern fallback fixtures.

| Artifact | Scene | What it verifies |
| --- | --- | --- |
| `daylight-synthetic-cryosphere.jpg` | `?time=2026-06-21T12:00:00Z&view=day` | snow affects only detected land; sea ice affects only detected ocean; polar coverage follows the surface and remains separate from cloud |
| `terminator-synthetic-cryosphere.jpg` | `?time=2026-06-21T12:00:00Z&view=terminator` | both layers obey the astronomical terminator; snow does not glow on the night side; sea ice uses rough diffuse reflection rather than liquid-ocean glint |

Both scenes loaded the full immutable QA bundle through `latest.json`; browser logs contained no warnings or errors.
