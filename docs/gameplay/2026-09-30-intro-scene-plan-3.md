# The intro scene, part 3: the film's car and ranger, on a 72 s film — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The scene route plays the intro as the film will be recorded: 72 s long, on the film's own car (its wheels turning, its steering wheel following the road, its door opening, its handset lifted and put back) and the film's own ranger (seated at the wheel, reaching, talking, stepping out, facing the trail), with the call's captions on the recorded lines' times; the route runs on the engine a hike gets, holds no wildlife, and says when its models have loaded; a hike neither loads nor counts the film's two models.

**Architecture:** The pure scene data (`intro.ts`, `roadPath.ts`, `timeline.ts`) gains the 72 s timeline, the car's steering and handset state, and an actor's clip blend and anchor (a joint the stage places at a point); the stage (`sceneStage.ts`) spins the wheels about their axles, turns the steering wheel about its column, carries the handset in the ranger's hand, and places an anchored actor by its joint; the character pool (`characterModel.ts`) gains a blended pose and a joint lookup; the route (`sceneRoute.ts`, `main.ts`) gains `ready`, the hike's engine choice and a renderer with no wildlife; `assetUrls.ts` counts a hike's models without the catalog's film-only entries.

**Tech Stack:** TypeScript, Babylon.js 9.18, Vite, vitest (Node, NullEngine), the chrome-devtools CLI for the look.

**Spec:** `docs/gameplay/2026-09-29-intro-scene.md` — §2 (the scene player), §3 (the shots and the script, amended by Task 7 for the 72 s film), §6 (the recording interface), §8.1, §9. Parts 1 and 2 are on `main`.

**Where:** the worktree `.claude/worktrees/intro-assets` (branch `worktree-intro-assets`, off `origin/main` `65ed63e`), which holds the exported `client/assets/catalog.json`, `client/assets/models/intro.car.glb`, `client/assets/models/intro.ranger.glb` and `CREDITS.md`, not yet committed (Task 1 commits them).

## Global Constraints

- The sim and the wire are never touched: no file under `client/src/sim/` changes; the level id does not move (spec §9). The route builds `createWorld(level, seed, false)`, syncs `renderer.sync(world.state, -1, 0)` and never steps, applies or inputs the world (the architecture test pins these strings).
- The film is 72 s: shots at [0, 9], [9, 15], [15, 30.6], [30.6, 38.4], [38.4, 48], [48, 55], [55, 62], [62, 72]; every shot's field of view within [0.10, 0.57] rad but the cab shot (0.9); depth of field only on the handset insert (spec §2, §3 as amended).
- The call's ten lines at the recorded times: line *n* from its start to line *n + 1*'s start, line 9 in two at the pause before "If anything"; at most 42 characters a line and two lines, no faster than 20 characters a second, dispatch's marked radio (spec §3).
- A missing model, part or joint plays on without it and says so once; a scene never fails to play because an asset is absent (spec §2).
- The film's models (`intro.car`, `intro.ranger`) carry `scene: "intro"` in the catalog; a hike neither loads nor counts them.
- Every numeric test expectation is a literal; explicit time limits go through `timeLimit(<ms>)`. UI: a pure model and a dumb renderer, `textContent` only. Nothing in code, comments, docs or commit messages describes how an asset is made or names the process that made it.
- Every model load goes through `loadContainer` inside `loadUntilAborted`.
- Before any push: `npm run typecheck && npm run lint && npm test`, and the repository's pre-push scan.

## Review Focus

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **A seek backward across the call** (from 60 s to 10 s). The handset is back in its cradle, the ranger back at the wheel: everything is a function of *t*, nothing is left where the later frame put it (Task 3, "puts the handset back in its cradle on a seek backward").
2. **A clip time past the end of a clip that does not loop** (the reach, the stand-up). It holds its last frame rather than starting over (Task 5, "holds a clip that does not loop at its last frame").
3. **The film's ranger or car never arrives.** The scene plays with the part absent and one warning; `ready` still resolves (Task 6, "resolves ready once the loads have settled, arrived or not, says its engine, and holds no wildlife").
4. **An anchored joint the model lacks.** The actor is placed at its base position and one line is said; nothing throws (Task 4, "places an actor at its base when its anchor's joint is missing").
5. **WebGPU refused on the route.** The route plays on WebGL2, as a hike falls back: `engineFor` hands it WebGL2 and the route runs on whatever engine it is given, saying which (Task 6, "resolves ready once the loads have settled, arrived or not, says its engine, and holds no wildlife"; the look in Task 8 reads the engine a real page got).

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/game/assetUrls.ts` | `MODEL_COUNT`: the models a hike loads, the catalog's `scene` entries left out. |
| `client/src/game/scene/intro.ts` | The 72 s timeline, the drive to the stop at 55 s, the call's captions, the car's handset state, the ranger's clips, blends and anchors. |
| `client/src/game/scene/timeline.ts` | `CarPose` gains `steer`, `wheelTurn`, `handset`; `ActorPose` gains `blend` and `anchor`. |
| `client/src/game/scene/roadPath.ts` | The car's front wheels and steering wheel from the road's curvature; the film car's wheel radius. |
| `client/src/game/scene/sceneStage.ts` | The car's parts (wheels about their axles, front wheels steered, the steering wheel about its column, the handset in the hand or the cradle), an actor's blended pose and anchor. |
| `client/src/game/characterModel.ts` | `CharacterInstance.pose` with a blend, `CharacterInstance.joint`. |
| `client/src/game/scene/sceneRoute.ts` | `dayhikeScene.ready`, the engine it is given, a renderer with no wildlife, the hand the handset rides. |
| `client/src/game/renderer.ts` | `RendererOptions.wildlife`. |
| `client/src/main.ts` | The scene route on `engineFor`'s engine. |
| `docs/gameplay/2026-09-29-intro-scene.md` | §3 amended: the 72 s film. |
| `docs/gameplay/2026-09-30-intro-film-staging.md` | The look at the route with the film's models, and the numbers it set. |

The car's frame, used throughout: metres, the car facing +z, its left (the driver's side) at −x, the ground at y 0; a point `p` in it is at `(car.x + p.x cos yaw + p.z sin yaw, car.y + p.y, car.z − p.x sin yaw + p.z cos yaw)` in the world, as `follow` in `shots.ts` places a camera. Measured on the exported `intro.car.glb` in that frame: the steering wheel's centre at (−0.411, 1.034, 0.594), its column along (0.871, −0.491, 0) in the part's own frame; the front wheels at z 1.326 and the rear at −1.349 (a 2.675 m wheelbase), radius 0.348 m, each spinning about its own z; the driver's door hinged at its front edge; the cradle at (−0.039, 0.784, 0.744). Measured on `intro.ranger.glb` in the model's frame: in the first frame of `drive` the chest 0.424 m above the hips; the model's joints the scene places by ship as `hips`, `chest` and `hand_r`; standing at the end of `door`, the hips 0.95 m above the feet's ground.

---

### Task 1: The film's models in, and out of a hike's count

**Files:**
- Modify: `client/src/game/assetUrls.ts:113`, `client/src/game/modelLoad.ts:45-48` (the comment)
- Test: `client/test/game/assetUrls.test.ts`
- Commit also: `client/assets/catalog.json`, `client/assets/models/intro.car.glb`, `client/assets/models/intro.ranger.glb`, `CREDITS.md` (already in the worktree)

**Interfaces:**
- Produces: `MODEL_COUNT` = the models a hike loads (42 today); the catalog entries `intro.car` and `intro.ranger` with `scene: "intro"`.

- [ ] **Step 1: Write the failing test**

In `client/test/game/assetUrls.test.ts`, change the first test's count to the catalog's 44 and add after it:

```ts
  it("resolves every `output` the shipped catalog declares", () => {
    expect(OUTPUTS.length).toBe(44);
    for (const output of OUTPUTS) {
      expect(typeof modelUrl(output)).toBe("string");
      expect(modelUrl(output).length).toBeGreaterThan(0);
    }
  });

  it("counts toward a hike only the models a hike loads: the film's own are left out", () => {
    const filmOnly = (catalog.assets as Array<{ id: string; scene?: string }>).filter((a) => a.scene !== undefined).map((a) => a.id);
    expect(filmOnly).toEqual(["intro.car", "intro.ranger"]);
    expect(MODEL_COUNT).toBe(42);
  });
