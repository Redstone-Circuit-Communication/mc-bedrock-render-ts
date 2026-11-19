# Source and license of this data

The four JSON files in this folder (`blockShapes`, `blockShapeGeos`, `blockStateDefinitions`, `blockEigenvariants`) come
from the `file/*.jsonc` files of **neoHoloprintDB 0.2.4 (20261028)**. The conversion (`scripts/import-holoprint-data.mjs`)
strips comments and trailing commas and applies these changes, explained in `docs/HOLOPRINT.md`:

- `blockStateDefinitions`: a rotation table for `torch,redstone_torch`;
- `blockShapes`: `cross_texture` for `golden_dandelion`;
- `blockShapes` and `blockShapeGeos`: a shape for `sulfur_spike`, which the data does not include, modelled on pointed
  dripstone.

Everything else is unchanged.

- The original block geometry data and its parsing logic are from **HoloPrint** by SuperLlama88888,
  https://github.com/SuperLlama88888/holoprint.
- neoHoloprintDB, credited to Purple Rain, adapts that data to the MCvox workflow; its JSON fields have been adjusted for
  that purpose.
- The license is **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**, full text in
  `LICENSE-HoloPrint.txt`:
  - Attribution: products using this data must credit HoloPrint and neoHoloprintDB;
  - NonCommercial: no selling, and no placement behind ads or paywalls;
  - ShareAlike: adaptations of this data must be released under the same license.

`src/renderer/holoprint/geo.ts` is a TypeScript port of HoloPrint's `BlockGeoMaker.js` (in the neoHoloprintDB edition) and
is covered by the same license.
