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

Capability selection is only a preflight filter. Before a candidate tier becomes visible, the client uploads every texture in that tier, verifies the two active surface frames at the tier's exact dimensions and color-sampling settings, and renders the complete live Earth scene off-screen at a fixed 1440×900 workload. The qualification includes a two-frame warm-up and 24 measured frames with a GPU synchronization barrier. The candidate must meet its shader-compilation, sustained-frame-rate, and end-to-end time-to-first-coherent-globe budgets on the machine that is actually running TheMarble. A failing candidate's GPU textures are released before the next complete tier is prepared.

This on-device qualification applies identically in the website and Tauri builds. It deliberately avoids model-name guesses: an integrated-GPU machine that cannot sustain 16K receives 8K, while a capable desktop receives 16K only when the real renderer proves it can carry the complete presentation. The unit profiles exercise both selection paths and the atomic cleanup ordering; production acceptance should additionally load a published index on at least one representative integrated-GPU system and one capable desktop, then confirm the selected `-8k` or `-16k` bundle in the hidden data-provenance panel.

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
