# Adaptive Earth presentation tiers

TheMarble publishes presentation assets separately from scientific processing. A verified Earth-state manifest remains the scientific source of truth; the presentation publisher derives coherent GPU-ready bundles without changing observation times, datasets, provenance, coverage, or physical semantics.

## Production command

Install the Khronos KTX-Software `toktx` encoder, then run:

```sh
npm run publish:presentation-tiers -- \
  --source artifacts/earth-state/latest-scientific/manifest.json \
  --output artifacts/earth-state \
  --toktx /absolute/path/to/toktx
```

The publisher verifies every source checksum before processing it. It creates an 8192×4096 baseline tier and, when the surface source is at least 16384×8192, a 16384×8192 high tier. Lower-information layers retain their justified native dimensions instead of being enlarged. Every image texture is encoded once as mipmapped KTX2/Basis Universal (high-quality UASTC with Zstandard supercompression); JSON catalogues remain JSON.

Publication fails when the surface source cannot honestly support 8K. It never labels interpolation or enlargement as additional Earth detail.

## Client selection

The client ranks complete bundles using only explicit capabilities:

- WebGL maximum texture dimension;
- a decoded GPU-memory allowance;
- a transfer allowance derived from measured connection bandwidth or a conservative default;
- KTX2/Basis Universal decoder availability;
- the available desktop cache allowance in Tauri.

It does not inspect user-agent strings, GPU names, or product names. A capable client tries 16K first and retains 8K as a fallback. If download, checksum verification, KTX2 transcoding, texture allocation, or scene preparation fails, the client retries the complete lower tier. It never activates a surface from one tier with clouds or cryosphere from another.

## Declared budgets

Each presentation index records these budgets for every tier:

- time to first coherent globe;
- compressed transfer bytes;
- decoded, block-compressed GPU bytes including mip chains;
- shader compilation time;
- minimum sustained frame rate;
- cloud crossfade GPU overhead;
- complete desktop cache bytes.

The Tauri cache is capped at 384 MiB. It evicts complete verified bundles and refuses a selected tier larger than the cap without disturbing the previous usable bundle. The web and Tauri clients consume the same tier manifest, so their scientific meaning is identical.

The production endpoint is `earth-state/latest-presentations.json`. Until that endpoint is deployed, the application continues to use the verified legacy remote state and then the packaged fallback.