```

and import `MODEL_COUNT` beside `audioUrl, modelUrl`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/assetUrls.test.ts test/game/modelLoad.test.ts`
Expected: FAIL: `MODEL_COUNT` is 44 (the new test), and `modelLoad.test.ts`'s two `42` cases read 44.

- [ ] **Step 3: Count what a hike loads**

In `client/src/game/assetUrls.ts`, replace the `MODEL_COUNT` line with:

```ts
/** The film's own models (the catalog's `scene`): the scene route loads them, a hike never does. */
const SCENE_ONLY = new Set(
  (catalog as { assets: Array<{ output: string; scene?: string }> }).assets.filter((a) => a.scene !== undefined).map((a) => a.output),
);

/** How many models a hike loads: every one the build ships but the film's own. */
export const MODEL_COUNT: number = Object.keys(MODEL_URLS).filter((output) => !SCENE_ONLY.has(output)).length;
```

In `client/src/game/modelLoad.ts`, the comment over `MODEL_TOTAL` becomes: `/** The models stage's total: every model a hike loads (the far forest, the clutter, the wildlife, the people and the placed things; not the film's own), so the line can say \`n of N\` from its first word. */`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/assetUrls.test.ts test/game/modelLoad.test.ts test/game/loadProgressHooks.test.ts && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/assetUrls.ts client/src/game/modelLoad.ts client/test/game/assetUrls.test.ts client/assets/catalog.json client/assets/models/intro.car.glb client/assets/models/intro.ranger.glb CREDITS.md
git lfs status | grep -E "intro\.(car|ranger)"   # both "LFS:"
git commit   # feat: the film's car and ranger, loaded by the scene only and counted by no hike
```

---

### Task 2: The 72 s film: the shots, the drive, the call's captions

**Files:**
- Modify: `client/src/game/scene/intro.ts:20-44, 67-80, 139-140`
- Test: `client/test/game/scene/intro.test.ts`

**Interfaces:**
- Produces: `INTRO_DURATION` 72; `INTRO_SHOTS` (eight spans); `INTRO_CAPTIONS` (eleven); the car at its site at 55 s; shot 5's camera 119 m back along the road from the site, the car passing it at 41.6 s.

The drive: 12 m/s from the start, a 7 s brake to the site. With the stop at 55 s the brake starts at 48 s, 42 m from the site, so the drive is 12 × 48 + 42 = 618 m, and the car is 119 m from the site at 48 − (119 − 42) / 12 = 41.58 s.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/scene/intro.test.ts`, replace the first, third, fourth, fifth and sixth tests with:

```ts
  it("has eight shots that sum to seventy-two seconds", () => {
    expect(INTRO_SHOTS.map((s) => [s.from, s.to])).toEqual([[0, 9], [9, 15], [15, 30.6], [30.6, 38.4], [38.4, 48], [48, 55], [55, 62], [62, 72]]);
    expect(INTRO_DURATION).toBe(72);
  });

  it("drives the car along the road to its site by the end of shot 6, and holds it there", () => {
    const scene = introScene(road, places);
    const at = (t: number) => evaluate(scene, t).car;
    expect(at(0)?.z).toBe(-618);
    expect(at(55)?.z).toBeCloseTo(0, 6);
    expect(at(55)?.x).toBeCloseTo(-246, 6);
    expect(at(40)?.x).toBeCloseTo(road.centerX(at(40)?.z ?? 0) + 1.8, 6);
    expect(at(66)?.z).toBeCloseTo(0, 6);
    expect(at(20)?.wheelSpin).toBeGreaterThan(at(19)?.wheelSpin ?? 0);
    expect(at(57)?.doorOpen).toBeGreaterThan(0);
    expect(at(52)?.doorOpen).toBe(0);
  });

  it("has the car pass the low camera on the shoulder at 41.6 s", () => {
    const scene = introScene(road, places);
    const frame = evaluate(scene, 41.6);
    expect(Math.abs((frame.car?.z ?? 0) - frame.camera.z)).toBeLessThan(0.5);
    expect(evaluate(scene, 39).car?.z ?? 0).toBeLessThan(frame.camera.z);
  });

  it("captions every line of the call on its recorded times", () => {
    expect(INTRO_CAPTIONS.map((c) => [c.from, c.to])).toEqual([
      [15, 17.14], [17.14, 19.04], [19.04, 23.82], [23.82, 26.28], [26.28, 30.58], [30.58, 33.52],
      [33.52, 35.98], [35.98, 41.24], [41.24, 45.46], [45.46, 48.42], [48.42, 51.86],
    ]);
    for (const c of INTRO_CAPTIONS) {
      const lines = c.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(42);
      expect(c.text.replace("\n", " ").length / (c.to - c.from)).toBeLessThanOrEqual(20);
    }
    const scene = introScene(road, places);
    expect(evaluate(scene, 16).caption?.text).toBe("Four-one, dispatch.");
    expect(evaluate(scene, 46).caption?.text).toBe("If anything... ...get back to the road.");
    expect(evaluate(scene, 53).caption).toBeNull();
  });

  it("fades in over two seconds and ends on the held picture: the black after it is the playback's", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 0).black).toBe(1);
    expect(evaluate(scene, 1).black).toBe(0.5);
    expect(evaluate(scene, 30).black).toBe(0);
    expect(evaluate(scene, 69).black).toBe(0);
    expect(evaluate(scene, 72).black).toBe(0);
  });
```

and the ranger test's times to the moved step out (Task 5 replaces it):

```ts
  it("keeps the ranger out of sight until the step out, then standing at the spawn facing the trail", () => {
    const scene = introScene(road, places);
    expect(evaluate(scene, 20).actors[0]?.visible).toBe(false);
    expect(evaluate(scene, 57).actors[0]?.clip).toBe("walk");
    const standing = evaluate(scene, 67).actors[0];
    expect(standing?.clip).toBe("idle");
    expect(standing?.x).toBeCloseTo(-240, 6);
    expect(standing?.z).toBeCloseTo(4, 6);
  });
```

The field-of-view test's two insert times move into the new insert: `expect(evaluate(scene, 34).camera.dof).toBe(true);` in place of `27`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/intro.test.ts`
Expected: FAIL on the shots, the drive, the pass, the captions and the black.

- [ ] **Step 3: The 72 s data**

In `client/src/game/scene/intro.ts`:

```ts
export const INTRO_DURATION = 72;

/** The eight shots of §3, in seconds: the cab, the insert and the shoulder
 * hold the call, which runs from 15 s to 51.9 s. */
export const INTRO_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 9 }, { from: 9, to: 15 }, { from: 15, to: 30.6 }, { from: 30.6, to: 38.4 },
  { from: 38.4, to: 48 }, { from: 48, to: 55 }, { from: 55, to: 62 }, { from: 62, to: 72 },
];

/** The car's drive: from this far down the road, at a cruise, braking over
 * the last seconds to the site (12 m/s for 48 s and a 7 s brake). */
const DRIVE_M = 618;
const CRUISE_MPS = 12;
const BRAKE_S = 7;
/** The car's lane: metres right of the centreline. */
const LANE_M = 1.8;
/** The car stops at the end of shot 6, the door opens through shot 7. */
const STOP_AT_S = 55;
const DOOR_OPEN_S = 1.5;
/** The ranger steps from the door and walks to the spawn over shot 7. */
const STEP_OUT_S = 55.5;
const WALK_S = 5;
/** Shot 5's camera: this far back along the road from the car's site, which
 * the cruising car reaches at 41.6 s. */
const PASS_BACK_M = 119;
```

(the other constants stay), the captions:

```ts
/** The call's ten lines against the video's clock, each from its start to
 * the next line's, line 9 in two at the pause before "If anything";
 * dispatch's marked as heard through the radio. */
export const INTRO_CAPTIONS: readonly Caption[] = [
  { from: 15.0, to: 17.14, text: "Four-one, dispatch.", radio: true },
  { from: 17.14, to: 19.04, text: "Four-one. Go ahead.", radio: false },
  { from: 19.04, to: 23.82, text: "We've had reports of a missing hiker.\nLast seen at Trail 14.", radio: true },
  { from: 23.82, to: 26.28, text: "Copy. Anyone see them come down?", radio: false },
  { from: 26.28, to: 30.58, text: "Last sighting was near the summit.\nThe caller didn't leave a name.", radio: true },
  { from: 30.58, to: 33.52, text: "All right. Who's meeting me out there?", radio: false },
  { from: 33.52, to: 35.98, text: "I've got nobody else to send.", radio: true },
  { from: 35.98, to: 41.24, text: "Figures. I'm ten minutes out.\nUp to the summit and back before dark.", radio: false },
  { from: 41.24, to: 45.46, text: "Four-one, be advised,\nradio won't carry past the road.", radio: true },
  { from: 45.46, to: 48.42, text: "If anything... ...get back to the road.", radio: true },
  { from: 48.42, to: 51.86, text: "Dispatch, you're breaking up.\n...Dispatch?", radio: false },
];
```

