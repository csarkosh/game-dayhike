# Rock relief: fractured rock instead of a textured loaf

The rock and boulder models read as smooth loaves with a rock texture on
them. The models are not low-poly (550 to 3,200 vertices at LOD0) and every
one carries a normal map, but a probe showed the map contributes nothing
visible: switched off, the rock looks the same, and so does adding specular.
The shape is smooth, so there is nothing for shading to work against. This
design cuts the shape at load — planar fractures, flat facets, a little
roughness — in code, on the meshes as they are.

It changes how the rock and boulder meshes are built at load and nothing
else: no other clutter class, no ground paint, no collision.

## 1. Rulings

| question | ruling |
| --- | --- |
| The kind of rock | Fractured and angular: planar facets and sharp edges, as rock split along joints |
| Variety | Four cuts per model, instances spread across them by hash |
| Approach | Planar cuts with flat shading, run once at load in code; no new assets, no material change beyond vertex colour |
| Cost | No per-frame bar of its own: a 4× pixel pair at TRAILSIDE and EDGE against `main` within noise (≤ +0.3 ms); the load-time pass under 50 ms for all thirty-two cut meshes (sixteen buckets, each at the near and the far LOD) |

## 2. Goals and non-goals

Goals:

- Rocks and boulders read as three-dimensional at the distances players see
  them: facets that catch the light differently from their neighbours, an
  angular silhouette, a normal map with faces to sit on.
- The artist's silhouettes stay recognisable; a cut removes material and
  never adds it.
- No pop at a LOD swap, and no change to collision. The sim's boxes are not
  touched — but see §3 for the one place the cut moves the MESH away from a
  box that stays where it was.

Non-goals:

- The ground's rock and scree paint.
- New models. The pass runs on the shipped GLBs.
- Boulder placement or density.

## 3. Architecture

| unit | layer | does |
| --- | --- | --- |
| `rockRelief.ts` (new, Babylon-free) | game | the cut: planes, projection, unweld, face normals, roughening, facet luma — on plain vertex arrays |
| `clutterMeshes.ts` (changed) | game | runs the pass on each rock and boulder LOD mesh as its GLB lands, four cuts per model; a cut dimension in the rock and boulder buckets; vertex colours on for those materials |

The sim is untouched and no level id changes. Small rocks are not colliders at
all. Boulder collision boxes are constants the clutter pass declares, and a
mesh that only removes material stays inside them.

Staying inside them is not the same as still matching them, and the difference
is worth stating rather than leaving for a reader to infer. A boulder's box
runs from the ground to `BASE_H · scale · (1 − BOULDER_SINK)` — the height of
the UNCUT mesh's visible top. Whatever a cut takes off the top is therefore
box standing above stone. Measured on the shipped models: `boulder_a`'s top is
untouched in all four of its cuts, and `boulder_b` loses 11.3 % of its height
in cut 0 and 2.5–2.8 % in two others, which at the largest instance scale the
sim draws is **up to 0.29 m of collider above visible rock**. Accepted rather
than fixed: it is inside the ~0.15 m the box's own comment already allows for
ground tilt at model scale, a 2.6 m boulder is not something a hiker climbs,
and the alternative — narrowing `ROCK_DEPTH` — would spend the cut variety
this pass exists to buy. So "renderer-only" here means the simulation is
unchanged, NOT that what the player sees and what they collide with still
agree everywhere. See the verification note's follow-ups for the cheap way to
close it.

## 4. The cut

For each model and each of the four cuts, on the LOD0 vertex arrays, then
LOD1 and LOD2 with the same planes:

- **Planes.** `ROCK_PLANES = 10` seeded planes: a random unit normal from the
  (model, cut, plane) hash and a depth between `ROCK_DEPTH = [0.08, 0.28]` of
  the model's half-extent along that normal. Every vertex beyond a plane is
  projected onto it: `p' = p − (p·n − d)·n` for `p·n > d`. The cap flattens
  into a facet with a sharp edge where it meets the untouched surface.
- **Skip rule.** A plane whose cap would hold fewer than 3 % or more than
  35 % of the vertices is skipped. That keeps the silhouette the artist made
  and avoids sliver caps.
