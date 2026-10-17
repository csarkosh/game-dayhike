# The painted look: one art direction over the photoreal world

**Question:** the world is lit and built to read as photoreal, and its parts
were tuned one at a time (the sky, the water, the rocks, the forest shade, the
far field), so the frame does not yet read as one picture under one hand. The
direction asked for on 2026-10-17 is a painted scene in dreary tones, after
landscape painting in oils: Shishkin's pine edge at evening, a dark oak over
a lit sky, a stream under an overcast sky with the trees nearly black
against it. What of a painting can a post chain lay over a photoreal render
without giving up the render?

## 1. What the paintings share

Three things, which are the three parts of this work:

1. **Value over hue.** The pictures are built on a wide tonal range, deep
   warm darks against a luminous sky, and the colour sits inside that range
   muted: olive and sage greens, umber shadows, cream and grey-blue lights,
   nothing at a monitor's saturation.
2. **A warm, drained palette.** Shadows go to umber and brown, not to black
   and not to blue; midtones to olive; highlights to cream. The whole frame is
   a quarter less saturated than a photograph, and its blacks are a warm grey
   a shade above black.
3. **Strokes, not pixels.** Fine texture is gone, replaced by strokes that
   keep the edges: the bark's grain is a few marks, the grass a field of
   strokes, the sky a wash. Edges between regions stay sharp; detail inside a
   region does not.

## 2. What the chain had

The restyle of 2026-09-15 (`2026-09-15-atmosphere-restyle-design.md`) set the
identity: a physically based world, a height fog, a neutral tone map (AgX),
one grade pass (split-tone by mood, saturation, lift, vignette, halation) and
a film finish (grain, dither, the peripheral overlap). Its grade is zero at
`clear`: a sunny frame is the render as it comes, and the violet-and-teal
split-tone rises with cloud, mist and dread. So the frame has a mood axis but
no base identity: at clear it is a photograph.

## 3. As built (2026-10-17)

- **The painted base** (`grade.fragment.fx`, the `PAINT_*` constants): a
  constant split-tone every frame wears under the weather's, applied right
  after the tone map and the Purkinje shift: shadows pulled toward an umber
  (0.30, 0.25, 0.19) at density 1.0, midtones toward an olive sage (0.60,
  0.58, 0.44) at 0.7, highlights toward a cream (0.98, 0.94, 0.84) at 0.7,
  each band's saturation eased, then the whole drained by 12 %, its values
  widened by 22 % round middle grey for everything the eye reads as lit (the
  deep shadow is left where the render put it, so a dark evening stays
  readable), and its blacks lifted a shade to a warm grey (0.006, 0.0055,
  0.005). The weather's bands lay over it as before, so the eerie identity
  (violet shadows, teal midtones) still rises with the mood. A first pass at
  densities of 1.6, 1.2, 1.0, a 22 % drain and a lift of 0.045 read as a
  washed grey print, and a contrast gain over the whole range put the eerie
  evening under black: the paintings keep their darks and their darks stay
  legible.
- **The paint pass** (`paint.fragment.fx`, `post.ts`): a generalized Kuwahara
  filter after Kyprianidis, Kang and Doellner (2009), without the anisotropy:
  the window round each pixel cut into eight round sectors, each sector's
  mean and variance taken with a weight that falls off across the sector and
  with distance, and the pixel the means blended by how flat each sector is,
  so an edge is kept where the sectors on either side of it disagree and the
  texture inside a region flattens into a stroke. It runs first in the chain
  (after the far softening where there is one), on the scene's linear colour
  before the halation's extract and the grade, so the halo and the colour
  identity are taken from the painted frame, at ratio 1 with the chain's
  multisampling on its input, blended four fifths over the rendered frame.
  The stroke radius is the tier's (`postParams.ts`: 3 px on high, 2 on
  medium, at 675 rows, scaled with the frame's height between 2 and the
  loop's reach of 6, the window bounded by the radius so a 2 px stroke reads
  25 taps); the low tier, which has no chain, has no strokes. A first pass at
  5 px wholly replacing the frame turned the crowns against the sky into
  blotches with holes and the near grass into mush: the stroke must stay
  under the size of the smallest thing the picture is made of.

Nothing in the world changed: no material, no light, no fog.

## 4. Measured

| Pose, tier | Before | After |
|---|---|---|
| meadow, medium | 49.0 fps | 45.0 fps |

On this Mac (the `apple-base` class, Chrome, WebGPU), 1200 by 675, frames
counted over 15 s after 30 s of settling: about 1.8 ms for the pass at 2 px
and the base. The rig pairs are owed.

## 5. What a player sees

The trailhead at the opening is a wash of olive and umber under a grey sky,
the trunks dark marks, the grass a field of strokes, the path a pale band.
In the eerie evening the violet and teal of the mood sit on the painted base
rather than on a photograph. The HUD, the roster and the pause menu are drawn
over the chain and keep their pixels.

## 6. Left for later

- The world under the chain: the sky's and the fog's colours, the sun's
  warmth and the materials' albedos were fitted to a photograph and could
  move toward the palette, so the base has less to do.
- An anisotropic Kuwahara, with the strokes following the image's
  structure tensor (bark along the trunk, grass along the blade), which is the
  2009 paper's own method and about twice the cost.
- A canvas: the finish's grain as a paper tooth rather than film grain.
- The frame pairs on the reference machine and the Windows rig, and the
  medium tier's radius against its cost.