and shot 5:

```ts
    // 5. Low on the shoulder, the car passing close into the treeline.
    { ...s[4]!, shot: holdLookingAt({ x: seaSide(road.centerX(carSite.z - dir * (PASS_BACK_M - 5)), 4), y: ground(road.centerX(carSite.z - dir * (PASS_BACK_M - 5)), carSite.z - dir * (PASS_BACK_M - 5)) + 0.5, z: carSite.z - dir * PASS_BACK_M }, (t) => carLook(t + s[4]!.from)) },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene`
Expected: all pass (the route test seeks to 20 s, which is inside the new timeline).

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/intro.ts client/test/game/scene/intro.test.ts
git commit   # feat: the intro at 72 s, the call's captions on the recorded lines' times
```

---

### Task 3: The film car's parts: wheels, steering, door, handset

**Files:**
- Modify: `client/src/game/scene/timeline.ts:15` (`CarPose`), `client/src/game/scene/roadPath.ts`, `client/src/game/scene/sceneStage.ts`, `client/src/game/scene/intro.ts:22, 91-95` (`INTRO_CAR`, the car's pose), `client/src/game/scene/sceneRoute.ts:55-63` (the car's load)
- Test: `client/test/game/scene/roadPath.test.ts`, `client/test/game/scene/sceneStage.test.ts`, `client/test/game/scene/timeline.test.ts` (its car literal)

**Interfaces:**
- Produces: `CarPose = { x, y, z, yaw, wheelSpin, doorOpen, wheelTurn: number, steer: number, handset: "cradle" | "hand" }`; `WHEEL_RADIUS` 0.348, `WHEELBASE` 2.675, `STEERING_RATIO` 15; `CarModel = { root, wheels: { node, front }[], door, steering, handset, cradle }`; `StageDeps.hand?: () => TransformNode | null`; `GRIP = { position: Vector3, rotation: Quaternion }` (exported from `sceneStage.ts`); `INTRO_CAR = "intro.car"`.

- [ ] **Step 1: Write the failing tests**

`client/test/game/scene/roadPath.test.ts`: in "drives a distance along z…", `expect(WHEEL_RADIUS).toBe(0.348);` and append:

```ts
  it("turns the front wheels and the steering wheel with the road's curve, straight on a straight road", () => {
    const straight = { centerX: () => 100, groundY: () => 0 };
    const along = carAlong(straight, 0, (t) => 10 * t, 1.8, 1);
    expect(along(3).wheelTurn).toBe(0);
    expect(along(3).steer).toBe(0);
    expect(along(3).handset).toBe("cradle");
    // A road bending toward +x: at z 30 the heading grows by 0.00199 rad over the next metre.
    const bend = { centerX: (z: number) => 100 + 0.001 * z * z, groundY: () => 0 };
    const car = carAlong(bend, 0, (t) => 10 * t, 0, 1);
    expect(car(3).wheelTurn).toBeCloseTo(0.0053295, 7);
    expect(car(3).steer).toBeCloseTo(0.0799419, 7);
    expect(STEERING_RATIO).toBe(15);
    expect(WHEELBASE).toBe(2.675);
  });
```

(importing `STEERING_RATIO` and `WHEELBASE`; the two numbers are `atan(2.675 × (atan(0.063) − atan(0.061)))`, the car at z 30 reading the heading at z 31, and fifteen times it).

`client/test/game/scene/sceneStage.test.ts`: the frame's car literal gains `wheelTurn: 0, steer: 0, handset: "cradle"` (and `timeline.test.ts`'s car function the same three fields); import `Matrix` beside `Quaternion, Vector3` and `GRIP` beside `carModelOf, stageFrame`; append:

```ts
describe("the film car's parts", () => {
  /** The car as the loader leaves a model: under a root that flips z, its parts in the model's own frame. */
  function car(scene: Scene) {
    const handedness = new TransformNode("__root__", scene);
    handedness.scaling = new Vector3(1, 1, -1);
    const root = new TransformNode("car", scene);
    root.parent = handedness;
    const part = (name: string, parent: TransformNode, at: [number, number, number]) => {
      const node = new TransformNode(name, scene);
      node.parent = parent;
      node.position = new Vector3(...at);
      return node;
    };
    const lod0 = part("LOD0", root, [0, 0, 0]);
    part("wheel_fl", lod0, [1.326, 0.348, -0.73]);
    part("wheel_rr", lod0, [-1.349, 0.348, 0.73]);
    part("wheel_steering", lod0, [0.594, 1.034, -0.411]);
    part("door_driver", lod0, [0.875, 0.897, -0.752]);
    const cradle = part("cradle", lod0, [0.744, 0.784, 0.039]);
    part("handset", cradle, [0, 0.048, 0]);
    return carModelOf({ node: root, meshes: [], dispose() {} } as unknown as PlacedModel);
  }
  const at = (over: Partial<NonNullable<Frame["car"]>>): Frame => ({ ...frame, actors: [], car: { ...frame.car!, ...over } });

  it("finds the wheels, the steering wheel, the door, the handset and its cradle by name", () => {
    const engine = new NullEngine();
    const model = car(new Scene(engine));
    expect(model.wheels.map((w) => [w.node.name, w.front])).toEqual([["wheel_fl", true], ["wheel_rr", false]]);
    expect([model.steering?.name, model.door?.name, model.handset?.name, model.cradle?.name]).toEqual(["wheel_steering", "door_driver", "handset", "cradle"]);
    engine.dispose();
  });

  it("spins each wheel about its axle, steers the front ones, and turns the steering wheel about its column", () => {
    const engine = new NullEngine();
    const model = car(new Scene(engine));
    stageFrame(at({ wheelSpin: 2, wheelTurn: 0.1, steer: 1.5, doorOpen: 0.5 }), deps({ car: model }));
    const [fl, rr] = model.wheels;
    expect([fl!.node.rotation.z, fl!.node.rotation.y, rr!.node.rotation.z, rr!.node.rotation.y]).toEqual([-2, 0.1, -2, 0]);
    const q = model.steering!.rotationQuaternion!;
    const want = Quaternion.RotationAxis(new Vector3(0.871, -0.491, 0).normalize(), 1.5);
    for (const k of ["x", "y", "z", "w"] as const) expect(q[k]).toBeCloseTo(want[k], 9);
    expect(model.door!.rotation.y).toBeCloseTo(-0.5 * (Math.PI / 1.5), 9);
    engine.dispose();
  });

  it("carries the handset in the hand, and puts it back in its cradle on a seek backward", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const model = car(scene);
    // A hand as a skeleton's joint is: scaled with its armature, turned, somewhere in the cab.
    const hand = new TransformNode("hand", scene);
    hand.position = new Vector3(0.4, 1.3, -0.2);
    hand.rotationQuaternion = Quaternion.RotationYawPitchRoll(0.3, 0.2, 0.1);
    hand.scaling = new Vector3(0.01, 0.01, 0.01);
    const d = deps({ car: model, hand: () => hand });
    stageFrame(at({ handset: "hand" }), d);
    model.handset!.computeWorldMatrix(true);
    const want = GRIP.position.applyRotationQuaternion(hand.rotationQuaternion).add(hand.position);
    const got = model.handset!.getAbsolutePosition();
    for (const k of ["x", "y", "z"] as const) expect(got[k]).toBeCloseTo(want[k], 6);
    stageFrame(at({ handset: "cradle" }), d);
    expect(model.handset!.position.asArray()).toEqual([0, 0.048, 0]);
    expect(model.handset!.rotationQuaternion?.asArray()).toEqual([0, 0, 0, 1]);
    expect(model.handset!.scaling.asArray()).toEqual([1, 1, 1]);
    engine.dispose();
  });
});
```

(`PlacedModel` imported as a type from `../../../src/game/staticModel.js`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene`
Expected: FAIL: `WHEEL_RADIUS` is 0.36, no `wheelTurn`/`steer`/`handset`, `CarModel.wheels` are nodes, no steering, handset or `GRIP`.