- **Unweld.** Every triangle gets its own three vertices; positions, UVs and
  the original-position key are copied.
- **Face normals.** Each triangle's geometric normal, unit, on all three of
  its vertices.
- **Roughen.** Each vertex moves along its face normal by
  `ROCK_ROUGH · halfExtent · (2·noise(original position) − 1)`. The noise is
  a value noise of the vertex's *original* position, so the two sides of a
  shared edge move together and no crack opens.
- **Facet luma.** A vertex colour of `1 ± ROCK_LUMA (0.08)` by the triangle's
  hash, the same on its three vertices, so adjacent facets differ in tone.
- **UVs** are kept; a cap's texture stretches a little, which reads as a
  fresh face. **Tangents** are dropped: the PBR material derives them per
  pixel when none are supplied, and the normal map works on the facets.

Deterministic in (model, cut). Output: positions, normals, colours, uvs and
indices.

## 5. LODs, colliders and buckets

The same plane list cuts a model's three LODs, so a swap changes detail, not
shape, and the existing dither seam hides it.

In `clutterMeshes.ts` the rock and boulder classes gain a cut dimension: an
instance's cut is `hash & 3`; its bucket is `[class][variant][cut][lod]` —
32 buckets where there are 8. The GLB's mesh is cut four ways as it lands and
the four results become the four cut buckets' meshes, sharing the model's
material with `useVertexColors` on. Every other class is untouched.

## 6. Tests

Pure, on a synthetic icosphere and on the real model arrays (loaded through
the same path the tests already use for GLB-backed classes):

