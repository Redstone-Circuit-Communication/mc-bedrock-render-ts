# How the reference library flint models scenes

flint v4.4.0 is a WebGPU path-tracing renderer (radiance cascades global illumination, FSR3 upscaling, BVH). Conclusions
after reading it:

**It has no block or entity shape data**: no NBT, palettes or bones, and no definitions for stairs, fences and the like,
only the rendering side of a scene. The code that turns blocks and entities into boxes lives in the application that uses
it (a comment in `flint.js` mentions redstonifyNBT), not in the library.

## Its scene representation

- **Boxes** are its only geometry: axis-aligned boxes (`pos` + `size`), boxes rotated by a quaternion, and boxes under any
  3×3 matrix. Transforms are operations on box instances (translate, quaternion, matrix, Euler angles, grow or shrink);
  once baked, a box's bounds are computed and it goes into the BVH.
- Each box has 6 faces, each `{ origin, uAxis, vAxis, layer, materialInstID }`: the start in the texture atlas, the u and v
  axes (signed pixel vectors, so flips and 90° rotations only swap axes), the atlas page and the material instance.
- Face order (from `testIntersectionWithBox`): −X, +X, −Y, +Y, −Z, +Z, that is west, east, down, up, north, south. The UVs of
  each face:

  | Face | u | v (top to bottom) |
  |---|---|---|
  | −X west | z ascending | y descending |
  | +X east | z descending | y descending |
  | −Y down | x ascending | z descending |
  | +Y up | x ascending | z ascending |
  | −Z north | x descending | y descending |
  | +Z south | x ascending | y descending |

  Checked one by one: `FACE_VERTS` and `defaultUv` in this package's `face.ts` agree with the table, so nothing changes.

## Its 6 materials and their counterparts here

| flint | What it does | This package |
|---|---|---|
| `Builtin_Basic` | the texture as is | default |
| `Builtin_ColorMul` | texture × colour | vertex colour (shade × tint) |
| `Builtin_Linear` | texture × a + b | not needed |
| **`Builtin_MaskedColorMul`** | tints only where the texture's alpha marks it, output opaque | **borrowed**: `grass_side|mask:grass`, tinted while building the atlas |
| `Builtin_Sequence` / `SequenceColorMul` | animation frames (interpolated) | not done: water, lava, fire and portals show their first frame |
| MERS textures | metalness / emissive / roughness | not needed: rasterization draws diffuse only, and loading a pack skips `_mers` and `*_normal.tga` |

## Checked against the real resource pack

Bedrock's `grass_side` is exactly the masked-tint case: 211 of its 16×16 pixels have alpha 0 and hold the dirt colour
(average 130, 93, 65); 45 pixels have alpha 255 and are the grey grass edge (155). In the game the side is `grass_side`
tinted by the biome, not `grass_side_carried` (the pre-coloured version used in hand). This package used the latter before,
so the sides did not match the green top.

Not every transparent texture is a mask: leaves, candles, vines and others have white RGB where they are transparent; only
`grass_side` stores meaningful colour there. So the rule is enabled for it alone rather than made general.