- [ ] **Step 3: The car's pose**

`client/src/game/scene/timeline.ts`:

```ts
/** The car: its pose, the wheels' spin (radians), how open the driver's door is (0 to 1),
 * the front wheels' turn and the steering wheel's (radians, positive toward +x), and where
 * the handset is. */
export type CarPose = {
  x: number; y: number; z: number; yaw: number;
  wheelSpin: number; doorOpen: number; wheelTurn: number; steer: number;
  handset: "cradle" | "hand";
};
```

`client/src/game/scene/roadPath.ts`:

```ts
/** The film car's tyre radius (m), for the spin. */
export const WHEEL_RADIUS = 0.348;
/** The film car's wheelbase (m): its axles 2.675 m apart. */
export const WHEELBASE = 2.675;
/** The steering wheel's turns per turn of the front wheels. */
export const STEERING_RATIO = 15;

/** An angle in (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function carAlong(road: Road, startZ: number, distance: (t: number) => number, lane: number | ((t: number) => number), direction: 1 | -1): (t: number) => CarPose {
  return (t) => {
    const d = distance(t);
    const l = typeof lane === "number" ? lane : lane(t);
    const pose = roadPose(road, startZ + direction * d, l, direction);
    // The front wheels follow the road's curvature over the next metre.
    const ahead = roadPose(road, startZ + direction * (d + 1), l, direction);
    const wheelTurn = Math.atan(WHEELBASE * wrap(ahead.yaw - pose.yaw));
    return { ...pose, wheelSpin: d / WHEEL_RADIUS, doorOpen: 0, wheelTurn, steer: wheelTurn * STEERING_RATIO, handset: "cradle" };
  };
}
```

`client/src/game/scene/intro.ts`: `export const INTRO_CAR = "intro.car";`.

- [ ] **Step 4: The stage**

`client/src/game/scene/sceneStage.ts` (imports `Matrix`, `Quaternion`, `Vector3` from `@babylonjs/core/Maths/math.vector.js` and `Node` from `@babylonjs/core/node.js`):

```ts
/** The car: the node the whole model moves by, and its named parts where the
 * model has them. The parts keep the model's own frame (the car drives +x in
 * it, its wheels' axles along z), which a whole-model turn does not change. */
export type CarModel = {
  root: TransformNode;
  wheels: readonly { node: TransformNode; front: boolean }[];
  door: TransformNode | null;
  steering: TransformNode | null;
  handset: TransformNode | null;
  cradle: TransformNode | null;
};

export type StageDeps = {
  setFreecam(view: FreecamView): void;
  setDepthOfField(on: boolean): void;
  actor(id: string): CharacterInstance | null;
  car: CarModel | null;
  /** The hand the handset rides in while the car's pose says so; absent or null, it stays in its cradle. */
  hand?: () => TransformNode | null;
  captions: CaptionPanel;
  black(amount: number): void;
  warn(line: string): void;
};

/** The steering wheel's column in the part's own frame: the wheel's thinnest direction, measured on the model. */
const STEERING_COLUMN = new Vector3(0.871, -0.491, 0).normalize();
/** The handset in the hand: its offset (m) and turn in the hand's frame. Set at the look (`docs/gameplay/2026-09-30-intro-film-staging.md`). */
export const GRIP = { position: new Vector3(0, 0.08, 0.03), rotation: Quaternion.Identity() };
/** The handset's place in its cradle, as the model has it. */
const IN_CRADLE = [0, 0.048, 0] as const;

export function carModelOf(placed: PlacedModel): CarModel {
  const under = placed.node.getChildTransformNodes(false);
  const byName = (name: string): TransformNode | null => {
    const node = under.find((n) => n.name === name || n.name.endsWith(`_${name}`)) ?? null;
    if (node !== null && node.rotationQuaternion !== null) {
      node.rotation = node.rotationQuaternion.toEulerAngles();
      node.rotationQuaternion = null;
    }
    return node;
  };
  const wheels = WHEEL_NAMES.map((name) => ({ node: byName(name), front: name.startsWith("wheel_f") }))
    .filter((w): w is { node: TransformNode; front: boolean } => w.node !== null);
  return { root: placed.node, wheels, door: byName(DOOR_NAME), steering: byName("wheel_steering"), handset: byName("handset"), cradle: byName("cradle") };
}

/** A node's world matrix now: its ancestors' first, so a pose set this frame is in it. */
function worldOf(node: TransformNode): Matrix {
  const chain: TransformNode[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) if (n instanceof TransformNode) chain.unshift(n);
  for (const n of chain) n.computeWorldMatrix(true);
  return node.getWorldMatrix();
}

/** The handset in the hand (the hand's pose, its scale taken out, then the grip), written
 * as a pose under the cradle it stays a child of; or back in the cradle. */
function stageHandset(car: CarModel, hand: TransformNode | null): void {
  const { handset, cradle } = car;
  if (handset === null || cradle === null) return;
  if (hand === null) {
    handset.position.set(...IN_CRADLE);
    handset.rotationQuaternion = Quaternion.Identity();
    handset.scaling.setAll(1);
    return;
  }
  const handRotation = new Quaternion();
  const handPosition = new Vector3();
  worldOf(hand).decompose(undefined, handRotation, handPosition);
  const world = Matrix.Compose(Vector3.One(), GRIP.rotation, GRIP.position).multiply(Matrix.Compose(Vector3.One(), handRotation, handPosition));
  const local = world.multiply(worldOf(cradle).clone().invert());
  const scaling = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  local.decompose(scaling, rotation, position);
  handset.scaling.copyFrom(scaling);
  handset.rotationQuaternion = rotation;
  handset.position.copyFrom(position);
}
```

and in `stageFrame`, the car block becomes:

```ts
  if (frame.car !== null && deps.car !== null) {
    const car = frame.car;
    deps.car.root.position.set(car.x, car.y, car.z);
    deps.car.root.rotation.y = car.yaw;
    for (const wheel of deps.car.wheels) {
      wheel.node.rotation.z = -car.wheelSpin;
      wheel.node.rotation.y = wheel.front ? car.wheelTurn : 0;
    }
    if (deps.car.steering !== null) deps.car.steering.rotationQuaternion = Quaternion.RotationAxis(STEERING_COLUMN, car.steer);
    if (deps.car.door !== null) deps.car.door.rotation.y = -car.doorOpen * DOOR_SWING;
    stageHandset(deps.car, car.handset === "hand" ? (deps.hand?.() ?? null) : null);
  }
```

`intro.ts`'s `car` keeps the drive's `handset` ("cradle"; Task 5 sets it). `sceneRoute.ts`: `loadTrailheadCar` becomes `loadFilmCar` (the same body; `INTRO_CAR` now names the film's car).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root client test/game/scene && npm run typecheck`
Expected: all pass. If the handset case fails on its position, read `Matrix.decompose`'s handling of a mirrored parent (the `__root__`'s negative z) before changing the arithmetic: the case builds that parent on purpose.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/scene/timeline.ts client/src/game/scene/roadPath.ts client/src/game/scene/sceneStage.ts client/src/game/scene/intro.ts client/src/game/scene/sceneRoute.ts client/test/game/scene/roadPath.test.ts client/test/game/scene/sceneStage.test.ts client/test/game/scene/timeline.test.ts
git commit   # feat: the film car's wheels, steering wheel, door and handset on the scene's clock
```

---

### Task 4: A pose blended from two clips, and an actor placed by a joint

**Files:**
- Modify: `client/src/game/characterModel.ts:130-143` (`CharacterInstance`), `:279-349` (`acquire`), `client/src/game/scene/timeline.ts:13` (`ActorPose`), `client/src/game/scene/sceneStage.ts` (the actor block)
- Test: `client/test/game/characterPose.test.ts`, `client/test/game/scene/sceneStage.test.ts`

**Interfaces:**
- Consumes: `worldOf` (Task 3, `sceneStage.ts`).
- Produces: `PoseBlend = { clip: string; seconds: number; weight: number }`; `CharacterInstance.pose(clip, seconds, blend?: PoseBlend)`; `CharacterInstance.joint(name): TransformNode | null`; `ActorPose.blend?: { clip: string; clipTime: number; weight: number }`, `ActorPose.anchor?: { joint: string; x: number; y: number; z: number }`.

A blend weight is the second clip's share: `pose(a, ta, { clip: b, seconds: tb, weight: w })` is `a` at `ta` mixed `w` of the way to `b` at `tb`. Babylon's `goToFrame` writes a clip's values straight to its targets, not through the scene's weighted blending, so the mix is made by hand: each target's two values evaluated and interpolated (slerp for a rotation).

- [ ] **Step 1: Write the failing tests**

`client/test/game/characterPose.test.ts`, appended inside the `describe`:

```ts
  it("mixes two clips by a weight, then poses one alone again, and finds a node of the model by name", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const pool = createCharacterPool({ assets: [asset] }, async () => fakeContainer(scene));
    await pool.load(scene, [asset.id]);
    const instance = pool.acquire(7, asset.id)!;
    const node = scene.getTransformNodeByName("character_7_root")!;
    // Idle at 1 s is 30, Walk at 0.5 s is 15: a quarter of the way to Walk is 26.25.
    instance.pose("Idle", 1, { clip: "Walk", seconds: 0.5, weight: 0.25 });
    expect(node.position.y).toBeCloseTo(26.25, 3);
    instance.pose("Walk", 0.5);
    expect(node.position.y).toBeCloseTo(15, 3);
    expect(instance.joint("root")).toBe(node);
    expect(instance.joint("hand")).toBeNull();
    engine.dispose();
  });