- every output vertex lies inside the original hull (its distance from the
  centroid along its own direction never exceeds the input's);
- the planes' count and depths are inside their bands and the skip rule
  holds (no cap under 3 % or over 35 %);
- a cut produces at least six distinct facet normals (clustered at 5°);
- vertices = 3 × triangles after unwelding; every normal is unit and equals
  its triangle's geometric normal; the roughening keeps shared-edge vertices
  coincident;
- the same (model, cut) yields identical arrays twice; two cuts differ;
- LOD1 is cut with LOD0's plane list;
- facet luma stays within ±8 % and is equal on a triangle's three vertices;
- in `clutterMeshes`: one model's instances spread across four cuts by hash
  and each cut bucket's count equals its share; the materials carry vertex
  colours.

## 7. Gates

Before/after against `main`, sun pinned, pages blanked:

- a rock at 2 m and a boulder at 4 m (the boulder found by a scan of the
  boulder class near a gate pose), clear noon and mist — the pass/fail by
  eye: facets and edges visible, an angular silhouette, not a loaf;
- a LOD-swap walk at the boulder, three stills, no pop;
- the 4× pixel pair at TRAILSIDE and EDGE within noise; the load-time pass
  timed once in the verification note.

## 8. Fallbacks

In order: planes 10 → 6; the depth band narrowed toward 0.08; the facet luma
off.

## 9. Follow-ups

- Moss and lichen on the north faces of facets, as a vertex-colour tint by
  facet normal.
- Cut the ground's scree paint to match, so a boulder and the scree it sits
  in agree.

## Amendments

What the build settled that this spec's earlier sections stated differently:

- **Two LODs, not three.** The clutter shell only ever draws `LOD0` (near) and
  `LOD1` (far) for any class — `LOD2` is loaded with every GLB but never
  bucketed, the same as for every other clutter class. The cut runs on the
  two LODs the shell actually draws; §5's "the same plane list cuts a model's
  three LODs" should read "two".
- **Roughening moves along the vertex normal, not the face normal.** §4 said
  roughening displaces "along its face normal". It displaces along the
  *input's own vertex normal* instead: two triangles sharing an edge disagree
  on their face normal but agree exactly on the vertex normal at the vertex
  they share, so moving both triangles' copies of that vertex by the same
  amount in the same direction keeps them coincident and no crack opens. The
  face normal is still what is written to the output for shading, unchanged.
- **The roughening amplitude scales by each vertex's own distance from the
  centroid, not the model's half-extent.** A rock is rarely a sphere, so
  vertices sit at widely different distances from the centroid. Scaling the
  push-back by the model's half-extent (a single global number) let a vertex
  closer in than the model's extreme point come out farther from the
  centroid than it started — the shrink pulled it in by less than the
  roughening could push it back out. Scaling by that vertex's own distance
  makes the shrink and the push-back bound each other by the triangle
  inequality, for every vertex, proving "a cut only removes material" for an
  irregular mesh rather than only for a sphere (where the two scales
  happen to agree).
- **A cut is `Math.floor(hash * cuts)`, not a bitmask on the hash itself.**
  §5 wrote an instance's cut as `hash & 3`. The instance's hash is a unit
  float in `[0, 1)`, and bitwise operators coerce their operands to 32-bit
  integers first, so masking the float directly would coerce every hash to 0
  and put every instance in cut 0. Scaling the hash up into the cut range
  before taking the floor is what actually spreads instances across the four
  cuts; a trailing mask against `cuts - 1` is kept as a cheap, harmless clamp
  since `cuts` is a power of two.
- **The plane list is keyed on a model index unique across both cut classes,
  not on the per-class variant alone.** Rock's and boulder's own first
  variant are each "variant 0", and keying `rockPlanes` on the bare variant
  handed both the same cut-plane directions — a coincidence hidden by the two
  classes' different geometry, but less variety than intended. The shell
  keys the plane list on `cls * 16 + variant` instead, so every model across
  every cut class draws its own seeded planes.
- **A plane's depth is measured along its own normal, not against one global
  radius.** §4 offsets a plane by `ROCK_DEPTH` of "the model's half-extent
  along that normal", and the build read that as the half-extent — the largest
  distance from the centroid to any vertex, whichever direction it lay in.
  Those two readings agree only on a sphere. On the shipped models, which run
  two to three times longer on one axis than another, the global reading put
  nearly every plane outside the surface, left its cap empty, and had the
  cap-share floor drop it: 7 of 160 candidates survived at the near LOD and
  ten of the sixteen cut buckets kept none at all. A plane is now offset by
  the model's support distance along that plane's own normal, which is the
  same bite on any shape and the same plane as before on a sphere. 135 of 160
  survive; the weakest bucket keeps six.
- **The cap-share floor is 2 %, not 3 %.** With the offsets measured per
  direction, a 3 % floor still left `boulder_a` under the six distinct facet
  planes §6 asks for. Planes kept per cut, out of ten candidates, at 3 % and
  then at 2 %: `boulder_a` 4→6, 5→8, 5→7, 7→8; every other model was already
  clear and barely moves — `rock_a` 10/9/10/10 → 10/10/10/10, `rock_b`
  9/8/10/10 → 10/9/10/10, `boulder_b` 9/10/9/10 → 10/10/9/10. The change is
  confined to the three `boulder_a` buckets that were failing the design's own
  floor; a 2 % cap on the smallest of these models is still eleven vertices,
  which is a facet and not a sliver.
- **The cap-share rule runs once, on LOD0, and both LODs are cut with what
  survives it.** §5 shares "the same plane list" between a model's LODs, and
  the build shared the CANDIDATE list while each LOD applied the rule to its
  own vertices. Two levels of one rock carry different vertex counts and
  different distributions, so one plane could fall either side of the floor
  for the two of them, and the rock changed shape rather than detail when its
  LOD swapped. `rockPlanes` now returns the survivors and the shell hands that
  list to both levels.
- **The roughening displaces inward only; there is no shrink step.** §4 shrank
  the whole model by `ROCK_ROUGH` toward the centroid so that a two-sided
  roughening could push back out without leaving the original hull. The shrink
  cost every model 2 % of its reach in every direction — enough to lift a
  prop's flat underside out of the 2 cm of ground it is sunk into, and to pull
  a boulder's top away from the collider box sized around the uncut mesh. A
  one-sided inward displacement needs no shrink, keeps the extremes where the
  artist put them wherever the noise is quiet, and roughens by the same
  amplitude. A final clamp returns any vertex to its own starting radius,
  which matters because "inward along the vertex normal" is only "inward
  toward the centroid" where the surface is convex.
- **Plane offsets are absolute, not centroid-relative.** A plane carries its
  distance from the model's origin, so one list cuts a model's two LODs
  identically however their centroids differ.
