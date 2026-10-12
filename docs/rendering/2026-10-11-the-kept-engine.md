# The kept engine

A page that starts a second hike used to pay the first one's GPU work again:
every shader compiled anew, every WebGPU pipeline rebuilt, because each hike
built a fresh Babylon engine on a fresh canvas and the old engine — whose
context owned every compiled program — was disposed with the hike. Now the
engine outlives the hike, and the next one on the same page starts on it.

## What is kept, and when

When a hike ends, the renderer standing **retires** (`Renderer.retire`,
`renderer.ts`) instead of disposing: its scene goes — on the same terms as a
dispose, waiting for a BRDF lookup texture still expanding (`releaseScene`) —
and its engine, its render loop stopped, is handed to the page's keeper
(`keptEngine.ts`) with its canvas, its tier and, on WebGPU, the module's
watchers. The keeper holds one engine at a time; keeping a second releases
the first.

The next hike asks the keeper before making an engine (`hikeEngineFor`,
`main.ts`): the kept engine is taken only when it is the engine the WebGPU
rule gives that hike now — same kind, same tier, the adapter's verdict the
one read at load — and still standing. Anything else releases it: a hike that
will not use it needs its memory more. A WebGPU engine is handed on as the
hike's engine, as `main.ts` always gave one; a WebGL2 engine is left on its
canvas for the renderer to take up (`adoptEngine`), so "no engine given"
still means WebGL2 everywhere.

## The shaders

Babylon reference-counts each compiled effect and releases it — program and
all — when the last material using it goes, so a disposed scene would empty
the cache the keeper exists to preserve. So each effect is **pinned**: held
once more, per engine, the moment it has compiled cleanly (`pinShaders`,
swept on the engine's compile observable while the hike runs, and once more
at the retire). Pinned effects live until the engine goes. Only ready, clean
compiles are pinned — one still compiling is caught by a later sweep, one
that failed is released as it always was — and nothing is pinned on an
engine that will not outlive its hike.

Mid-hike pinning is what catches the programs whose materials are let go
before the end (a billboard bake's clone, a split LOD material): without it a
reused hike still compiled about 30 shaders.

## As measured

Three hikes in one page, headless Chrome on an Apple-silicon Mac, high tier,
WebGPU, the dev server:

- Shader compiles on a reused hike: **1–7**, from ~120 without the keeper.
- Async pipelines built on a reused hike: **0**, from ~70.
- Ready, second and third hikes: ~3.3–4.1 s, from ~3.7–4.5 s.
- Cost, after three hikes with garbage collection forced: ~20 MB of JS heap
  over a page that disposes the engine (the kept programs and their source
  text), the pinned mid-hike shaders themselves under 1 MB of it.

The downloads were already the browser's HTTP cache's business (the model
URLs are fingerprinted and served immutable); what the keeper saves is the
GPU side. The glTF parse, the texture transcode and the world build still run
per hike.

## The loading lines

The loading bar's model (`loadProgress.ts`) used to name one stage at a time,
the first unfinished in its order, which hid work running behind the named
stage. It now emits **one line per stage under way**, stacked in the stages'
order on the intro overlay, each line gone as its work ends; "ready" replaces
them all at the gate. The models stage can show two lines: the download
(bytes landed, of the catalog's total), and the decode — models whose bytes
are all in but whose parse (the glTF, the KTX2 transcode) has not settled —
which is the stage the bar previously had no word for.