```

`client/test/game/scene/sceneStage.test.ts`, appended:

```ts
describe("an actor placed by a joint", () => {
  function actor(scene: Scene, withJoint: boolean) {
    const root = new TransformNode("ranger", scene);
    const hips = new TransformNode("hips", scene);
    hips.parent = root;
    hips.position = new Vector3(0, 0.25, -1.3);
    const pose = vi.fn();
    const instance = { root, pose, joint: (n: string) => (withJoint && n === "hips" ? hips : null), clipNames: () => [], play() {}, setSpeed() {}, dispose() {} } as unknown as CharacterInstance;
    return { root, hips, pose, instance };
  }
  const anchored = (yaw: number): Frame => ({
    ...frame,
    car: null,
    actors: [{ id: "intro.ranger", x: 1, y: 2, z: 3, yaw, clip: "door", clipTime: 0.1, visible: true, blend: { clip: "drive", clipTime: 55, weight: 0.7 }, anchor: { joint: "hips", x: 5, y: 2, z: 7 } }],
  });

  it("poses the actor with its blend and moves it so the joint is at the anchor, whichever way it faces", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    for (const yaw of [0, Math.PI / 2]) {
      const a = actor(scene, true);
      stageFrame(anchored(yaw), deps({ actor: () => a.instance }));
      expect(a.pose).toHaveBeenCalledWith("door", 0.1, { clip: "drive", seconds: 55, weight: 0.7 });
      a.root.computeWorldMatrix(true);
      a.hips.computeWorldMatrix(true);
      const at = a.hips.getAbsolutePosition();
      expect([at.x, at.y, at.z].map((v) => Number(v.toFixed(9)))).toEqual([5, 2, 7]);
    }
    engine.dispose();
  });

  it("places an actor at its base when its anchor's joint is missing, and says so once", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const a = actor(scene, false);
    const d = deps({ actor: () => a.instance });
    stageFrame(anchored(0), d);
    stageFrame(anchored(0), d);
    expect(a.root.position.asArray()).toEqual([1, 2, 3]);
    expect(d.calls.filter((c) => c.startsWith("warn"))).toEqual(["warn scene: no joint hips on intro.ranger; placed at its base"]);
    engine.dispose();
  });
});
```

and the existing "poses a visible actor…" case's expectation becomes `expect(pose).toHaveBeenCalledWith("walk", 0.75, undefined);`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/characterPose.test.ts test/game/scene/sceneStage.test.ts`
Expected: FAIL: the blend is ignored (29.99…, the Idle alone), no `joint`, no anchor.

- [ ] **Step 3: The blended pose and the joint**

`client/src/game/characterModel.ts` (imports `Quaternion`, `Vector3` from `@babylonjs/core/Maths/math.vector.js`, `Animation` as a type):

```ts
/** A second clip mixed into a pose: its name, its time and its share (0 to 1). */
export type PoseBlend = { clip: string; seconds: number; weight: number };

export type CharacterInstance = {
  /** The node callers position, turn and scale; the model's feet sit at its origin. */
  root: TransformNode;
  play(kind: ClipKind): void;
  /** The named clip (its own name, or a kind's) held at `seconds` into it,
   * wrapped for a loop: a scene posing the character at a time of its own;
   * with `blend`, mixed that share of the way to a second clip at its time.
   * A clip the model lacks warns once and leaves the pose as it was. */
  pose(clip: string, seconds: number, blend?: PoseBlend): void;
  /** A node of the model by its own name (a joint, `chest`), or null. */
  joint(name: string): TransformNode | null;
  /** The model's clip names. */
  clipNames(): readonly string[];
  /** Playback rate of every clip, so a walk can keep pace with the ground it covers. */
  setSpeed(ratio: number): void;
  dispose(): void;
};

/** Two values of one animated property mixed: a rotation by slerp, the rest by lerp. */
function mix(a: unknown, b: unknown, w: number): unknown {
  if (a instanceof Quaternion && b instanceof Quaternion) return Quaternion.Slerp(a, b, w);
  if (a instanceof Vector3 && b instanceof Vector3) return Vector3.Lerp(a, b, w);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * w;
  return w < 0.5 ? a : b;
}

/** Writes an animation's value to its target along its property path (`position.y`). */
function setAnimated(target: unknown, path: readonly string[], value: unknown): void {
  let object = target as Record<string, unknown>;
  for (const key of path.slice(0, -1)) object = object[key] as Record<string, unknown>;
  object[path[path.length - 1]!] = value;
}
```

In `acquire`, replace `pose` with these, beside `clipNames`:

```ts
      const groupFor = (clip: string): AnimationGroup | null => {
        const byKind = (CLIP_KINDS as readonly string[]).includes(clip) ? clipNameFor(model.asset, model.clipNames, clip as ClipKind) : null;
        const group = groups.get(byKind ?? clip) ?? null;
        if (group === null && !missingWarned.has(clip)) {
          missingWarned.add(clip);
          console.warn(`character ${assetId}: no clip "${clip}"; holding the pose`);
        }
        return group;
      };
      const frameOf = (group: AnimationGroup, seconds: number): number => {
        const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 30;
        const span = group.to - group.from;
        return group.from + (span > 0 ? (((seconds * fps) % span) + span) % span : 0);
      };
      const nodes = root.getChildTransformNodes(false);
```

and in the instance:

```ts
        pose: (clip, seconds, blend) => {
          const group = groupFor(clip);
          if (group === null) return;
          const other = blend === undefined || blend.weight <= 0 ? null : groupFor(blend.clip);
          if (other === null || other === group) {
            if (current !== group) {
              current?.stop();
              group.start(true, ratio);
              group.pause();
              current = group;
            }
            group.goToFrame(frameOf(group, seconds));
            return;
          }
          current?.stop();
          current = null;
          const fa = frameOf(group, seconds);
          const fb = frameOf(other, blend!.seconds);
          const w = Math.min(1, blend!.weight);
          const theirs = new Map<string, Animation>();
          for (const ta of other.targetedAnimations) theirs.set(`${(ta.target as { uniqueId: number }).uniqueId}:${ta.animation.targetProperty}`, ta.animation);
          for (const ta of group.targetedAnimations) {
            const mine = ta.animation.evaluate(fa);
            const b = theirs.get(`${(ta.target as { uniqueId: number }).uniqueId}:${ta.animation.targetProperty}`);
            setAnimated(ta.target, ta.animation.targetPropertyPath, b === undefined ? mine : mix(mine, b.evaluate(fb), w));
          }
        },
        joint: (name) => nodes.find((n) => n.name === `${prefix}${name}`) ?? null,
```

- [ ] **Step 4: The stage places a blended, anchored actor**

`client/src/game/scene/timeline.ts`:

```ts
/** An actor: where it stands, which clip it is in and how far into it; a
 * second clip it is mixed toward (its share, 0 to 1); and a joint the stage
 * places at a point, moving the whole actor (a seated ranger by his chest). */
export type ActorPose = {
  id: string; x: number; y: number; z: number; yaw: number; clip: string; clipTime: number; visible: boolean;
  blend?: { clip: string; clipTime: number; weight: number };
  anchor?: { joint: string; x: number; y: number; z: number };
};
```

`client/src/game/scene/sceneStage.ts`, the actor loop's pose line becomes:

```ts
    instance.root.position.set(a.x, a.y, a.z);
    instance.root.rotation.y = a.yaw;
    instance.pose(a.clip, a.clipTime, a.blend === undefined ? undefined : { clip: a.blend.clip, seconds: a.blend.clipTime, weight: a.blend.weight });
    if (a.anchor !== undefined) placeByJoint(instance, a.id, a.anchor, deps);
```

with:

```ts
const warnedJoints = new WeakMap<StageDeps, Set<string>>();

/** Moves the actor so its joint, as posed this frame, is at the anchor. */
function placeByJoint(instance: CharacterInstance, id: string, anchor: NonNullable<ActorPose["anchor"]>, deps: StageDeps): void {
  const joint = instance.joint(anchor.joint);
  if (joint === null) {
    let warned = warnedJoints.get(deps);
    if (warned === undefined) warnedJoints.set(deps, (warned = new Set()));
    if (!warned.has(anchor.joint)) {
      warned.add(anchor.joint);
      deps.warn(`scene: no joint ${anchor.joint} on ${id}; placed at its base`);
    }
    return;
  }
  const at = worldOf(joint).getTranslation();
  instance.root.position.addInPlaceFromFloats(anchor.x - at.x, anchor.y - at.y, anchor.z - at.z);
}
```

(`ActorPose` imported as a type from `./timeline.js`.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root client test/game/characterPose.test.ts test/game/scene test/game/characterModel.test.ts && npm run typecheck`
Expected: all pass. Any other test's fake `CharacterInstance` that `typecheck` now finds without `joint` gets `joint: () => null`.

- [ ] **Step 6: Commit**

```bash
git add client/src/game/characterModel.ts client/src/game/scene/timeline.ts client/src/game/scene/sceneStage.ts client/test/game/characterPose.test.ts client/test/game/scene/sceneStage.test.ts
git commit   # feat: a character posed between two clips, and an actor placed by a joint
```

---

### Task 5: The ranger's performance: at the wheel, on the call, out of the door, to the trail

**Files:**
- Modify: `client/src/game/scene/intro.ts` (the ranger, the car's handset, the insert, the look at the ranger)
- Test: `client/test/game/scene/intro.test.ts`

**Interfaces:**
- Consumes: `CarPose.handset` (Task 3); `ActorPose.blend` and `ActorPose.anchor` (Task 4).
- Produces: `INTRO_RANGER = "intro.ranger"`; the ranger's `ActorPose` over the film: anchored by the `chest` joint in the seat, by the `hips` through the stand-up; the car's `handset` "hand" from 15.6 s to 52.7 s.

The ranger's clips, on the call's times: `drive` until dispatch calls at 15.0 s; `reach` (1.5 s; the hand closes on the handset at 15.6 s); `talk` from 16.5 s, the handset at his mouth, through line 10's end at 51.86 s; `lower` from 51.9 s (2 s; the handset back in its cradle at 52.7 s); `drive` again to the stop; `door` from the stop at 55 s (3 s), the door opening as he turns; `walk` from 58 s to the spawn over 5 s; `face_trail` from 63 s, held at its last frame. Each clip mixes in over 0.3 s from the one before. In the seat his chest is anchored where the drive clips' wheel mark (0.1 m below the chest, 0.4 m ahead of it) meets the car's steering wheel; through the stand-up his hips are carried from the seat (0.424 m below that chest) to 0.45 m outside the driver's door at standing height (0.95 m).

- [ ] **Step 1: Write the failing tests**

In `client/test/game/scene/intro.test.ts`, replace the ranger test from Task 2 with:

```ts
  it("seats the ranger at the wheel from the start, his chest on the seat's mark in the moving car", () => {
    const scene = introScene(road, places);
    const r = evaluate(scene, 5).actors[0]!;
    expect([r.id, r.clip, r.visible]).toEqual(["intro.ranger", "drive", true]);
    expect(r.anchor?.joint).toBe("chest");
    expect(r.anchor?.x).toBeCloseTo(-259.767039, 5);
    expect(r.anchor?.y).toBeCloseTo(11.134, 6);
    expect(r.anchor?.z).toBeCloseTo(-557.79782, 5);
  });

  it("plays the call: the reach, the handset taken and put back, the talk, the lower", () => {
    const scene = introScene(road, places);
    const clip = (t: number) => evaluate(scene, t).actors[0]?.clip;
    const handset = (t: number) => evaluate(scene, t).car?.handset;
    expect([clip(14), clip(15.2), clip(20), clip(52), clip(54.5)]).toEqual(["drive", "reach", "talk", "lower", "drive"]);
    expect([handset(15.5), handset(15.7), handset(52.6), handset(52.8)]).toEqual(["cradle", "hand", "hand", "cradle"]);
    // A function of t: a seek back from the call finds the handset in its cradle.
    expect(handset(10)).toBe("cradle");
  });

  it("mixes each clip in over 0.3 s from the one before", () => {
    const scene = introScene(road, places);
    const into = evaluate(scene, 16.6).actors[0]!;
    expect(into.clip).toBe("talk");
    expect(into.blend?.clip).toBe("reach");
    expect(into.blend?.weight).toBeCloseTo(0.740741, 6);
    expect(evaluate(scene, 17).actors[0]?.blend).toBeUndefined();
  });

  it("holds a clip that does not loop at its last frame", () => {
    const scene = introScene(road, places);
    const face = evaluate(scene, 70).actors[0]!;
    expect(face.clip).toBe("face_trail");
    expect(face.clipTime).toBeCloseTo(3.983333, 6);
  });

  it("turns him out of the seat at the stop, his hips carried from the seat to outside the door", () => {
    const scene = introScene(road, places);
    const start = evaluate(scene, 55).actors[0]!;
    expect(start.clip).toBe("door");
    expect(start.anchor?.joint).toBe("hips");
    expect(start.anchor?.x).toBeCloseTo(-246.407039, 5);
    expect(start.anchor?.y).toBeCloseTo(10.71, 6);
    expect(start.anchor?.z).toBeCloseTo(0.20218, 5);
    const mid = evaluate(scene, 56.5).actors[0]!;
    expect(mid.anchor?.x).toBeCloseTo(-246.825895, 5);
    expect(mid.anchor?.y).toBeCloseTo(10.83, 6);
    expect(mid.anchor?.z).toBeCloseTo(0.238562, 5);
  });

  it("walks him from the door to the spawn, and stands him there facing the trail", () => {
    const scene = introScene(road, places);
    const walking = evaluate(scene, 60.5).actors[0]!;
    expect(walking.clip).toBe("walk");
    expect(walking.anchor).toBeUndefined();
    const standing = evaluate(scene, 67).actors[0]!;
    expect([standing.clip, standing.x, standing.z, standing.yaw]).toEqual(["face_trail", -240, 4, 1.1]);
  });
```

(The anchors' numbers are the car-frame points above carried into the test road's world: at 5 s the car is at (−259.36, 10, −558) heading `atan(0.02)`; at the stop, at (−246, 10, 0) with the same heading.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/scene/intro.test.ts`
Expected: FAIL: the ranger is `ranger.nathan`, hidden until the step out, with no anchor, blend or handset.

- [ ] **Step 3: The performance**

In `client/src/game/scene/intro.ts`: `INTRO_RANGER` becomes `"intro.ranger"`; the constants `STEP_OUT_S`, `WALK_S`, `DOOR_X_M`, `DOOR_Z_M` and `HANDSET` go; add after the car's constants:

```ts
/** The film car's steering wheel's centre in the car's frame (m), measured on the model. */
const STEERING_AT = { x: -0.411, y: 1.034, z: 0.594 };
/** The seated chest: the drive clips hold the wheel 0.1 m below the chest and 0.4 m ahead of it. */
const CHEST_SEAT = { x: STEERING_AT.x, y: STEERING_AT.y + 0.1, z: STEERING_AT.z - 0.4 };
/** The seated hips: 0.424 m below the chest in the first frame of `drive`. */
const HIPS_SEAT = { x: CHEST_SEAT.x, y: CHEST_SEAT.y - 0.424, z: CHEST_SEAT.z };
/** Where the stand-up ends: the hips 0.45 m outside the driver's door, at standing height. */
const HIPS_OUT = { x: -1.25, y: 0.95, z: 0.25 };
const CHEST = "chest";
const HIPS = "hips";
/** The handset at the mouth, in the car's frame: the talk clip's right hand, 0.04 m right, 0.2 m up and 0.1 m ahead of the chest. */
const HANDSET_HELD = { x: CHEST_SEAT.x + 0.04, y: CHEST_SEAT.y + 0.2, z: CHEST_SEAT.z + 0.1 };
/** The insert's camera, in the car's frame: across the cab, looking back at the handset. */
const INSERT_FROM = { x: 0.25, y: 1.3, z: 0.75 };

/** The ranger's performance, on the call's times (s). */
const REACH_AT = 15.0;
const HANDSET_TAKEN_AT = 15.6;
const TALK_AT = 16.5;
const LOWER_AT = 51.9;
const HANDSET_BACK_AT = 52.7;
const STEP_OUT_S = 58;
const WALK_S = 5;
/** The time two clips are mixed across at a change (s). */
const BLEND_S = 0.3;

/** A clip from its start: its length when it does not loop (null when it does), and where the ranger is. */
type Segment = { from: number; clip: string; seconds: number | null; place: "seat" | "stand-up" | "walk" | "spawn" };
const PERFORMANCE: readonly Segment[] = [
  { from: 0, clip: "drive", seconds: null, place: "seat" },
  { from: REACH_AT, clip: "reach", seconds: 1.5, place: "seat" },
  { from: TALK_AT, clip: "talk", seconds: null, place: "seat" },
  { from: LOWER_AT, clip: "lower", seconds: 2, place: "seat" },
  { from: LOWER_AT + 2, clip: "drive", seconds: null, place: "seat" },
  { from: STOP_AT_S, clip: "door", seconds: 3, place: "stand-up" },
  { from: STEP_OUT_S, clip: "walk", seconds: null, place: "walk" },
  { from: STEP_OUT_S + WALK_S, clip: "face_trail", seconds: 4, place: "spawn" },
];

/** How far into a segment's clip at `t`: a loop runs on, a clip that does not loop holds its last frame. */
function clipTimeOf(segment: Segment, t: number): number {
  const into = t - segment.from;
  return segment.seconds === null ? into : Math.min(into, segment.seconds - 1 / 60);
}
```

In `introScene`, the car gains its handset:

```ts
  const car = (t: number): CarPose => {
    const pose = drive(Math.min(t, STOP_AT_S));
    const door = t <= STOP_AT_S ? 0 : ease((t - STOP_AT_S) / DOOR_OPEN_S);
    const held = t >= HANDSET_TAKEN_AT && t < HANDSET_BACK_AT;
    return { ...pose, doorOpen: door, handset: held ? "hand" : "cradle" };
  };
```

and the ranger (replacing `doorAt` and the old `ranger`):

```ts
  /** A point of the car's frame in the world at `t`, as `follow` places a camera. */
  const inCar = (t: number, p: { x: number; y: number; z: number }) => {
    const c = car(t);
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    return { x: c.x + p.x * co + p.z * s, y: c.y + p.y, z: c.z - p.x * s + p.z * co };
  };
  const ranger = (t: number): ActorPose => {
    let i = 0;
    while (i + 1 < PERFORMANCE.length && PERFORMANCE[i + 1]!.from <= t) i += 1;
    const segment = PERFORMANCE[i]!;
    const previous = i > 0 ? PERFORMANCE[i - 1]! : null;
    const into = t - segment.from;
    const blend = previous !== null && into < BLEND_S ? { clip: previous.clip, clipTime: clipTimeOf(previous, t), weight: 1 - ease(into / BLEND_S) } : undefined;
    const base = { id: INTRO_RANGER, clip: segment.clip, clipTime: clipTimeOf(segment, t), visible: true, ...(blend === undefined ? {} : { blend }) };
    const yaw = car(t).yaw;
    if (segment.place === "seat") {
      const at = inCar(t, CHEST_SEAT);
      return { ...base, ...at, yaw, anchor: { joint: CHEST, ...at } };
    }
    if (segment.place === "stand-up") {
      const u = ease(into / (segment.seconds ?? 1));
      const at = inCar(t, { x: HIPS_SEAT.x + (HIPS_OUT.x - HIPS_SEAT.x) * u, y: HIPS_SEAT.y + (HIPS_OUT.y - HIPS_SEAT.y) * u, z: HIPS_SEAT.z + (HIPS_OUT.z - HIPS_SEAT.z) * u });
      return { ...base, ...at, yaw, anchor: { joint: HIPS, ...at } };
    }
    if (segment.place === "walk") {
      const from = inCar(t, { x: HIPS_OUT.x, y: 0, z: HIPS_OUT.z });
      const u = ease(into / WALK_S);
      const x = from.x + (places.start.x - from.x) * u;
      const z = from.z + (places.start.z - from.z) * u;
      return { ...base, x, y: ground(x, z), z, yaw: Math.atan2(places.start.x - from.x, places.start.z - from.z) };
    }
    return { ...base, x: places.start.x, y: ground(places.start.x, places.start.z), z: places.start.z, yaw: places.start.yaw };
  };

  const rangerLook = (t: number) => {
    const r = ranger(t);
    // An anchored ranger's point is his chest or hips; a standing one's, his feet.
    return { x: r.x, y: r.y + (r.anchor === undefined ? 1.5 : 0.6), z: r.z };
  };
```

and shot 4:

```ts
    // 4. The handset at the ranger's mouth: the insert, across the cab, depth of field on.
    { ...s[3]!, shot: (t) => ({ ...followLookingAt((u) => carAt(u + s[3]!.from), () => INSERT_FROM, () => HANDSET_HELD, INSERT_FOV)(t), dof: true }) },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/scene && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scene/intro.ts client/test/game/scene/intro.test.ts
git commit   # feat: the ranger at the wheel through the call, out of the door and onto the trail
```

---

### Task 6: The route: ready, the hike's engine, no wildlife, the hand

**Files:**
- Modify: `client/src/game/scene/sceneRoute.ts`, `client/src/game/renderer.ts:1083-1103, 1562-1564`, `client/src/main.ts:814-821`
- Test: `client/test/game/scene/sceneRoute.test.ts`

**Interfaces:**
- Consumes: `CharacterInstance.joint` (Task 4), `StageDeps.hand` (Task 3).
- Produces: `DayhikeScene = { seek(t), frame(), time(), ready: Promise<void>, engine(): "webgpu" | "webgl2" }`; `SceneRun.hasWildlife: boolean`; `RendererOptions.wildlife?: boolean` (absent, true).

- [ ] **Step 1: Write the failing tests**

Append inside the route's `describe` in `client/test/game/scene/sceneRoute.test.ts`, using the first test's set-up:

```ts
  it("resolves ready once the loads have settled, arrived or not, says its engine, and holds no wildlife", async () => {
    const doc = installStandInDom();
    const container = doc.createElement("div");
    const run = startSceneRoute(
      { canvas: nullCanvas(), container: asHtml(container), tier: "low", now: () => 0, loadCar: async () => null, raf: () => 0, paint: (s, name) => new PBRMaterial(name, s) },
      { t: 20, step: null },
    );
    const api = (globalThis as { dayhikeScene?: { ready: Promise<void>; engine(): string } }).dayhikeScene!;
    // The car's load answers null and the ranger's file cannot be read in Node: both settle.
    await expect(api.ready).resolves.toBeUndefined();
    expect(api.engine()).toBe("webgl2");
    expect(run.hasWildlife).toBe(false);
    run.dispose();
  }, timeLimit(20000));
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/scene/sceneRoute.test.ts`
Expected: FAIL: `ready` is undefined, no `engine`, no `hasWildlife`.

- [ ] **Step 3: The renderer's wildlife option**

`client/src/game/renderer.ts`, in `RendererOptions`:

```ts
  /** The wildlife shell: absent or true, as the world's forest allows; false, none at
   * all (a scene recorded a frame at a time, which the director's own steps would not follow). */
  wildlife?: boolean;
```

and in `buildRenderer`: `const wildlife = forest !== null && options.wildlife !== false ? createWildlifeMeshes(…) : null;`.

- [ ] **Step 4: The route**

`client/src/game/scene/sceneRoute.ts`:

```ts
export type DayhikeScene = {
  seek(t: number): void;
  frame(): Promise<void>;
  time(): number;
  /** Resolves once the film's ranger and car have loaded or failed: a recorder waits on it. */
  ready: Promise<void>;
  engine(): "webgpu" | "webgl2";
};
export type SceneRun = { dispose(): void; worldState(): WorldState; scene(): BabylonScene; hasWildlife: boolean };
```

the renderer made with `{ tier: deps.tier, engine: deps.engine, clock: () => clock.time() * 1000, wildlife: false }`; the loads kept:

```ts
  const rangerLoaded = pool.load(renderer.scene, [INTRO_RANGER]);
  let car: CarModel | null = null;
  let carModel: PlacedModel | null = null;
  const carLoaded = (deps.loadCar ?? ((s) => loadFilmCar(s, loads.signal)))(renderer.scene).then((placed) => {
    if (placed === null || disposed) {
      placed?.dispose();
      return;
    }
    carModel = placed;
    car = carModelOf(placed);
    stage.car = car;
    for (const mesh of placed.meshes) renderer.shadows.add(mesh);
  });
  const ready = Promise.all([rangerLoaded, carLoaded]).then(() => undefined);
```

the stage's deps gain `hand: () => pool.acquire(1, INTRO_RANGER)?.joint("hand_r") ?? null`; the API gains `ready` and `engine: () => (renderer.engine.isWebGPU ? "webgpu" : "webgl2")`; and the returned run gains `hasWildlife: renderer.hasWildlife`.

`client/src/main.ts`, the scene branch:

```ts
  // The staged intro on its fixed world, a frame at a time for its recording:
  // the film is made on the high tier, which is what Auto means here, on the
  // engine a hike on that tier gets (WebGPU where the rule gives it).
  if (route.kind === "scene") {
    const choice = parseTierOverride(location.search) ?? currentChoice();
    const tier = choice === "auto" ? "high" : choice;
    void signalsReady
      .then((read) => engineFor(tier, read, () => token === renderToken))
      .then(({ canvas, engine }) => {
        if (token !== renderToken) {
          engine?.dispose();
          return;
        }
        container.appendChild(canvas);
        const scene = startSceneRoute({ canvas, container, tier, ...(engine === null ? {} : { engine }) }, parseSceneSearch(location.search));
        running = { dispose: () => scene.dispose() };
      });
    paintRoster();
    return;
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --root client test/game/scene test/architecture.test.ts test/game/renderer.test.ts && npm run typecheck && npm run lint`
Expected: all pass (the architecture test still finds `createWorld(level, seed, false)` and `renderer.sync(world.state, -1, 0)` in the route).

- [ ] **Step 6: Commit**

```bash
git add client/src/game/scene/sceneRoute.ts client/src/game/renderer.ts client/src/main.ts client/test/game/scene/sceneRoute.test.ts
git commit   # feat: the scene route says when it is ready and runs on a hike's engine, with no wildlife
```

---

### Task 7: The spec, for the 72 s film and the film's own models

**Files:**
- Modify: `docs/gameplay/2026-09-29-intro-scene.md` (§0, §1, §3, §6, §8.1)

- [ ] **Step 1: Amend**

- §0 and §1's table: "sixty-second" becomes "seventy-two-second".
- §3: "**The shots (60 s).**" becomes "**The shots (72 s).**", and the table's rows 3 to 8 become:

```markdown
| 3 | 0:15 to 0:30.6 | The cab from the back seat: gloved hands on the wheel, the handset in its cradle, the empty passenger seat, the road and the forest through the windscreen. The ranger's face is never framed closer than this. | the call, lines 1 to 5 |
| 4 | 0:30.6 to 0:38.4 | The handset and the hand that holds it. | lines 6 and 7, line 8 begins |
| 5 | 0:38.4 to 0:48 | Low on the shoulder: the car passes close, into the treeline. | line 8 ends; line 9; the signal breaks; the static carries over the cut |
| 6 | 0:48 to 0:55 | A locked-off wide as the car slows onto the shoulder by the board. | line 10; nothing; the engine cuts |
| 7 | 0:55 to 1:02 | The door opens; the step onto gravel; the ranger from behind, facing the trail. | the door, boots, wind; no birds |
| 8 | 1:02 to 1:12 | A slow push past the ranger's shoulder onto the trail, the board in view, then held with no movement for the last three seconds, then black. | wind, then silence |
```

  with a line under the table: "Amended 2026-09-30: the film runs 72 s. The call as recorded ends line 9 at 48.1 s, so shots 3 to 5 hold 33 s instead of 21 s and shots 6 to 8 follow 12 s later."
- §1: after the table, "The film's own models, the car with its parts and the ranger with the film's clips, are loaded by the scene route only; the catalog marks them (`scene`), and a hike neither loads nor counts them."
- §6: "the 1,440 frames" becomes "the 1,728 frames".
- §8.1: "the eight shots sum to 60 s" becomes "the eight shots sum to 72 s".

- [ ] **Step 2: Check and commit**

Run: `npx vitest run --root tools docs` (the docs' file names) and read the amended sections once more against Tasks 2 and 5.

```bash
git add docs/gameplay/2026-09-29-intro-scene.md
git commit   # docs: the intro at 72 s, and the film's own models
```

---

### Task 8: The look at the route with the film's models

**Files:**
- Create: `docs/gameplay/2026-09-30-intro-film-staging.md`
- Modify (with what the look sets): `client/src/game/scene/intro.ts` (`CHEST_SEAT`, `HIPS_OUT`, `HANDSET_HELD`, `INSERT_FROM`, `BACK_SEAT`), `client/src/game/scene/sceneStage.ts` (`GRIP`, and the signs of the wheels' spin and turn, the steering wheel's turn and the door's swing), and the tests that pin them

The car's parts keep the model's own frame, and the loader turns a right-handed file into Babylon's left-handed scene, so which way a positive spin, turn or swing goes is seen, not derived; so are the seat's and the handset's last centimetres.

- [ ] **Step 1: The route in a browser on WebGPU**

Run the dev server on a port no sibling worktree holds (`npx vite --config client/vite.config.ts --port 5189` from `client/`, or the repository's own dev script with `--port 5189`), open `http://localhost:5189/dayhike/scene/intro?tier=high` in a headed Chrome through the chrome-devtools CLI, and in the page: `await dayhikeScene.ready; dayhikeScene.engine()`.
Expected: `"webgpu"` (a Chrome that refuses WebGPU reads `"webgl2"`; note it and go on). A first visit translates the new materials' shaders on the page: wait for the frame before judging it.

- [ ] **Step 2: The frames**

For each time, `dayhikeScene.seek(t); await dayhikeScene.frame();` and a screenshot, into the look's archive outside the repository: 5 (cab: hands on the wheel), 12 (along the road: the wheels turning the way the car rolls), 16 (the reach to the handset), 20 (talking, the handset at the mouth), 34 (the insert: the handset in frame, depth of field), 41.6 (the car passing the low camera), 50 (the wide, the car braking), 56 (the door opening outward, the turn out of the seat), 58 (standing outside the door), 60.5 (walking), 67 and 71 (facing the trail, the push). For the wheels, two frames 1/24 s apart at 12 s: the tread's marks move the way the car rolls.

- [ ] **Step 3: Set what the frames show wrong**

For each defect, the number that fixes it, changed in the source and in the test that pins it, the frame re-taken: the seat (`CHEST_SEAT`, until both hands meet the steering wheel's rim and nothing passes through the seat or the dash), the stand-up's end (`HIPS_OUT`, beside the door, the feet on the ground), the grip (`GRIP`, the handset in the palm), the insert (`INSERT_FROM`, `HANDSET_HELD`), the back seat (`BACK_SEAT`), and a sign flipped wherever a wheel rolls backward, a front wheel turns against the road, the steering wheel against the front wheels, or the door into the car.

- [ ] **Step 4: The note**

`docs/gameplay/2026-09-30-intro-film-staging.md`, in the shape of `2026-09-30-intro-staging-verification.md`: the machine and the engine, each time's result (met, or changed and then met, with the number before and after and why), what the look could not settle, and what is owed (the record).

- [ ] **Step 5: The whole suite, and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass (rerun a file that times out under another suite's load on its own, with `TEST_TIME_SCALE=3`).

```bash
git add docs/gameplay/2026-09-30-intro-film-staging.md client/src/game/scene/intro.ts client/src/game/scene/sceneStage.ts client/test/game/scene/intro.test.ts client/test/game/scene/sceneStage.test.ts
git commit   # fix: the film's seat, grip and parts as the look set them
```

Pushing, deploying and the record are the owner's word.
