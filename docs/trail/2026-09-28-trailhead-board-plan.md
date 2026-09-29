# The Trailhead Board Implementation Plan

**Goal:** One thing stands at the trail's entrance: the trailhead board, turned to face the player as they arrive, its face weathered planks carrying the trail's name, a map of this world's own trails, the missing hiker's poster with a faded photograph, and a sheet of rules. The post with the "Trail 14" plank is removed.

**Architecture:** The board's place, facing and solid shape are derived from the seed and the trail graph on every peer, in a module of pure geometry (`sim/trailhead.ts`) that the trailhead pass reads. The face is described by three pure modules (its layout and words, the map's lines, the wear), and drawn by one painter onto a see-through texture on a plane just in front of the model's own planks. The painter is handed in, so everything but the painter runs in tests with no canvas.

**Tech Stack:** TypeScript, vitest, Babylon.js (the game layer only). `sim/` determinism rules: no trig, no `Math.pow`, no `**`, no `Math.hypot` in `sim/`; `Math.sqrt` for lengths; directions as unit vectors.

**Spec:** `docs/trail/2026-09-28-trailhead-board.md`. Read it first; this plan argues from it.

## Global Constraints

- Work in the worktree `.claude/worktrees/trailhead-board` on branch `worktree-trailhead-board`. Stage explicit paths only; never `git add -A` or `git add .`. Never use bare `git stash`.
- Commit messages use the repository's `## What` / `## How` shape (`.agents/skills/github-push/SKILL.md`): a type-prefixed subject under 72 characters, a `## What` paragraph, a `## How` list with backticked paths, then the repository's two trailers.
- The repository is public. Code, comments, test names, docs and commit messages describe the change and its measurements, and nothing about how the work was organised or how any model or image was made.
- The repository's pre-push scan runs after every commit and must report nothing failing.
- Every numeric test expectation is a literal, never computed from the code under test.
- Every explicit test time limit goes through `timeLimit(<ms>)` from `client/test/helpers/timeLimit.ts`.
- `sim/` never imports `net/`, `game/` or Babylon (ESLint enforces it).
- Protocol 5 stands: `InteractKind.Poster` is 2 and `POSTER_INTERACTABLE_ID` is 2.
- The car, the player's place and facing, the road wall, the junction posts and the trail builder do not change.
- The trail's name is exactly `Trail 14`; the poster's line is exactly `Last seen at Trail 14.`
- Constants, copied from the spec: `BOARD_ALONG` 2.5 m, `BOARD_OFFSET` 2.5 m, `BOARD_BED_CLEAR` 1.15 m, `BOARD_ROAD_CLEAR` 6 m, `BOARD_BOX_HALF` { x 0.275, y 1.25, z 0.275 }, `BOARD_BOX_STEP` 0.44 m, five boxes, `POSTER_ALONG` 0.36 m, `POSTER_HEIGHT` 1.32 m, `POSTER_STANDOFF` 0.05 m, `POSTER_RADIUS` 0.4 m, the face's texture 2048 by 1024.
- The board is never blank: a missing model, plank map, paper or photograph has a stand-in (spec §6).
- A sweep over the 227 seeds is one core for about two minutes. Run one at a time, and never beside a frame-time measurement.
- A pinned value that moves is read from a run of the changed code and written as a literal, with a dated comment saying what it was and why it moved, as `client/test/sim/groundGradient.test.ts` already does.

## Inputs the tests must also cover

Inputs the spec implies and a person will meet. Each has its test in the task that owns the code.

1. **A trail so short the map has no room to spare, or a graph with one node.** The map still fits inside its sheet and nothing divides by nothing (Task 4, "fits a graph of one node").
2. **A world whose trail is under a tenth of a mile or over ten.** The distance line reads `0.1` at the least and carries two digits before the point at the most (Task 3, "reads a trail's length in miles").
3. **A name the list has never held, or an empty one.** The words still lay out; the poster shows the name it is given (Task 3, "lays out any hiker's name").
4. **The paper or the photograph missing, or arriving after the board is drawn, or after it is disposed.** Stand-ins are drawn first, the images replace them when they arrive, and nothing is drawn onto a disposed texture (Task 7, "draws once more when an image arrives", "draws nothing more when there are no images or none arrives", "drops an image that arrives after disposal").
5. **Neither side of the trail clear.** The board still stands, on the side nearer the centre of the view, and the function returns (Task 6, "takes the nearer side when neither clears").

---

## File structure

| File | Responsibility |
| --- | --- |
| `client/src/sim/trailhead.ts` | New. The trailhead's pure geometry and constants: the entrance, the car's place, where a player arrives, the board's place, facing and boxes. Registers nothing. |
| `client/src/sim/passes/trailhead.ts` | Pass 8 only: emits the car's box and the board's five. |
| `client/src/sim/spawn.ts` | `trailheadStart`; re-exports `trailheadSpawn` and `Start`. |
| `client/src/sim/signs.ts`, `client/src/sim/passes/signs.ts` | The junction posts only; `TRAIL_NAME`. |
| `client/src/sim/search.ts` | The poster's point from the board. |
| `client/src/sim/hikerNames.ts` | `HIKER_FIRST_NAMES`. |
| `client/src/game/boardFace.ts` | New. Pure: the layout in pixels, every word, the distance in miles. |
| `client/src/game/boardMap.ts` | New. Pure: the map's lines, places and labels. |
| `client/src/game/boardWear.ts` | New. Pure: each sheet's wear. |
| `client/src/game/boardPaint.ts` | New. The painter: the one module that touches a canvas. |
| `client/src/game/boardImages.ts` | New. The paper's and the photograph's addresses, when the files exist. |
| `client/src/game/trailheadMeshes.ts` | Places the car and the board; draws the face's plane; falls back to boxes. |
| `client/src/game/labelWear.ts` | Exports its generator as `wearGenerator`. |
| `client/src/game/signMeshes.ts` | Exports `scrape`, `CARVED`, `CARVED_LIP`; `paintedMaterial` goes. |
| `client/src/app.ts` | Gives the board its place, the graph, the names and the seed. |

---

### Task 1: The trailhead's geometry in a module that registers nothing

No behaviour changes. The constants and pure functions move out of the pass's module, so that a module which only wants a constant or a place does not register a pass by importing it.

**Files:**
- Create: `client/src/sim/trailhead.ts` (by moving `client/src/sim/passes/trailhead.ts`)
- Create: `client/src/sim/passes/trailhead.ts` (the pass alone)
- Modify: `client/src/sim/spawn.ts`, and every importer of `passes/trailhead.js`

**Interfaces:**
- Consumes: nothing.
- Produces, from `client/src/sim/trailhead.ts`: everything `passes/trailhead.ts` exported before (`CAR_HALF`, `KIOSK_HALF`, `CAR_ROAD_U`, `CAR_ROAD_Z`, `CAR_BED_CLEAR`, `CAR_SLIDE_STEP`, `CAR_SLIDE_MAX`, `SPAWN_GAP`, `SIGN_ROAD_U`, `SIGN_ROAD_Z`, `CAR_MATERIAL`, `KIOSK_MATERIAL`, `RoadProp`, `PROPS`, `roadProp`, `kioskFacing`, `EntranceGraph`, `trailEntrance`, `bedGap`, `carSite`, `propSite`, `trailheadSite`), and, moved from `spawn.ts`, `type Start = { x: number; z: number; yaw: number }` and `trailheadSpawn(graph: EntranceGraph, car: Ground): Start`.

- [ ] **Step 1: Move the file, so its history follows the geometry**

```bash
git mv client/src/sim/passes/trailhead.ts client/src/sim/trailhead.ts
perl -pi -e 's#"\.\./(road|bowl|constants|boxGap|trail|types)\.js"#"./$1.js"#g' client/src/sim/trailhead.ts
```

- [ ] **Step 2: Take the pass out of it**

In `client/src/sim/trailhead.ts`:

- delete the imports of `registerPass`, `CHUNK_SIZE`, `activeTerrainVariant` and `elevationSampleAt`;
- delete the block from `/** Pass 8. Emits each prop …` to the end of the `registerPass({ … });` call;
- add `import { facingYaw } from "./facing.js";`
- change the header comment's first sentence to begin `The trailhead's places: the ranger's car, the roofed notice board …`, and add as its last paragraph: `Pure geometry and constants. Pass 8 (passes/trailhead.ts) emits the boxes; this module registers nothing, so reading a constant from it has no effect.`
- move `Start` and `trailheadSpawn`, with their comments, from `client/src/sim/spawn.ts` to the end of this file, unchanged.

- [ ] **Step 3: Write the pass's own module**

`client/src/sim/passes/trailhead.ts`:

```ts
import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import {
  CAR_BED_CLEAR, CAR_HALF, CAR_ROAD_U, CAR_ROAD_Z, CAR_SLIDE_MAX, CAR_SLIDE_STEP, KIOSK_HALF, PROPS,
  SIGN_ROAD_U, SIGN_ROAD_Z, SPAWN_GAP, trailheadSite,
} from "../trailhead.js";

/** Pass 8. Emits each prop into the chunk that contains its centre, so a
 * prop is emitted exactly once even when its box straddles a chunk edge —
 * the collision broadphase surfaces every chunk a query overlaps. Where the
 * props stand is `sim/trailhead.ts`'s to say. */
registerPass({
  id: 8,
  name: "trailhead",
  get tunables() {
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      KIOSK_HALF_X: KIOSK_HALF.x, KIOSK_HALF_Y: KIOSK_HALF.y, KIOSK_HALF_Z: KIOSK_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, SIGN_ROAD_U, SIGN_ROAD_Z,
      CAR_BED_CLEAR, CAR_SLIDE_STEP, CAR_SLIDE_MAX, SPAWN_GAP,
    };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    for (const p of PROPS) {
      const { x: cx, z: cz } = trailheadSite(graph, roadCenterX, worldSeed, p.material);
      if (cx < minX || cx >= maxX || cz < minZ || cz >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, cx, cz).h;
      chunk.props.push({
        material: p.material,
        box: {
          min: { x: cx - p.half.x, y: ground, z: cz - p.half.z },
          max: { x: cx + p.half.x, y: ground + 2 * p.half.y, z: cz + p.half.z },
        },
      });
    }
  },
});
```

- [ ] **Step 4: Point the importers at the geometry**

```bash
perl -pi -e 's#sim/passes/trailhead\.js#sim/trailhead.js#g; s#"\./passes/trailhead\.js"#"./trailhead.js"#g' \
  client/src/app.ts client/src/game/trailheadMeshes.ts client/src/sim/spawn.ts client/src/sim/search.ts \
  client/src/sim/world.ts client/src/sim/signs.ts \
  client/test/sim/containment.test.ts client/test/sim/searchSweep.test.ts client/test/sim/trailhead.test.ts
perl -pi -e 's#from "\./trailhead\.js"#from "../trailhead.js"#' client/src/sim/passes/signs.ts
```

In `client/src/sim/spawn.ts`, the import becomes

```ts
import { carSite, trailheadSpawn, type Start } from "./trailhead.js";
```

the imports of `facingYaw`, `Ground`, `CAR_HALF`, `SPAWN_GAP`, `trailEntrance` and `EntranceGraph` go, and one line re-exports what moved, so callers' imports stand:

```ts
export { trailheadSpawn, type Start } from "./trailhead.js";
```

- [ ] **Step 5: Check nothing still reads the pass for its geometry**

Run: `grep -rn "passes/trailhead" client/src client/test`
Expected: two lines only, the import in `client/src/sim/passes/index.ts` and the one in a comment of `client/src/sim/forest.ts`; and `client/test/sim/groundGradient.test.ts`'s comment.

- [ ] **Step 6: Typecheck, lint, tests**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

Run: `npx vitest run --root client test/sim/trailhead.test.ts test/sim/spawn.test.ts test/sim/search.test.ts test/sim/searchSweep.test.ts test/sim/signs.test.ts test/sim/containment.test.ts test/sim/forest.test.ts test/sim/groundGradient.test.ts test/game/trailheadMeshes.test.ts`
Expected: PASS, the same tests as before. The pass hash is unchanged, 178231578: no tunable and no box moved.

- [ ] **Step 7: Commit**

```bash
git add client/src/sim/trailhead.ts client/src/sim/passes/trailhead.ts client/src/sim/passes/signs.ts \
  client/src/sim/spawn.ts client/src/sim/search.ts client/src/sim/world.ts client/src/sim/signs.ts \
  client/src/app.ts client/src/game/trailheadMeshes.ts \
  client/test/sim/containment.test.ts client/test/sim/searchSweep.test.ts client/test/sim/trailhead.test.ts
git commit
```

Message:

```
refactor: keep the trailhead's geometry apart from its pass

## What

Where the car stands, where a player arrives and where the trail leaves the
pad were worked out in the same module that registers the trailhead pass,
so a module that read a constant from it registered a pass by doing so. The
geometry and its constants have a module of their own that registers
nothing, and the pass reads them from there. Nothing behaves differently:
the pass hash is the same.

## How

- `client/src/sim/trailhead.ts` — was `passes/trailhead.ts`, without the
  pass; `trailheadSpawn` and `Start` join it from `spawn.ts`.
- `client/src/sim/passes/trailhead.ts` — pass 8 alone.
- `client/src/sim/spawn.ts` — keeps `trailheadStart`, and re-exports what
  moved.
- `client/src/sim/search.ts`, `client/src/sim/world.ts`,
  `client/src/sim/signs.ts`, `client/src/sim/passes/signs.ts`,
  `client/src/app.ts`, `client/src/game/trailheadMeshes.ts` and three
  tests — import from the geometry.
```

---

### Task 2: The missing hiker's first name

**Files:**
- Modify: `client/src/sim/hikerNames.ts`
- Modify: `client/test/sim/hikerNames.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HIKER_FIRST_NAMES: readonly string[]` (sixteen names); `hikerNames(seed, count)` draws first names from it.

- [ ] **Step 1: Write the failing tests**

In `client/test/sim/hikerNames.test.ts`, add `HIKER_FIRST_NAMES` to the import, add `import { seedFromToken } from "../../src/game/seed.js";`, replace the test `"draws only from the tables"` and add two more:

```ts
  it("draws first names from the sixteen and surnames from the table", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const name of hikerNames(seed, 4)) {
        const [first, last] = name.split(" ");
        expect(HIKER_FIRST_NAMES).toContain(first);
        expect(LAST_NAMES).toContain(last);
      }
    }
  });

  it("keeps the sixteen in the order the full table has them", () => {
    expect(HIKER_FIRST_NAMES).toEqual([
      "Owen", "Miles", "Elias", "Theo", "Hugh", "Silas", "Reuben", "Abel",
      "Cyrus", "Jonah", "Felix", "Amos", "Rafe", "Boyd", "Callum", "Ansel",
    ]);
    expect(FIRST_NAMES.filter((n) => HIKER_FIRST_NAMES.includes(n))).toEqual([...HIKER_FIRST_NAMES]);
    expect(FIRST_NAMES).toHaveLength(32);
  });

  it("names the hikers of known worlds", () => {
    expect(hikerNames(seedFromToken("hollow"), 1)).toEqual(["Hugh Kowalski"]);
    expect(hikerNames(1234, 1)).toEqual(["Silas Brandt"]);
    expect(hikerNames(77, 4)).toEqual(["Hugh Brandt", "Callum Okafor", "Hugh Lindqvist", "Felix Mbeki"]);
    expect(hikerNames(12345, 1)).toEqual(["Abel Quennell"]);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/sim/hikerNames.test.ts`
Expected: FAIL. `HIKER_FIRST_NAMES` is not exported; once it is, `hikerNames(1234, 1)` gives `Iris Brandt` where the test expects `Silas Brandt`.

- [ ] **Step 3: Draw from the sixteen**

In `client/src/sim/hikerNames.ts`, after `FIRST_NAMES`:

```ts
/**
 * The missing hiker's first name is drawn from these: the men's names of
 * FIRST_NAMES, in their order there. The hiker is one man, whose photograph
 * is on the poster and whose body is at the crest, so the name on the poster
 * is a man's. Places are named from the whole table.
 */
export const HIKER_FIRST_NAMES: readonly string[] = [
  "Owen", "Miles", "Elias", "Theo", "Hugh", "Silas", "Reuben", "Abel",
  "Cyrus", "Jonah", "Felix", "Amos", "Rafe", "Boyd", "Callum", "Ansel",
];
```

and in `hikerNames`:

```ts
    const first = HIKER_FIRST_NAMES[Math.floor(nextRandom(rng) * HIKER_FIRST_NAMES.length)] as string;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/sim/hikerNames.test.ts test/sim/placeNames.test.ts test/sim/signsSweep.test.ts test/sim/search.test.ts test/sim/searchSweep.test.ts`
Expected: PASS. If `signsSweep.test.ts`'s totals (`{ most: 5, total: 163, fillers: 17 }`) move, a place's name changed with the hiker's; the counts are of planks, not of names, and should stand. If they do move, read the new totals from the run and re-pin them with a dated comment.

- [ ] **Step 5: Commit**

```bash
git add client/src/sim/hikerNames.ts client/test/sim/hikerNames.test.ts
git commit
```

Message:

```
feat: draw the missing hiker's first name from men's names

## What

The missing hiker is one man: his body is at the crest, and his photograph
is about to be on the poster. His first name was drawn from a table of
thirty-two that holds women's names too. It is drawn from the sixteen men's
names of that table, in their order there; the surnames and the draws are
unchanged. A world's hiker changes where the old draw fell on a name
outside the sixteen. The world `hollow` keeps Hugh Kowalski.

## How

- `client/src/sim/hikerNames.ts` — `HIKER_FIRST_NAMES`, and `hikerNames`
  draws from it. `FIRST_NAMES` stays whole for the place names.
- `client/test/sim/hikerNames.test.ts` — the sixteen and their order, first
  names only from them over 200 seeds, and the hikers of four known worlds.
```

---

### Task 3: The face's layout and its words

**Files:**
- Create: `client/src/game/boardFace.ts`
- Create: `client/test/game/boardFace.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BOARD_TEXTURE = { width: 2048, height: 1024 }`, `BOARD_FACE = { width: 2, height: 1, centreY: 1.37, front: 0.159 }`
  - `type Rect = { x: number; y: number; width: number; height: number; turn: number }`
  - `type SheetName = "map" | "poster" | "rules" | "torn"`, `type Sheet = { name: SheetName; rect: Rect; staples: boolean }`
  - `SHEETS: readonly Sheet[]`, `sheet(name: SheetName): Sheet`, `sheetCentre(name: SheetName): { along: number; height: number }`
  - `TITLE`, `DISTANCE`: `{ centreX: number; centreY: number; height: number }`
  - `miles(metres: number): string`
  - `type BoardText`, `boardText(trailName: string, hikerName: string, lastSeen: string, summitMetres: number): BoardText`

- [ ] **Step 1: Write the failing test**

`client/test/game/boardFace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOARD_FACE, BOARD_TEXTURE, DISTANCE, SHEETS, TITLE, boardText, miles, sheet, sheetCentre } from "../../src/game/boardFace.js";

describe("the board's face", () => {
  it("is twice as wide as tall, on the texture and on the board", () => {
    expect(BOARD_TEXTURE).toEqual({ width: 2048, height: 1024 });
    expect(BOARD_FACE).toEqual({ width: 2, height: 1, centreY: 1.37, front: 0.159 });
  });

  it("lays the map over the left half, the poster and the rules to its right, a torn corner below", () => {
    expect(SHEETS.map((s) => s.name)).toEqual(["torn", "map", "poster", "rules"]);
    expect(sheet("map").rect).toMatchObject({ x: 72, y: 236, width: 1024, height: 748 });
    expect(sheet("poster").rect).toMatchObject({ x: 1167, y: 246, width: 451, height: 635 });
    expect(sheet("rules").rect).toMatchObject({ x: 1659, y: 276, width: 338, height: 532 });
    expect(sheet("torn").rect).toMatchObject({ x: 1229, y: 901, width: 123, height: 72 });
    expect(sheet("map").rect.turn).toBeCloseTo(-0.006981317007977318, 12);
    expect(sheet("poster").rect.turn).toBeCloseTo(0.020943951023931952, 12);
    expect(sheet("torn").staples).toBe(false);
    expect(sheet("poster").staples).toBe(true);
  });

  it("keeps every sheet on the face and below the routed lines", () => {
    for (const s of SHEETS) {
      expect(s.rect.x, s.name).toBeGreaterThanOrEqual(0);
      expect(s.rect.x + s.rect.width, s.name).toBeLessThanOrEqual(2048);
      expect(s.rect.y, s.name).toBeGreaterThanOrEqual(200);
      expect(s.rect.y + s.rect.height, s.name).toBeLessThanOrEqual(1024);
    }
    expect(TITLE).toEqual({ centreX: 1024, centreY: 87, height: 102 });
    expect(DISTANCE).toEqual({ centreX: 1024, centreY: 179, height: 41 });
  });

  it("puts the poster's centre 0.36 m right of the face's and 1.32 m above the board's foot", () => {
    const c = sheetCentre("poster");
    expect(c.along).toBeCloseTo(0.36, 2);
    expect(c.height).toBeCloseTo(1.32, 2);
    expect(sheetCentre("map").along).toBeCloseTo(-0.43, 2);
  });

  it("refuses a sheet it does not have", () => {
    expect(() => sheet("notice" as never)).toThrow();
  });
});

describe("the board's words", () => {
  it("reads a trail's length in miles", () => {
    expect(miles(1274)).toBe("0.8");
    expect(miles(1609.344)).toBe("1.0");
    expect(miles(3300)).toBe("2.1");
    expect(miles(100)).toBe("0.1");
    expect(miles(0)).toBe("0.1");
    expect(miles(16093.44)).toBe("10.0");
  });

  it("says everything the board says", () => {
    expect(boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274)).toEqual({
      title: "TRAIL 14",
      distance: "SUMMIT 0.8 MI",
      mapHeading: "TRAIL 14 · TRAILS",
      poster: { title: "MISSING", name: "Hugh Kowalski", lines: ["Last seen at Trail 14.", "If you have seen them, call the ranger station."] },
      rules: {
        heading: "BEFORE YOU GO",
        lines: ["STAY ON THE TRAIL", "BE OFF THE MOUNTAIN BY DARK", "PACK IT IN, PACK IT OUT"],
        small: ["No fires. No camping.", "Tell someone where you are going."],
      },
    });
  });

  it("lays out any hiker's name", () => {
    expect(boardText("Trail 14", "", "Last seen at Trail 14.", 1274).poster.name).toBe("");
    expect(boardText("Trail 14", "Bartholomew Featherstonehaugh-Cholmondeley", "x", 1).poster.name).toBe("Bartholomew Featherstonehaugh-Cholmondeley");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/boardFace.test.ts`
Expected: FAIL, the module `../../src/game/boardFace.js` cannot be found.

- [ ] **Step 3: Write the module**

`client/src/game/boardFace.ts`:

```ts
/**
 * The trailhead board's face as data: where each part lies on the face's
 * texture, and every word on it. Pure: no canvas, no Babylon. The painter
 * (`boardPaint.ts`) draws what this says.
 */

/** The face's texture: the face is 2 m by 1 m, so twice as wide as tall, about a pixel a millimetre. */
export const BOARD_TEXTURE = { width: 2048, height: 1024 } as const;

/** The face in the board's own space: its size, and its centre above the board's foot and in front of its centre plane. */
export const BOARD_FACE = { width: 2, height: 1, centreY: 1.37, front: 0.159 } as const;

/** A rectangle on the texture, in pixels from its top-left corner, turned about its own centre. */
export type Rect = { x: number; y: number; width: number; height: number; turn: number };

export type SheetName = "map" | "poster" | "rules" | "torn";
export type Sheet = { name: SheetName; rect: Rect; staples: boolean };

const DEGREE = Math.PI / 180;

/** The sheets, bottom to top: the map over the left half, the poster and the rules to its right, a torn corner below. */
export const SHEETS: readonly Sheet[] = [
  { name: "torn", rect: { x: 1229, y: 901, width: 123, height: 72, turn: 3 * DEGREE }, staples: false },
  { name: "map", rect: { x: 72, y: 236, width: 1024, height: 748, turn: -0.4 * DEGREE }, staples: true },
  { name: "poster", rect: { x: 1167, y: 246, width: 451, height: 635, turn: 1.2 * DEGREE }, staples: true },
  { name: "rules", rect: { x: 1659, y: 276, width: 338, height: 532, turn: -1 * DEGREE }, staples: true },
];

/** The routed lines across the top: each line's centre and its capitals' height, in pixels. */
export const TITLE = { centreX: 1024, centreY: 87, height: 102 } as const;
export const DISTANCE = { centreX: 1024, centreY: 179, height: 41 } as const;

export function sheet(name: SheetName): Sheet {
  const found = SHEETS.find((s) => s.name === name);
  if (found === undefined) throw new Error(`no sheet named "${name}"`);
  return found;
}

/** Where a sheet's centre lies on the board: metres right of the face's centre, and metres above the board's foot. */
export function sheetCentre(name: SheetName): { along: number; height: number } {
  const r = sheet(name).rect;
  const u = (r.x + r.width / 2) / BOARD_TEXTURE.width;
  const v = (r.y + r.height / 2) / BOARD_TEXTURE.height;
  return {
    along: (u - 0.5) * BOARD_FACE.width,
    height: BOARD_FACE.centreY + (0.5 - v) * BOARD_FACE.height,
  };
}

const METRES_PER_MILE = 1609.344;

/** A trail's length in miles to one decimal place, never less than 0.1. */
export function miles(metres: number): string {
  const tenths = Math.max(1, Math.round((metres / METRES_PER_MILE) * 10));
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export type BoardText = {
  title: string;
  distance: string;
  mapHeading: string;
  poster: { title: string; name: string; lines: string[] };
  rules: { heading: string; lines: string[]; small: string[] };
};

/** Every word on the board, for a trail's name, a hiker's name and the trail's length to the summit. */
export function boardText(trailName: string, hikerName: string, lastSeen: string, summitMetres: number): BoardText {
  return {
    title: trailName.toUpperCase(),
    distance: `SUMMIT ${miles(summitMetres)} MI`,
    mapHeading: `${trailName.toUpperCase()} · TRAILS`,
    poster: {
      title: "MISSING",
      name: hikerName,
      lines: [lastSeen, "If you have seen them, call the ranger station."],
    },
    rules: {
      heading: "BEFORE YOU GO",
      lines: ["STAY ON THE TRAIL", "BE OFF THE MOUNTAIN BY DARK", "PACK IT IN, PACK IT OUT"],
      small: ["No fires. No camping.", "Tell someone where you are going."],
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --root client test/game/boardFace.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/boardFace.ts client/test/game/boardFace.test.ts
git commit
```

Message:

```
feat: lay out the trailhead board's face, and write its words

## What

The trailhead board's face is about to carry the trail's name, a map, the
missing hiker's poster and a sheet of rules. This is the face as data:
where each sheet lies on a texture of 2048 by 1024, the two routed lines
across the top, and every word, with the distance to the summit in miles.
Nothing draws it yet.

## How

- `client/src/game/boardFace.ts` — the sheets' rectangles and turns, where
  a sheet's centre lies on the board in metres, `miles`, and `boardText`.
- `client/test/game/boardFace.test.ts` — the rectangles, every sheet on
  the face and below the routed lines, the poster's centre, the distance
  from 0 m to ten miles, and the words in full.
```

---

### Task 4: The map

**Files:**
- Create: `client/src/game/boardMap.ts`
- Create: `client/test/game/boardMap.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MapPoint = { x: number; y: number }`, `type MapLine = { x0: number; y0: number; x1: number; y1: number }`
  - `type MapInput = { nodes: readonly { x: number; z: number }[]; edges: readonly { a: number; b: number; kind: string }[]; road: readonly { x: number; z: number }[]; features: readonly { kind: string; x: number; z: number; radius: number }[]; places: readonly { name: string; x: number; z: number }[]; summitName: string }`
  - `type BoardMap = { scale: number; stem: MapLine[]; side: MapLine[]; road: MapPoint[]; ponds: { x: number; y: number; rx: number; ry: number }[]; rings: { x: number; y: number; rx: number; ry: number }[]; summit: MapPoint | null; labels: { text: string; x: number; y: number }[]; here: MapPoint }`
  - `MAP_MARGIN = 60`, `MAP_RINGS = 5`
  - `boardMap(input: MapInput, inner: { x: number; y: number; width: number; height: number }): BoardMap`

- [ ] **Step 1: Write the failing test**

`client/test/game/boardMap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAP_MARGIN, MAP_RINGS, boardMap, type MapInput } from "../../src/game/boardMap.js";

/** A stem 0 → 1 → 2 straight inland, a loop 1 → 3 → 4 → 2 off to +z, a pond in the loop, the road 9 m behind the pad. */
const world: MapInput = {
  nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 200, z: 0 }, { x: 120, z: 50 }, { x: 180, z: 50 }],
  edges: [
    { a: 0, b: 1, kind: "stem" }, { a: 1, b: 2, kind: "stem" },
    { a: 1, b: 3, kind: "loop" }, { a: 3, b: 4, kind: "loop" }, { a: 4, b: 2, kind: "loop" },
  ],
  road: [-100, -50, 0, 50, 100, 150].map((z) => ({ x: -9, z })),
  features: [{ kind: "peak", x: 200, z: 0, radius: 50 }, { kind: "pond", x: 150, z: 60, radius: 20 }],
  places: [{ name: "Summit", x: 200, z: 0 }, { name: "Old Lake", x: 150, z: 60 }],
  summitName: "Summit",
};
const inner = { x: 100, y: 200, width: 640, height: 480 };

describe("boardMap", () => {
  it("fits the trails inside the sheet with their proportions kept, 60 m of ground round them", () => {
    expect(MAP_MARGIN).toBe(60);
    const m = boardMap(world, inner);
    // 320 m of inland and 170 m along the road into 480 by 640: the height decides.
    expect(m.scale).toBe(1.5);
    for (const l of [...m.stem, ...m.side]) {
      for (const [x, y] of [[l.x0, l.y0], [l.x1, l.y1]] as const) {
        expect(x).toBeGreaterThanOrEqual(100);
        expect(x).toBeLessThanOrEqual(740);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(y).toBeLessThanOrEqual(680);
      }
    }
  });

  it("draws inland up the sheet, and +z to the left", () => {
    const m = boardMap(world, inner);
    expect(m.here).toEqual({ x: 457.5, y: 590 });
    expect(m.summit).toEqual({ x: 457.5, y: 290 });
    // The loop lies toward +z: left of the stem.
    expect(m.side[0]).toEqual({ x0: 457.5, y0: 440, x1: 382.5, y1: 410 });
  });

  it("keeps the stem apart from the trails that leave it", () => {
    const m = boardMap(world, inner);
    expect(m.stem).toEqual([
      { x0: 457.5, y0: 590, x1: 457.5, y1: 440 },
      { x0: 457.5, y0: 440, x1: 457.5, y1: 290 },
    ]);
    expect(m.side).toHaveLength(3);
  });

  it("draws the road where the sheet shows it, the pond, the peak's rings and every name", () => {
    const m = boardMap(world, inner);
    expect(m.road).toEqual([{ x: 532.5, y: 603.5 }, { x: 457.5, y: 603.5 }, { x: 382.5, y: 603.5 }, { x: 307.5, y: 603.5 }]);
    expect(m.ponds).toEqual([{ x: 367.5, y: 365, rx: 30, ry: 30 }]);
    expect(MAP_RINGS).toBe(5);
    expect(m.rings.map((r) => r.rx)).toEqual([15, 30, 45, 60, 75]);
    expect(m.labels).toEqual([{ text: "Summit", x: 457.5, y: 290 }, { text: "Old Lake", x: 367.5, y: 365 }]);
  });

  it("has no summit mark where no place goes by the summit's name", () => {
    expect(boardMap({ ...world, summitName: "Crest" }, inner).summit).toBeNull();
  });

  it("fits a graph of one node", () => {
    const m = boardMap({ nodes: [{ x: 5, z: 5 }], edges: [], road: [], features: [], places: [], summitName: "Summit" }, inner);
    // 120 m each way into 640 by 480.
    expect(m.scale).toBe(4);
    expect(m.here).toEqual({ x: 420, y: 440 });
    expect(m.stem).toEqual([]);
  });

  it("passes over an edge that names a node the graph does not have", () => {
    const m = boardMap({ ...world, edges: [...world.edges, { a: 0, b: 99, kind: "stem" }] }, inner);
    expect(m.stem).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/boardMap.test.ts`
Expected: FAIL, the module `../../src/game/boardMap.js` cannot be found.

- [ ] **Step 3: Write the module**

`client/src/game/boardMap.ts`:

```ts
/**
 * The map on the trailhead board: this world's own trails, laid out on a
 * sheet as a player standing at the road and facing inland would hold it.
 * Up the sheet is inland (+x) and right across it is -z. Pure: plain numbers
 * in pixels, which the painter draws.
 */
export type MapPoint = { x: number; y: number };
export type MapLine = { x0: number; y0: number; x1: number; y1: number };

export type MapInput = {
  nodes: readonly { x: number; z: number }[];
  edges: readonly { a: number; b: number; kind: string }[];
  /** The road's centreline, sampled along z. */
  road: readonly { x: number; z: number }[];
  /** The made features: the peak, the ponds, the meadows. */
  features: readonly { kind: string; x: number; z: number; radius: number }[];
  /** The named places, the summit among them. */
  places: readonly { name: string; x: number; z: number }[];
  /** The name the summit goes by among `places`. */
  summitName: string;
};

export type BoardMap = {
  /** Pixels to a metre. */
  scale: number;
  stem: MapLine[];
  /** Loop, strand and rung edges: drawn dashed. */
  side: MapLine[];
  road: MapPoint[];
  ponds: { x: number; y: number; rx: number; ry: number }[];
  /** Rings round the peak, innermost first. */
  rings: { x: number; y: number; rx: number; ry: number }[];
  summit: MapPoint | null;
  labels: { text: string; x: number; y: number }[];
  /** The pad: node 0. */
  here: MapPoint;
};

/** Metres of ground kept round the trails on every side. */
export const MAP_MARGIN = 60;
export const MAP_RINGS = 5;

/**
 * The map of a world, fitted inside `inner` (a rectangle in pixels) with
 * its proportions kept and centred in whichever direction has room to spare.
 */
export function boardMap(input: MapInput, inner: { x: number; y: number; width: number; height: number }): BoardMap {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const n of input.nodes) {
    if (n.x < x0) x0 = n.x;
    if (n.x > x1) x1 = n.x;
    if (n.z < z0) z0 = n.z;
    if (n.z > z1) z1 = n.z;
  }
  if (input.nodes.length === 0) {
    x0 = 0; x1 = 0; z0 = 0; z1 = 0;
  }
  x0 -= MAP_MARGIN; x1 += MAP_MARGIN; z0 -= MAP_MARGIN; z1 += MAP_MARGIN;
  const scale = Math.min(inner.width / (z1 - z0), inner.height / (x1 - x0));
  const left = inner.x + (inner.width - (z1 - z0) * scale) / 2;
  const top = inner.y + (inner.height - (x1 - x0) * scale) / 2;
  const at = (x: number, z: number): MapPoint => ({ x: left + (z1 - z) * scale, y: top + (x1 - x) * scale });

  const stem: MapLine[] = [], side: MapLine[] = [];
  for (const e of input.edges) {
    const a = input.nodes[e.a], b = input.nodes[e.b];
    if (a === undefined || b === undefined) continue;
    const p = at(a.x, a.z), q = at(b.x, b.z);
    (e.kind === "stem" ? stem : side).push({ x0: p.x, y0: p.y, x1: q.x, y1: q.y });
  }
  const road: MapPoint[] = [];
  for (const r of input.road) if (r.z >= z0 && r.z <= z1) road.push(at(r.x, r.z));

  const ponds: BoardMap["ponds"] = [], rings: BoardMap["rings"] = [];
  for (const f of input.features) {
    const c = at(f.x, f.z);
    if (f.kind === "pond") ponds.push({ x: c.x, y: c.y, rx: f.radius * scale, ry: f.radius * scale });
    if (f.kind === "peak") {
      for (let k = 1; k <= MAP_RINGS; k++) {
        const r = (f.radius * scale * k) / MAP_RINGS;
        rings.push({ x: c.x, y: c.y, rx: r, ry: r });
      }
    }
  }
  let summit: MapPoint | null = null;
  const labels: BoardMap["labels"] = [];
  for (const p of input.places) {
    const c = at(p.x, p.z);
    if (p.name === input.summitName) summit = c;
    labels.push({ text: p.name, x: c.x, y: c.y });
  }
  const pad = input.nodes[0];
  return { scale, stem, side, road, ponds, rings, summit, labels, here: pad === undefined ? at(0, 0) : at(pad.x, pad.z) };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run --root client test/game/boardMap.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/boardMap.ts client/test/game/boardMap.test.ts
git commit
```

Message:

```
feat: draw the world's own trails as a map for the trailhead board

## What

The map on the trailhead board is this world's own trails. This lays them
out on a sheet as a player standing at the road and facing inland would
hold it: up the sheet is inland, the stem a line of its own, the trails
that leave it kept apart to be drawn dashed, with the road, the ponds, the
rings round the peak, the summit's mark, every named place and the pad.
It is plain numbers in pixels; nothing draws it yet.

## How

- `client/src/game/boardMap.ts` — `boardMap`, fitting the graph and 60 m
  of ground round it inside a rectangle with its proportions kept.
- `client/test/game/boardMap.test.ts` — the fit, which way is up, the
  stem apart from the rest, the road, pond, rings and names at known
  places, a graph of one node, and an edge that names a node the graph
  does not have.
```

---

### Task 5: The sheets' wear

**Files:**
- Modify: `client/src/game/labelWear.ts` (export the generator)
- Create: `client/src/game/boardWear.ts`
- Create: `client/test/game/boardWear.test.ts`

**Interfaces:**
- Consumes: `Rect`, `SHEETS`, `sheet` from `game/boardFace.ts` (Task 3); `nameHash` from `game/labelWear.ts`.
- Produces:
  - from `game/labelWear.ts`: `wearGenerator(seed: number): () => number` (the module's own mulberry32, exported under this name)
  - `type SheetWear = { stain: { x: number; y: number; r: number; strength: number }; bleach: { corner: 0 | 1 | 2 | 3; r: number; strength: number }; rust: { strength: number; run: number }[]; fades: { x: number; y: number; r: number; strength: number }[]; ink: number }`
  - `SHEET_INK = { min: 0.62, max: 0.8 }`
  - `sheetWear(worldSeed: number, name: string, rect: Pick<Rect, "width" | "height">): SheetWear`

- [ ] **Step 1: Write the failing test**

`client/test/game/boardWear.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SHEETS, sheet } from "../../src/game/boardFace.js";
import { SHEET_INK, sheetWear } from "../../src/game/boardWear.js";

describe("sheetWear", () => {
  it("is the same for the same world and sheet, and differs for another world or another sheet", () => {
    const a = sheetWear(2032433950, "poster", sheet("poster").rect);
    expect(sheetWear(2032433950, "poster", sheet("poster").rect)).toEqual(a);
    expect(sheetWear(1, "poster", sheet("poster").rect)).not.toEqual(a);
    expect(sheetWear(2032433950, "rules", sheet("poster").rect)).not.toEqual(a);
  });

  it("wears the poster of the world hollow as it always will", () => {
    const w = sheetWear(2032433950, "poster", sheet("poster").rect);
    expect(w.stain.x).toBeCloseTo(134.8957, 3);
    expect(w.stain.y).toBeCloseTo(330.7305, 3);
    expect(w.stain.r).toBeCloseTo(127.6467, 3);
    expect(w.bleach.corner).toBe(3);
    expect(w.rust).toHaveLength(4);
    expect(w.rust[0]!.run).toBeCloseTo(29.4825, 3);
    expect(w.fades).toHaveLength(3);
    expect(w.ink).toBeCloseTo(0.7629, 3);
  });

  it("keeps every mark inside its sheet and the print strong enough to read, over 500 worlds", () => {
    expect(SHEET_INK).toEqual({ min: 0.62, max: 0.8 });
    for (let seed = 0; seed < 500; seed++) {
      for (const s of SHEETS) {
        const w = sheetWear(seed, s.name, s.rect);
        for (const m of [w.stain, ...w.fades]) {
          expect(m.x - m.r, `seed ${seed} ${s.name}`).toBeGreaterThanOrEqual(-1e-9);
          expect(m.x + m.r, `seed ${seed} ${s.name}`).toBeLessThanOrEqual(s.rect.width + 1e-9);
          expect(m.y - m.r, `seed ${seed} ${s.name}`).toBeGreaterThanOrEqual(-1e-9);
          expect(m.y + m.r, `seed ${seed} ${s.name}`).toBeLessThanOrEqual(s.rect.height + 1e-9);
        }
        expect(w.ink).toBeGreaterThanOrEqual(0.62);
        expect(w.ink).toBeLessThanOrEqual(0.8);
        expect(w.fades.length).toBeGreaterThanOrEqual(3);
        expect(w.fades.length).toBeLessThanOrEqual(5);
        for (const r of w.rust) expect(r.run).toBeLessThanOrEqual(0.07 * s.rect.height + 1e-9);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --root client test/game/boardWear.test.ts`
Expected: FAIL, the module `../../src/game/boardWear.js` cannot be found.

- [ ] **Step 3: Export the generator, and write the wear**

In `client/src/game/labelWear.ts`, the private `generator` becomes exported under a name that says what it is for, and its one caller follows:

```ts
/** mulberry32: a small, fast generator of floats in [0, 1). What every seeded wear draws from. */
export function wearGenerator(seed: number): () => number {
```

```ts
  const rand = wearGenerator(nameHash(name));
```

`client/src/game/boardWear.ts`:

```ts
/**
 * The wear on the trailhead board's sheets: a water stain, a sun-bleached
 * corner, rust under each staple and the print faded in patches. Every
 * choice comes from a generator seeded by the world's seed and the sheet's
 * name, so each peer sees the same marks, and all of it is plain numbers the
 * painter applies. The routed lines across the top wear as the fork signs'
 * lettering does (`labelWear`).
 */
import { nameHash, wearGenerator } from "./labelWear.js";
import type { Rect } from "./boardFace.js";

export type SheetWear = {
  /** A water stain: a soft brown patch, its centre and radius in the sheet's own pixels. */
  stain: { x: number; y: number; r: number; strength: number };
  /** The corner the sun has bleached, counted clockwise from the top-left, and how far it reaches. */
  bleach: { corner: 0 | 1 | 2 | 3; r: number; strength: number };
  /** Rust under each staple, clockwise from the top-left: how dark, and how far it has run down the sheet. */
  rust: { strength: number; run: number }[];
  /** Patches where what is printed has faded: `strength` of it gone at the centre, none at the rim. */
  fades: { x: number; y: number; r: number; strength: number }[];
  /** How much of the print's strength is left over the whole sheet. */
  ink: number;
};

/** The print keeps this much of its strength at the least: faded, still read. */
export const SHEET_INK = { min: 0.62, max: 0.8 } as const;

/** The wear of one sheet of a world's board. Every mark lies inside the sheet. */
export function sheetWear(worldSeed: number, name: string, rect: Pick<Rect, "width" | "height">): SheetWear {
  const rand = wearGenerator((nameHash(name) ^ worldSeed) >>> 0);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
  const short = Math.min(rect.width, rect.height);
  const stainR = between(0.18, 0.32) * short;
  const stain = {
    x: between(stainR, rect.width - stainR),
    // Low on the sheet, where water gathers, and wholly inside it.
    y: between(Math.max(stainR, 0.45 * rect.height), rect.height - stainR),
    r: stainR,
    strength: between(0.18, 0.34),
  };
  const bleach = {
    corner: Math.floor(rand() * 4) as 0 | 1 | 2 | 3,
    r: between(0.35, 0.6) * short,
    strength: between(0.2, 0.4),
  };
  const rust = [0, 1, 2, 3].map(() => ({ strength: between(0.25, 0.6), run: between(0.02, 0.07) * rect.height }));
  const fades: SheetWear["fades"] = [];
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const r = between(0.12, 0.28) * short;
    fades.push({ x: between(r, rect.width - r), y: between(r, rect.height - r), r, strength: between(0.2, 0.45) });
  }
  return { stain, bleach, rust, fades, ink: between(SHEET_INK.min, SHEET_INK.max) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --root client test/game/boardWear.test.ts test/game/labelWear.test.ts test/game/signMeshes.test.ts`
Expected: PASS. The fork signs' wear is unchanged: the generator is the same function under an exported name.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/labelWear.ts client/src/game/boardWear.ts client/test/game/boardWear.test.ts
git commit
```

Message:

```
feat: wear the trailhead board's sheets from the world's seed

## What

Each sheet on the trailhead board takes a water stain low on the sheet, a
sun-bleached corner, rust under its staples and its print faded in
patches. The marks come from the world's seed and the sheet's name, so
every player sees the same ones, and every mark lies inside its sheet.
They are plain numbers; nothing draws them yet.

## How

- `client/src/game/labelWear.ts` — its generator is exported as
  `wearGenerator`; the fork signs' wear draws from it as before.
- `client/src/game/boardWear.ts` — `sheetWear`.
- `client/test/game/boardWear.test.ts` — the same wear for the same world
  and sheet, the poster's wear on the world `hollow`, and over 500 worlds
  every mark inside its sheet and the print between 0.62 and 0.8 of its
  strength.
```

---

### Task 6: The board stands at the entrance

The simulation's side, and enough of the game's that the board is drawn where it stands. The face still carries the old painted poster after this task; Task 7 replaces it.

**Files:**
- Modify: `client/src/sim/trailhead.ts`, `client/src/sim/passes/trailhead.ts`
- Modify: `client/src/sim/signs.ts`, `client/src/sim/passes/signs.ts`
- Modify: `client/src/sim/search.ts`, `client/src/sim/world.ts`
- Modify: `client/src/sim/forest.ts` (the probe's record)
- Modify: `client/src/game/trailheadMeshes.ts`, `client/src/app.ts`
- Modify: `client/test/sim/trailhead.test.ts`, `signs.test.ts`, `search.test.ts`, `searchSweep.test.ts`, `groundGradient.test.ts`
- Modify: `client/test/game/trailheadMeshes.test.ts`

**Interfaces:**
- Consumes: `trailEntrance`, `bedGap`, `carSite`, `trailheadSpawn`, `Start`, `EntranceGraph` (Task 1); `segmentBoxGap`, `Ground` from `sim/boxGap.ts`.
- Produces, from `client/src/sim/trailhead.ts`:
  - `BOARD_ALONG = 2.5`, `BOARD_OFFSET = 2.5`, `BOARD_BED_CLEAR = 1.15`, `BOARD_ROAD_CLEAR = 6`, `BOARD_BOX_HALF: Vec3 = { x: 0.275, y: 1.25, z: 0.275 }`, `BOARD_BOX_STEP = 0.44`, `BOARD_BOXES = 5`
  - `type Board = { x: number; z: number; fx: number; fz: number; ax: number; az: number }` — the centre, the unit direction the face looks, and the board's own line, which is the player's right as they look at it
  - `boardBoxes(board: Board): Ground[]`
  - `boardSite(graph: EntranceGraph, roadCenterX: (seed: number, z: number) => number, seed: number, start: Ground): Board`
  - `type TrailheadPlaces = { car: Ground; start: Start; board: Board }`, `trailheadPlaces(graph, roadCenterX, seed): TrailheadPlaces`
  - removed: `KIOSK_HALF`, `SIGN_ROAD_U`, `SIGN_ROAD_Z`, `RoadProp`, `PROPS`, `roadProp`, `kioskFacing`, `propSite`, `trailheadSite`
- Produces, from `client/src/sim/search.ts`: `POSTER_ALONG = 0.36`, `POSTER_HEIGHT = 1.32`; `SearchInput.board: Board` in place of `SearchInput.kiosk`.
- Produces, from `client/src/sim/signs.ts`: removed `trailSignSite`, `trailSign`, `allSignPosts`; `TRAIL_NAME` stays.
- Produces, from `client/src/game/trailheadMeshes.ts`: `TrailheadSites = { car: { site; trailhead }; board: Board }`.

- [ ] **Step 1: Write the failing tests for the board's place**

In `client/test/sim/trailhead.test.ts`:

The import from the geometry becomes

```ts
import {
  BOARD_BOX_HALF, CAR_HALF, bedGap, boardBoxes, boardSite, carSite, trailEntrance, trailheadPlaces,
} from "../../src/sim/trailhead.js";
```

and the import from `signs.js` goes.

Delete these tests: `"holds two props, the kiosk and the car, found by material"`, `"gives the car by its own rule and the board by the mirrored one"`, and the whole of `describe("the trail's sign on real worlds", …)`.

Replace `"emits one kiosk and one car at the trailhead, once, in the road frame"` with:

```ts
  it("emits one car and the board's five boxes at the trailhead, once", () => {
    for (const seed of [0x5eed, 1, 12345]) {
      const v = terrainVariant("olympic")!;
      const graph = v.trailGraph!(seed);
      const th = graph.trailhead;
      const grid = createChunkGrid(seed);
      const props = propsAround(grid, th.x, th.z);
      expect(props.filter((b) => b.material === "car"), `seed ${seed}`).toHaveLength(1);
      const kiosks = props.filter((b) => b.material === "kiosk");
      expect(kiosks, `seed ${seed}`).toHaveLength(5);
      const places = trailheadPlaces(graph, v.roadCenterX!, seed);
      const centres = boardBoxes(places.board);
      for (const c of centres) {
        const box = kiosks.find((b) => Math.abs(b.box.min.x + 0.275 - c.x) < 1e-6 && Math.abs(b.box.min.z + 0.275 - c.z) < 1e-6);
        expect(box, `seed ${seed} box at ${c.x}, ${c.z}`).toBeDefined();
        expect(box!.box.max.x - box!.box.min.x).toBeCloseTo(0.55, 6);
        expect(box!.box.max.y - box!.box.min.y).toBeCloseTo(2.5, 6);
        expect(box!.box.max.z - box!.box.min.z).toBeCloseTo(0.55, 6);
      }
      // The post at the entrance is gone: the only sign posts are the junctions'.
      expect(props.filter((b) => b.material === "signpost" && Math.hypot(b.box.min.x - th.x, b.box.min.z - th.z) < 12), `seed ${seed}`).toHaveLength(0);
    }
  }, timeLimit(60_000));
```

In `"keeps every trailhead prop off the road bed AND clear of the trail bed, over the 227-seed sweep"`, replace the loop `for (const p of PROPS) { … }` with the car's clauses alone, and rename the test `"keeps the car off the road bed and clear of the trail bed, over the 227-seed sweep"`:

```ts
    let worstRoad = Infinity, worstRoadSeed = 0;
    let worstBed = Infinity, worstBedSeed = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const site = carSite(graph, v.roadCenterX!, seed);
      const rx = roadCenterXOf(seed, site.z);
      const road = (site.x - CAR_HALF.x) - rx - (ROAD_BED_HALF + 0.5);
      if (road < worstRoad) { worstRoad = road; worstRoadSeed = seed; }
      const bed = bedGap(graph, site, CAR_HALF) - 1.15;
      if (bed < worstBed) { worstBed = bed; worstBedSeed = seed; }
    }
    console.info(`[trailhead] car: worst road margin ${worstRoad.toFixed(2)} m, worst bed margin ${worstBed.toFixed(2)} m`);
    expect(worstRoad, `off the road bed, worst seed ${worstRoadSeed}`).toBeGreaterThanOrEqual(-1e-9);
    expect(worstBed, `clear of the trail bed, worst seed ${worstBedSeed}`).toBeGreaterThanOrEqual(0);
```

In `"stands the player in front of the car, facing the trail's entrance, on every seed"`, the board's gap is to its boxes. Replace the two lines that read the board with:

```ts
      const board = boardSite(graph, v.roadCenterX!, seed, s);
```

```ts
      for (const b of boardBoxes(board)) boardGap = Math.min(boardGap, gapTo(s.x, s.z, b, BOARD_BOX_HALF));
```

and its bound `expect(boardGap).toBeGreaterThanOrEqual(3);` becomes `expect(boardGap).toBeGreaterThanOrEqual(6);`. The console line's `m from the board` reads the same variable.

Add at the end of the file:

```ts
describe("the board's place", () => {
  // The pad at the origin, the road along z at x = -9, the stem straight inland: the entrance is (8, 0).
  const inland = padGraph([[0, 0], [100, 0]], [[0, 1, "stem"]]);

  it("stands the board 2.5 m past the entrance and 2.5 m off the bed, facing where the player arrives", () => {
    const b = boardSite(inland, straightRoad, 1, { x: 1.3, z: -1 });
    expect(b.x).toBeCloseTo(10.5, 9);
    expect(b.z).toBeCloseTo(2.5, 9);
    expect(b.fx).toBeCloseTo(-0.9346485776323319, 9);
    expect(b.fz).toBeCloseTo(-0.3555728284470828, 9);
    // Its own line is the player's right as they look at it: the facing turned a quarter turn.
    expect(b.ax).toBeCloseTo(0.3555728284470828, 9);
    expect(b.az).toBeCloseTo(-0.9346485776323319, 9);
  });

  it("takes the side toward which the player looks: a player off to -z looks across to +z", () => {
    expect(boardSite(inland, straightRoad, 1, { x: 1.3, z: -1 }).z).toBeCloseTo(2.5, 9);
    expect(boardSite(inland, straightRoad, 1, { x: 1.3, z: 1 }).z).toBeCloseTo(-2.5, 9);
  });

  it("takes +n where the two sides are as near the view's centre as each other", () => {
    const b = boardSite(inland, straightRoad, 1, { x: 1.3, z: 0 });
    expect(b.z).toBeCloseTo(2.5, 9);
    expect(b.fx).toBeCloseTo(-0.9650054712111679, 9);
    expect(b.fz).toBeCloseTo(-0.2622297476117304, 9);
  });

  it("takes the side that clears when the other does not", () => {
    // A second bed runs along +z just past the entrance, through where the board would stand on that side.
    const g = padGraph([[0, 0], [100, 0], [10, 1.2], [10, 60]], [[0, 1, "stem"], [2, 3, "loop"]]);
    expect(boardSite(g, straightRoad, 1, { x: 1.3, z: -1 }).z).toBeCloseTo(-2.5, 9);
  });

  it("takes the nearer side when neither clears", () => {
    const g = padGraph(
      [[0, 0], [100, 0], [10, 1.2], [10, 60], [10, -1.2], [10, -60]],
      [[0, 1, "stem"], [2, 3, "loop"], [4, 5, "loop"]],
    );
    expect(boardSite(g, straightRoad, 1, { x: 1.3, z: -1 }).z).toBeCloseTo(2.5, 9);
  });

  it("lays five boxes along the board's own line, 2.31 m from end to end at any facing", () => {
    const b = boardSite(inland, straightRoad, 1, { x: 1.3, z: 0 });
    const boxes = boardBoxes(b);
    expect(boxes).toHaveLength(5);
    expect(boxes[2]).toEqual({ x: b.x, z: b.z });
    expect(boxes[0]!.x).toBeCloseTo(10.269237822101678, 9);
    expect(boxes[0]!.z).toBeCloseTo(3.3492048146658275, 9);
    expect(boxes[4]!.x).toBeCloseTo(10.730762177898322, 9);
    expect(boxes[4]!.z).toBeCloseTo(1.6507951853341722, 9);
    expect(Math.hypot(boxes[4]!.x - boxes[0]!.x, boxes[4]!.z - boxes[0]!.z) + 0.55).toBeCloseTo(2.31, 9);
    expect(BOARD_BOX_HALF).toEqual({ x: 0.275, y: 1.25, z: 0.275 });
  });

  it("stands in the player's view, clear of the bed, the road and the car, on every seed", () => {
    const v = terrainVariant("olympic")!;
    const boxGap = (a: { x: number; z: number }, c: { x: number; z: number }, h: { x: number; z: number }): number =>
      Math.hypot(Math.max(Math.abs(a.x - c.x) - 0.275 - h.x, 0), Math.max(Math.abs(a.z - c.z) - 0.275 - h.z, 0));
    let farEnd = 0, nearest = Infinity, farthest = 0, bed = Infinity, road = Infinity, carGap = Infinity, turned = 0;
    let plus = 0, minus = 0;
    for (const seed of SEEDS) {
      const graph = v.trailGraph!(seed);
      const { car, start: s, board: b } = trailheadPlaces(graph, v.roadCenterX!, seed);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const off = (x: number, z: number): number => {
        const d = Math.hypot(x - s.x, z - s.z);
        return (Math.acos(Math.max(-1, Math.min(1, ((x - s.x) * fx + (z - s.z) * fz) / d))) * 180) / Math.PI;
      };
      farEnd = Math.max(farEnd, off(b.x + b.ax * 1.1, b.z + b.az * 1.1), off(b.x - b.ax * 1.1, b.z - b.az * 1.1));
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      nearest = Math.min(nearest, d);
      farthest = Math.max(farthest, d);
      turned = Math.max(turned, Math.abs(b.fx * ((s.x - b.x) / d) + b.fz * ((s.z - b.z) / d) - 1));
      for (const box of boardBoxes(b)) {
        bed = Math.min(bed, bedGap(graph, box, BOARD_BOX_HALF));
        road = Math.min(road, box.x - 0.275 - roadCenterXOf(seed, box.z));
        carGap = Math.min(carGap, boxGap(box, car, CAR_HALF));
      }
      const e = trailEntrance(graph);
      if ((b.x - e.x) * -e.dz + (b.z - e.z) * e.dx > 0) plus++;
      else minus++;
    }
    console.info(`[trailhead] board: far end ${farEnd.toFixed(2)} deg off the facing at most, ${nearest.toFixed(2)}-${farthest.toFixed(2)} m from the player, bed ${bed.toFixed(2)} m, road ${road.toFixed(2)} m, car ${carGap.toFixed(2)} m, sides +n ${plus} -n ${minus}`);
    expect(farEnd).toBeLessThanOrEqual(25);
    expect(nearest).toBeGreaterThanOrEqual(6.5);
    expect(farthest).toBeLessThanOrEqual(10);
    expect(bed).toBeGreaterThanOrEqual(1.15);
    expect(road).toBeGreaterThanOrEqual(6);
    expect(carGap).toBeGreaterThanOrEqual(8.5);
    expect(turned).toBeLessThan(1e-9);
    expect([plus, minus]).toEqual([63, 164]);
  }, timeLimit(300000));
});
```

In `client/test/sim/signs.test.ts`: delete the whole of `describe("the trail's sign", …)`, take `allSignPosts`, `trailSign` and `trailSignSite` out of the import, and add to `describe("signPosts", …)`:

```ts
  it("keeps the trail's name", () => {
    expect(TRAIL_NAME).toBe("Trail 14");
  });
```

In `client/test/sim/search.test.ts`, every `buildSearch({ … kiosk: { x: 0, z: -20 }, … })` takes a board in the kiosk's place. Add above `describe("buildSearch"`:

```ts
/** A board at (0, -20) whose face looks toward +z: its own line runs toward -x. */
const board = { x: 0, z: -20, fx: 0, fz: 1, ax: -1, az: 0 };
```

replace `kiosk: { x: 0, z: -20 }` with `board` throughout, and:

- in `"names one hiker and puts the body on the crest facing down the stem"`, the poster's expectations become

```ts
    // The poster's sheet is 0.36 m along the board's own line from its centre,
    // 0.325 m in front of it (the boxes' half-depth and 0.05 m), 1.32 m up.
    expect(r.poster.x).toBeCloseTo(-0.36, 9);
    expect(r.poster.y).toBeCloseTo(1.32, 9);
    expect(r.poster.z).toBeCloseTo(-19.675, 9);
```

- replace `"faces the poster back toward the pad when the kiosk stands on its +z side"` with

```ts
  it("hangs the poster on the face of a board that looks any way", () => {
    const turned = { x: 5, z: 7, fx: -0.6, fz: -0.8, ax: 0.8, az: -0.6 };
    const r = buildSearch({ seed: 7, graph: graph(1), groundH: () => 2, board: turned, car: { x: 30, z: -20 } });
    expect(r.poster.x).toBeCloseTo(5.093, 9);
    expect(r.poster.y).toBeCloseTo(3.32, 9);
    expect(r.poster.z).toBeCloseTo(6.524, 9);
  });
```

- in `"resolves the poster for a player standing in front of the kiosk, facing it"` (rename it `"… in front of the poster, facing it"`), the player stands a metre in front of the poster's point:

```ts
    player.pos = { x: -0.36, y: 0.9, z: -18.675 }; player.yaw = Math.PI; player.pitch = 0;
```

In `client/test/sim/searchSweep.test.ts`, the import becomes `import { trailheadPlaces } from "../../src/sim/trailhead.js";`, and the loop's body reads the places once:

```ts
      const { graph } = bowlFor(seed);
      const places = trailheadPlaces(graph, activeTerrainVariant().roadCenterX!, seed);
      const r = buildSearch({ seed, graph, groundH: (x, z) => elevationAt(seed, x, z), board: places.board, car: places.car });
```

and the poster's two expectations become

```ts
      // The poster hangs 0.36 m along the board and 0.325 m in front of it, toward where a player arrives.
      const b = places.board;
      expect(Math.hypot(r.poster.x - b.x, r.poster.z - b.z), `seed ${seed}`).toBeCloseTo(0.485, 3);
      expect((r.poster.x - b.x) * b.fx + (r.poster.z - b.z) * b.fz, `seed ${seed}`).toBeCloseTo(0.325, 9);
```

Rename the test `"… and hangs the poster on the board's face"`.

- [ ] **Step 2: Write the failing tests for the drawn board**

In `client/test/game/trailheadMeshes.test.ts`, the sites become

```ts
/** The car parked 12 m short of the trailhead along +z; the board 7 m past it, its face looking back (-z). */
const SITES: TrailheadSites = {
  car: { site: { x: 10, z: 20 }, trailhead: { x: 1, z: 32 } },
  board: { x: 6, z: 39, fx: 0, fz: -1, ax: 1, az: 0 },
};
```

In `"draws the sim's two boxes until the models arrive, then places each model on its site"` (rename it `"draws the sim's boxes until the models arrive, …"`), the kiosk's box becomes five:

```ts
    const carBox = scene.getMeshByName("trailhead_car_box") as Mesh;
    const boardBoxes = [0, 1, 2, 3, 4].map((k) => scene.getMeshByName(`trailhead_kiosk_box_${k}`) as Mesh);
    expect(boxMaterials).toEqual(["car", "kiosk", "kiosk", "kiosk", "kiosk", "kiosk"]);
```

```ts
    // The board's five: 0.55 x 2.5 x 0.55 each, 0.44 m apart along the board's own line (+x here).
    expect(boardBoxes.map((b) => +b.position.x.toFixed(6))).toEqual([5.12, 5.56, 6, 6.44, 6.88]);
    for (const b of boardBoxes) {
      const e = b.getBoundingInfo().boundingBox.extendSize;
      expect([e.x, e.y, e.z].map((v) => +v.toFixed(6))).toEqual([0.275, 1.25, 0.275]);
      expect(b.position.z).toBe(39);
    }
    // Each stands on the ground at its own centre: 3 + 0.01 x - 0.02 z, and half its height.
    expect(boardBoxes[0]!.position.y).toBeCloseTo(3.5212, 9);
    expect(boardBoxes[4]!.position.y).toBeCloseTo(3.5388, 9);
    expect(shadowed.has(carBox) && boardBoxes.every((b) => shadowed.has(b))).toBe(true);
```

and after the release:

```ts
    expect(scene.getMeshByName("trailhead_car_box")).toBeNull();
    for (const k of [0, 1, 2, 3, 4]) expect(scene.getMeshByName(`trailhead_kiosk_box_${k}`)).toBeNull();
    expect(shadowed.has(carBox) || boardBoxes.some((b) => shadowed.has(b))).toBe(false);
```

The placed model's expectations stand as they are: the board is at (6, 39), its face toward -z, and its yaw is π.

In `"keeps the boxes, and paints nothing, when the models never load"`:

```ts
    expect(scene.getMeshByName("trailhead_kiosk_box_0")).not.toBeNull();
    expect(scene.getMeshByName("trailhead_kiosk_box_4")).not.toBeNull();
    expect(shadowed.size).toBe(6);
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run --root client test/sim/trailhead.test.ts test/sim/search.test.ts test/game/trailheadMeshes.test.ts`
Expected: FAIL. `boardSite`, `boardBoxes` and `trailheadPlaces` are not exported; `buildSearch` takes no `board`; `TrailheadSites` has no `board`.

- [ ] **Step 4: Write the board's place**

In `client/src/sim/trailhead.ts`:

Delete `KIOSK_HALF`, `SIGN_ROAD_U`, `SIGN_ROAD_Z`, `RoadProp`, `PROPS`, `roadProp`, `kioskFacing`, `propSite` and `trailheadSite`, with their comments, and the header's paragraphs about the road frame and the mirrored site (from `THE BOARD STANDS IN THE ROAD FRAME` to `Props are found by material (\`roadProp\`), never by their place in PROPS.`). The header's first paragraph becomes:

```ts
/**
 * The trailhead's places: the ranger's car, where a player arrives, and the
 * roofed notice board at the trail's entrance. The drawn models stand on
 * boxes; the boxes are what a hiker collides with. Everything follows from
 * the seed and the trail graph, so every peer places it alike with nothing
 * on the wire.
 *
 * Pure geometry and constants. Pass 8 (passes/trailhead.ts) emits the boxes;
 * this module registers nothing, so reading a constant from it has no effect.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
```

Add `import { ROAD_BED_HALF } from "./road.js";` if the deletions removed its last use, and add after `trailheadSpawn`:

```ts
/** How far past the entrance, along the trail, the board stands. Over the
 * 227-seed sweep the whole board is then within 24.72 degrees of the centre
 * of the player's view, which an upright phone's 25 degrees still shows. */
export const BOARD_ALONG = 2.5;
/** The board's centre from the bed's centreline. */
export const BOARD_OFFSET = 2.5;
/** The bed's half-width and a player's, as for the car. */
export const BOARD_BED_CLEAR = TRAIL_BED_HALF + PLAYER_HALF.x;
/** The shoulder the car keeps. */
export const BOARD_ROAD_CLEAR = ROAD_BED_HALF + 0.5;
/**
 * A box cannot turn, and the board faces any way, so its solid shape is a
 * row of small boxes along its own line: BOARD_BOXES of them, BOARD_BOX_STEP
 * apart, 2.31 m from end to end and nowhere thicker than 0.78 m. The roof
 * overhangs the row, above a hiker's head, and has no box.
 */
export const BOARD_BOX_HALF: Vec3 = { x: 0.275, y: 1.25, z: 0.275 };
export const BOARD_BOX_STEP = 0.44;
export const BOARD_BOXES = 5;

/** The board's centre, the unit direction its face looks (`f`), and its own
 * line (`a`): the player's right as they look at it. */
export type Board = { x: number; z: number; fx: number; fz: number; ax: number; az: number };

/** The centres of the board's boxes, from the player's left to their right. */
export function boardBoxes(board: Board): Ground[] {
  const out: Ground[] = [];
  const mid = (BOARD_BOXES - 1) / 2;
  for (let k = 0; k < BOARD_BOXES; k++) {
    const s = (k - mid) * BOARD_BOX_STEP;
    out.push({ x: board.x + board.ax * s, z: board.z + board.az * s });
  }
  return out;
}

/**
 * Where the board stands: BOARD_ALONG past the entrance along the trail and
 * BOARD_OFFSET to one side of the bed, facing the place a player arrives.
 * Of the two sides it takes the one that clears the road and the bed; where
 * both do, or neither does, the one nearer the centre of the player's view,
 * which is the line from where they arrive to the entrance; a tie goes to
 * the side of `n`, the trail's direction turned a quarter turn. Over the
 * 227-seed sweep both sides clear on 218 seeds and one on 9.
 */
export function boardSite(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
  start: Ground,
): Board {
  const e = trailEntrance(graph);
  const nx = -e.dz, nz = e.dx;
  let vx = e.x - start.x, vz = e.z - start.z;
  const vl = Math.sqrt(vx * vx + vz * vz);
  vx = vl > 0 ? vx / vl : e.dx;
  vz = vl > 0 ? vz / vl : e.dz;
  const at = (side: number): { board: Board; clears: boolean; centred: number } => {
    const x = e.x + e.dx * BOARD_ALONG + side * nx * BOARD_OFFSET;
    const z = e.z + e.dz * BOARD_ALONG + side * nz * BOARD_OFFSET;
    const tx = start.x - x, tz = start.z - z;
    const tl = Math.sqrt(tx * tx + tz * tz);
    const fx = tl > 0 ? tx / tl : -e.dx, fz = tl > 0 ? tz / tl : -e.dz;
    const board: Board = { x, z, fx, fz, ax: -fz, az: fx };
    let clears = true;
    for (const b of boardBoxes(board)) {
      if (b.x - BOARD_BOX_HALF.x - roadCenterX(seed, b.z) < BOARD_ROAD_CLEAR) clears = false;
      if (bedGap(graph, b, BOARD_BOX_HALF) < BOARD_BED_CLEAR) clears = false;
    }
    // The cosine of the angle between the view's centre and the way to the
    // board: nearer 1 is nearer the centre.
    return { board, clears, centred: -(fx * vx + fz * vz) };
  };
  const plus = at(1), minus = at(-1);
  if (plus.clears !== minus.clears) return plus.clears ? plus.board : minus.board;
  return minus.centred > plus.centred ? minus.board : plus.board;
}

export type TrailheadPlaces = { car: Ground; start: Start; board: Board };

/** The trailhead's three places for a world, each from the one before it. */
export function trailheadPlaces(
  graph: EntranceGraph,
  roadCenterX: (seed: number, z: number) => number,
  seed: number,
): TrailheadPlaces {
  const car = carSite(graph, roadCenterX, seed);
  const start = trailheadSpawn(graph, car);
  return { car, start, board: boardSite(graph, roadCenterX, seed, start) };
}
```

`client/src/sim/passes/trailhead.ts` becomes:

```ts
import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import type { Vec3 } from "../types.js";
import {
  BOARD_ALONG, BOARD_BED_CLEAR, BOARD_BOX_HALF, BOARD_BOX_STEP, BOARD_BOXES, BOARD_OFFSET, BOARD_ROAD_CLEAR,
  CAR_BED_CLEAR, CAR_HALF, CAR_MATERIAL, CAR_ROAD_U, CAR_ROAD_Z, CAR_SLIDE_MAX, CAR_SLIDE_STEP,
  KIOSK_MATERIAL, SPAWN_GAP, boardBoxes, trailheadPlaces,
} from "../trailhead.js";

/** Pass 8. Emits the car's box and the board's five, each into the chunk
 * that contains its own centre, so a box is emitted exactly once even when
 * it straddles a chunk edge — the collision broadphase surfaces every chunk
 * a query overlaps. Where they stand is `sim/trailhead.ts`'s to say. */
registerPass({
  id: 8,
  name: "trailhead",
  get tunables() {
    return {
      CAR_HALF_X: CAR_HALF.x, CAR_HALF_Y: CAR_HALF.y, CAR_HALF_Z: CAR_HALF.z,
      CAR_ROAD_U, CAR_ROAD_Z, CAR_BED_CLEAR, CAR_SLIDE_STEP, CAR_SLIDE_MAX, SPAWN_GAP,
      BOARD_ALONG, BOARD_OFFSET, BOARD_BED_CLEAR, BOARD_ROAD_CLEAR,
      BOARD_BOX_HALF_X: BOARD_BOX_HALF.x, BOARD_BOX_HALF_Y: BOARD_BOX_HALF.y, BOARD_BOX_HALF_Z: BOARD_BOX_HALF.z,
      BOARD_BOX_STEP, BOARD_BOXES,
    };
  },
  run(chunk, worldSeed) {
    const variant = activeTerrainVariant();
    const graph = variant.trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const roadCenterX = variant.roadCenterX;
    if (roadCenterX === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE;
    const minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE;
    const maxZ = minZ + CHUNK_SIZE;
    const places = trailheadPlaces(graph, roadCenterX, worldSeed);
    const boxes: { material: string; half: Vec3; x: number; z: number }[] = [
      { material: CAR_MATERIAL, half: CAR_HALF, x: places.car.x, z: places.car.z },
      ...boardBoxes(places.board).map((b) => ({ material: KIOSK_MATERIAL, half: BOARD_BOX_HALF, x: b.x, z: b.z })),
    ];
    for (const b of boxes) {
      if (b.x < minX || b.x >= maxX || b.z < minZ || b.z >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, b.x, b.z).h;
      chunk.props.push({
        material: b.material,
        box: {
          min: { x: b.x - b.half.x, y: ground, z: b.z - b.half.z },
          max: { x: b.x + b.half.x, y: ground + 2 * b.half.y, z: b.z + b.half.z },
        },
      });
    }
  },
});
```

- [ ] **Step 5: Take the post at the entrance out**

In `client/src/sim/signs.ts`: delete `trailSignSite`, `trailSign` and `allSignPosts` with their comments, and the imports of `Ground`, `trailEntrance` and `EntranceGraph`. The header's first sentence loses `; and one more post at the trail's entrance, whose one plank names the trail`. `TRAIL_NAME` stays, its comment becoming `/** The trail's name, as the board at its entrance and the poster give it. */`.

`client/src/sim/passes/signs.ts` goes back to the junction posts alone:

```ts
import { registerPass } from "../chunk.js";
import { CHUNK_SIZE } from "../forestConstants.js";
import { activeTerrainVariant, elevationSampleAt } from "../terrain.js";
import { SIGN_POST_HALF, SIGN_POST_OFFSET, signPostSites } from "../signs.js";

/** Pass 9. The sign posts' collision boxes, one per junction, emitted into the
 * chunk holding the post's centre, like the trailhead pass. The arms and
 * their names are render-only (`game/signMeshes.ts`), so the pass needs the
 * graph and nothing else. */
registerPass({
  id: 9,
  name: "signs",
  get tunables() {
    return { SIGN_POST_OFFSET, SIGN_POST_HALF_X: SIGN_POST_HALF.x, SIGN_POST_HALF_Y: SIGN_POST_HALF.y };
  },
  run(chunk, worldSeed) {
    const graph = activeTerrainVariant().trailGraph?.(worldSeed);
    if (graph === undefined) return;
    const minX = chunk.cx * CHUNK_SIZE, minZ = chunk.cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE, maxZ = minZ + CHUNK_SIZE;
    for (const p of signPostSites(graph)) {
      if (p.x < minX || p.x >= maxX || p.z < minZ || p.z >= maxZ) continue;
      const ground = elevationSampleAt(worldSeed, p.x, p.z).h;
      chunk.props.push({
        material: "signpost",
        box: {
          min: { x: p.x - SIGN_POST_HALF.x, y: ground, z: p.z - SIGN_POST_HALF.z },
          max: { x: p.x + SIGN_POST_HALF.x, y: ground + 2 * SIGN_POST_HALF.y, z: p.z + SIGN_POST_HALF.z },
        },
      });
    }
  },
});
```


- [ ] **Step 6: Hang the poster on the board**

In `client/src/sim/search.ts`:

```ts
import { BOARD_BOX_HALF, CAR_HALF, type Board } from "./trailhead.js";
```

```ts
export const POSTER_RADIUS = 0.4;
/** How far along the board's own line, from its centre, the poster's sheet is centred. */
export const POSTER_ALONG = 0.36;
/** Height above the ground at the board's centre of the poster's centre: a little under a hiker's eye. */
export const POSTER_HEIGHT = 1.32;
/** How far the poster's point stands in front of the board's boxes. */
export const POSTER_STANDOFF = 0.05;
```

`SearchInput.kiosk` becomes

```ts
  /** The board, and the car's place (`trailheadPlaces`). */
  board: Board;
  car: { x: number; z: number };
```

`buildSearch` reads `poster: posterPoint(input.board, groundH),` and `posterPoint` becomes

```ts
/**
 * The poster's centre: POSTER_ALONG along the board's own line from its
 * centre, in front of the board's boxes by POSTER_STANDOFF, POSTER_HEIGHT
 * above the ground at the board's centre.
 */
function posterPoint(board: Board, groundH: (x: number, z: number) => number): Vec3 {
  const out = BOARD_BOX_HALF.z + POSTER_STANDOFF;
  return {
    x: board.x + board.ax * POSTER_ALONG + board.fx * out,
    y: groundH(board.x, board.z) + POSTER_HEIGHT,
    z: board.z + board.az * POSTER_ALONG + board.fz * out,
  };
}
```

The header's `poster on the trailhead kiosk` becomes `poster on the trailhead board`.

In `client/src/sim/world.ts`:

```ts
import { trailheadPlaces } from "./trailhead.js";
```

```ts
  // The board and the car stand where the trailhead pass put them, and the
  // poster comes from the same seed on every peer.
  const roadCenterX = variant.roadCenterX;
  if (graph !== undefined && roadCenterX !== undefined) {
    const places = trailheadPlaces(graph, roadCenterX, forest.seed);
    installSearch(
      world,
      buildSearch({
        seed: forest.seed,
        graph,
        groundH: (x, z) => elevationAt(forest.seed, x, z),
        board: places.board,
        car: places.car,
      }),
    );
  }
```

- [ ] **Step 7: Draw the board where it stands**

In `client/src/game/trailheadMeshes.ts`:

```ts
import { BOARD_BOX_HALF, CAR_HALF, CAR_MATERIAL, KIOSK_MATERIAL, boardBoxes, type Board } from "../sim/trailhead.js";
```

```ts
export type TrailheadSites = {
  /** The car's footprint centre, and the trailhead it is parked beside. */
  car: { site: Site; trailhead: Site };
  /** The board: its centre, the way its face looks, and its own line. */
  board: Board;
};
```

`fallbackBox` takes the box's name, so the board's five can each have one:

```ts
  function fallbackBox(name: string, material: string, site: Site, half: Vec3): Mesh {
    const ground = groundH(site.x, site.z);
    const mesh = MeshBuilder.CreateBox(name, { width: 2 * half.x, height: 2 * half.y, depth: 2 * half.z }, scene);
```

```ts
  const carBox = fallbackBox("trailhead_car_box", CAR_MATERIAL, sites.car.site, CAR_HALF);
  const kioskBoxes = boardBoxes(sites.board).map((b, k) => fallbackBox(`trailhead_kiosk_box_${k}`, KIOSK_MATERIAL, b, BOARD_BOX_HALF));
```

`place` takes the boxes it replaces as a list (`boxes: readonly Mesh[]`, and `for (const box of boxes) dropBox(box);`), and the two calls become

```ts
    place(TRAILHEAD_CAR_OUTPUT, "trailhead_car", sites.car.site, carYaw(sites.car.site, sites.car.trailhead), [carBox]),
    place(
      TRAILHEAD_KIOSK_OUTPUT, "trailhead_kiosk", sites.board,
      // The model's face looks toward +Z; turn +Z onto the board's facing.
      armYaw({ dx: sites.board.fx, dz: sites.board.fz }), kioskBoxes, dressKiosk,
    ),
```

and `dispose` drops every one: `for (const box of kioskBoxes) dropBox(box);`.

In `client/src/app.ts`, `createSigns` reads the places once and draws the junction posts alone:

```ts
import { trailheadPlaces } from "./sim/trailhead.js";
import { signPosts } from "./sim/signs.js";
```

```ts
    const places = trailheadPlaces(graph, roadCenterX, seed);
```

```ts
      signPosts(graph, signSites(seed, graph.features, hikerFirst, search.body.pos)),
```

```ts
      { car: { site: places.car, trailhead: graph.trailhead }, board: places.board },
```

The imports of `CAR_MATERIAL`, `KIOSK_MATERIAL`, `kioskFacing`, `trailheadSite` and `allSignPosts` go. The doc comment on `createSigns` becomes `Junction posts, and the trailhead's car and board, from the same seed the sim used.`

- [ ] **Step 8: Run the tests**

Run: `npx vitest run --root client test/sim/trailhead.test.ts test/sim/signs.test.ts test/sim/signsSweep.test.ts test/sim/search.test.ts test/sim/searchSweep.test.ts test/sim/spawn.test.ts test/sim/containment.test.ts test/sim/hollowWalk.test.ts test/sim/forest.test.ts test/game/trailheadMeshes.test.ts test/game/signMeshes.test.ts`
Expected: PASS, except `groundGradient.test.ts`'s pin, which Step 9 moves. The console shows `[trailhead] board: far end 24.72 deg off the facing at most, 6.74-9.83 m from the player, bed 1.29 m, road 10.11 m, car 8.66 m, sides +n 63 -n 164`.

- [ ] **Step 9: The probe's record and the pass hash**

In `client/src/sim/forest.ts`, the two records added on 2026-09-28 become one:

```ts
  // Re-read 2026-09-28: the car stands at the pad and the board at the
  // trail's entrance. Measured for PROBE_SEED: the car (x=−285.73, z=0) in
  // [-9, 0]; the board's five boxes, from (x=−274.21, z=−5.05) to
  // (x=−274.92, z=−6.66), all in [-9, -1], which joins the window for them.
  // [-10, 0] holds nothing of pass 8 now and stays, so that no id moves for
  // its going.
  [-10, 0],
  [-9, 0],
  [-9, -1],
```

Run: `npx vitest run --root client test/sim/groundGradient.test.ts -t "pins passHash"`
Expected: FAIL at `expect(passHash()).toBe(178231578)`, with the received value in the message.

Write the received value as the literal, and add above it:

```ts
    // Re-baselined 2026-09-28 from 178231578: the notice board stands at the
    // trail's entrance as five boxes, and the post that stood there is
    // gone. SIGN_ROAD_U/Z and KIOSK_HALF_* leave pass 8's tunables, the
    // BOARD_* constants join them, and TRAIL_SIGNS leaves pass 9's
    // (registryDigest moves); in the probe, [-9, 0] loses the board's old
    // box and [-9, -1] holds its five in the post's place (probeDigest
    // moves). A peer with the board beside the pad collides differently.
```

Run it again. Expected: PASS.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

```bash
git add client/src/sim/trailhead.ts client/src/sim/passes/trailhead.ts client/src/sim/signs.ts \
  client/src/sim/passes/signs.ts client/src/sim/search.ts client/src/sim/world.ts client/src/sim/forest.ts \
  client/src/game/trailheadMeshes.ts client/src/app.ts \
  client/test/sim/trailhead.test.ts client/test/sim/signs.test.ts client/test/sim/search.test.ts \
  client/test/sim/searchSweep.test.ts client/test/sim/groundGradient.test.ts client/test/game/trailheadMeshes.test.ts
git commit
```

Message:

```
feat: stand the trailhead board at the trail's entrance, facing the player

## What

A post with one plank reading "Trail 14" stood at the trail's entrance,
and the notice board off to one side of the pad. The plank was an arrow,
and it pointed away from the trail. The post is gone, and the board stands
at the entrance in its place: 2.5 m past the pad's rim along the trail,
2.5 m off the bed, turned to face where a player arrives. A box cannot
turn, so the board's solid shape is five small boxes in a row along its
own line. Over the 227 sweep seeds the whole board is within 24.72 degrees
of the centre of the player's view and 6.74 to 9.83 m from them. The level
id moves.

## How

- `client/src/sim/trailhead.ts` — `boardSite`, the side that clears the
  road and the bed and is nearer the centre of the view; `boardBoxes`;
  `trailheadPlaces`, the car, the start and the board together. The
  road-frame props and the mirrored-site rule go.
- `client/src/sim/passes/trailhead.ts` — pass 8 emits the car's box and
  the board's five.
- `client/src/sim/signs.ts`, `client/src/sim/passes/signs.ts` — the post
  at the entrance goes; the junction posts are as they were.
- `client/src/sim/search.ts` — the poster's point from the board's place,
  facing and line: 0.36 m along it, 1.32 m up.
- `client/src/sim/world.ts`, `client/src/app.ts` — ask `trailheadPlaces`.
- `client/src/game/trailheadMeshes.ts` — the board placed at its facing,
  and its five boxes drawn until the model arrives.
- `client/src/sim/forest.ts` — the probe's record for the car and the
  board.
- `client/test/sim/trailhead.test.ts` — the board's place on hand-built
  graphs (each side, a tie, one side blocked, both blocked, the row) and
  over the 227 seeds.
- `client/test/sim/search.test.ts`, `client/test/sim/searchSweep.test.ts`,
  `client/test/sim/signs.test.ts`,
  `client/test/game/trailheadMeshes.test.ts` — the poster on the board,
  the junction posts alone, the five boxes drawn.
- `client/test/sim/groundGradient.test.ts` — the pass hash, re-pinned.
```

---

### Task 7: The board's face

**Files:**
- Create: `client/src/game/boardImages.ts`
- Create: `client/src/game/boardPaint.ts`
- Modify: `client/src/game/signMeshes.ts` (export `scrape`, `CARVED`, `CARVED_LIP`; remove `paintedMaterial`, `Painter`, `WOOD`, `PAINT`)
- Modify: `client/src/game/trailheadMeshes.ts`
- Modify: `client/src/game/posterPanel.ts` (remove `posterBoardLines`)
- Modify: `client/src/app.ts`
- Modify: `client/test/game/trailheadMeshes.test.ts`, `client/test/game/posterPanel.test.ts`
- Modify: `ARCHITECTURE.md`
- Create: `client/test/game/boardPaint.test.ts`

**Interfaces:**
- Consumes: `BOARD_TEXTURE`, `BOARD_FACE`, `SHEETS`, `TITLE`, `DISTANCE`, `boardText`, `BoardText`, `Sheet` (Task 3); `boardMap`, `BoardMap`, `MapInput` (Task 4); `sheetWear`, `SheetWear` (Task 5); `labelWear` from `game/labelWear.ts`; `Board` (Task 6); `POSTER_LAST_SEEN` from `game/posterPanel.ts`; `TRAIL_NAME`, `SUMMIT_LABEL` from `sim/signs.ts`.
- Produces:
  - from `game/boardImages.ts`: `BOARD_IMAGE_URLS: { paper: string | null; portrait: string | null }`
  - from `game/boardPaint.ts`:
    - `type BoardDrawing = { seed: number; text: BoardText; map: MapInput; urls: { paper: string | null; portrait: string | null } }`
    - `type BoardPainter = (scene: Scene, name: string, drawing: BoardDrawing) => Material`
    - `paintedBoard: BoardPainter`
    - `whenImagesArrive<T>(urls: { paper: string | null; portrait: string | null }, load: (url: string) => Promise<T | null>, gone: () => boolean, redraw: (images: { paper: T | null; portrait: T | null }) => void): Promise<void>`
    - `wrap`, `paperCrop`, `boardDrawingOf`, `type BoardSource`
  - from `game/trailheadMeshes.ts`: `TrailheadDeps.board: BoardDrawing` and `TrailheadDeps.paint?: BoardPainter` in place of `lines` and the old `paint`; `BOARD_FACE_LIFT = 0.001`; the plane is named `trailhead_board_face`.

- [ ] **Step 1: Write the failing tests**

In `client/test/game/trailheadMeshes.test.ts`:

The import drops `posterMaterial`, and adds

```ts
import type { BoardDrawing } from "../../src/game/boardPaint.js";
import { boardText } from "../../src/game/boardFace.js";
```

`LINES` goes; in its place

```ts
const DRAWING: BoardDrawing = {
  seed: 2032433950,
  text: boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274),
  map: { nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }], edges: [{ a: 0, b: 1, kind: "stem" }], road: [], features: [], places: [], summitName: "Summit" },
  urls: { paper: null, portrait: null },
};
```

In `setup`, the record of what was painted and the two deps become

```ts
  const painted: { name: string; drawing: BoardDrawing; material: Material }[] = [];
```

```ts
    board: DRAWING,
    // A NullEngine has no canvas to paint on; the painter is the one part
    // of this that needs a browser.
    paint: (s, name, drawing) => {
      const material = new PBRMaterial(name, s);
      painted.push({ name, drawing, material });
      return material;
    },
```

Delete the tests `"paints the poster on the kiosk's one untextured material, upright on the face toward the pad"` and `"finds the poster by its missing base colour texture, whose v the loader leaves top-down"`, and add in their place:

```ts
  it("draws the face on a plane of its own, a millimetre in front of the model's, upright and toward the player", async () => {
    const scene = freshScene();
    const { meshes, painted } = setup(scene, diskLoader(scene));
    await meshes.ready;
    expect(painted.map(({ name, drawing }) => ({ name, drawing }))).toEqual([{ name: "trailhead_board_face", drawing: DRAWING }]);
    const face = scene.getMeshByName("trailhead_board_face") as Mesh;
    expect(face.material).toBe(painted[0]!.material);
    const verts = worldVertices(face);
    expect(verts).toHaveLength(4);
    // The board is at (6, 39) and its face looks toward -z: the plane stands
    // 0.159 m and a millimetre in front of the board's centre plane.
    for (const { p } of verts) expect(p.z).toBeCloseTo(38.84, 6);
    const top = Math.max(...verts.map(({ p }) => p.y));
    const bottom = Math.min(...verts.map(({ p }) => p.y));
    const left = Math.min(...verts.map(({ p }) => p.x));
    const right = Math.max(...verts.map(({ p }) => p.x));
    // 2 m by 1 m, its centre 1.37 m above the board's foot, which is on the ground at 2.28.
    expect(right - left).toBeCloseTo(2, 6);
    expect(top - bottom).toBeCloseTo(1, 6);
    expect((top + bottom) / 2).toBeCloseTo(3.65, 6);
    expect((left + right) / 2).toBeCloseTo(6, 6);
    // Seen from in front (looking +z, so +x is to the right), the texture's
    // top-left corner is the plane's: u = 0 and v = 1, where a painted
    // canvas's top row is uploaded.
    const at = (x: number, y: number) => verts.find(({ p }) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.y - y) < 1e-4)!;
    expect([at(left, top).u, at(left, top).v]).toEqual([0, 1]);
    expect([at(right, top).u, at(right, top).v]).toEqual([1, 1]);
    expect([at(left, bottom).u, at(left, bottom).v]).toEqual([0, 0]);
    expect(face.isPickable).toBe(false);
    meshes.dispose();
    expect(scene.getMeshByName("trailhead_board_face")).toBeNull();
  });

  it("leaves the model's own materials as they are", async () => {
    const scene = freshScene();
    const { meshes, painted } = setup(scene, diskLoader(scene));
    await meshes.ready;
    const kiosk = scene.getTransformNodeByName("trailhead_kiosk")!;
    for (const m of kiosk.getChildMeshes(false)) {
      if (m.name === "trailhead_board_face") continue;
      expect(m.material).not.toBe(painted[0]!.material);
      expect(m.material).not.toBeNull();
    }
    meshes.dispose();
  });
```

In `"keeps the boxes, and paints nothing, when the models never load"` and `"drops the models if disposed while they load"`, `expect(painted).toHaveLength(0);` stands, and the first gains `expect(scene.getMeshByName("trailhead_board_face")).toBeNull();`.

In `client/test/game/posterPanel.test.ts`, delete `describe("the poster painted on the board", …)`'s use of `posterBoardLines`, leaving

```ts
describe("the poster's line", () => {
  it("names the trail", () => {
    expect(POSTER_LAST_SEEN).toBe("Last seen at Trail 14.");
  });
});
```

and take `posterBoardLines` out of the import.

Create `client/test/game/boardPaint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boardText } from "../../src/game/boardFace.js";
import { boardDrawingOf, paperCrop, whenImagesArrive, wrap } from "../../src/game/boardPaint.js";

describe("wrap", () => {
  const width = (s: string): number => s.length * 10;

  it("breaks a line at its spaces to fit a width", () => {
    expect(wrap("BE OFF THE MOUNTAIN BY DARK", 150, width)).toEqual(["BE OFF THE", "MOUNTAIN BY", "DARK"]);
    expect(wrap("STAY ON THE TRAIL", 400, width)).toEqual(["STAY ON THE TRAIL"]);
  });

  it("leaves a word longer than the width on a line of its own", () => {
    expect(wrap("A Featherstonehaugh-Cholmondeley B", 100, width)).toEqual(["A", "Featherstonehaugh-Cholmondeley", "B"]);
  });

  it("gives no lines for no words", () => {
    expect(wrap("", 100, width)).toEqual([]);
    expect(wrap("   ", 100, width)).toEqual([]);
  });
});

describe("paperCrop", () => {
  it("cuts each sheet from its own part of the paper, in the sheet's proportions, inside the image", () => {
    const map = paperCrop("map", { width: 1024, height: 748 }, 512);
    expect(map.width / map.height).toBeCloseTo(1024 / 748, 9);
    const poster = paperCrop("poster", { width: 451, height: 635 }, 512);
    expect(poster.width / poster.height).toBeCloseTo(451 / 635, 9);
    for (const c of [map, poster, paperCrop("rules", { width: 338, height: 532 }, 512), paperCrop("torn", { width: 123, height: 72 }, 512)]) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(512);
      expect(c.y + c.height).toBeLessThanOrEqual(512);
    }
    expect(paperCrop("map", { width: 1024, height: 748 }, 512)).toEqual(map);
    expect([poster.x, poster.y]).not.toEqual([map.x, map.y]);
  });
});

describe("whenImagesArrive", () => {
  const both = { paper: "paper.webp", portrait: "portrait.webp" };

  it("draws once more when an image arrives", async () => {
    const drawn: unknown[] = [];
    await whenImagesArrive(both, async (url) => (url === "paper.webp" ? "PAPER" : null), () => false, (images) => drawn.push(images));
    expect(drawn).toEqual([{ paper: "PAPER", portrait: null }]);
  });

  it("draws nothing more when there are no images or none arrives", async () => {
    const drawn: unknown[] = [];
    const asked: string[] = [];
    await whenImagesArrive({ paper: null, portrait: null }, async (url) => { asked.push(url); return "X"; }, () => false, (images) => drawn.push(images));
    expect(asked).toEqual([]);
    await whenImagesArrive(both, async () => null, () => false, (images) => drawn.push(images));
    expect(drawn).toEqual([]);
  });

  it("drops an image that arrives after disposal", async () => {
    const drawn: unknown[] = [];
    let gone = false;
    const waiting = whenImagesArrive(both, async () => "X", () => gone, (images) => drawn.push(images));
    gone = true;
    await waiting;
    expect(drawn).toEqual([]);
  });
});

describe("boardDrawingOf", () => {
  it("gathers what the painter draws from the world's own graph, names and seed", () => {
    const d = boardDrawingOf({
      seed: 7,
      trailName: "Trail 14",
      hikerName: "Hugh Kowalski",
      lastSeen: "Last seen at Trail 14.",
      graph: {
        nodes: [{ x: 0, z: 0 }, { x: 100, z: 0 }],
        edges: [{ a: 0, b: 1, kind: "stem" }],
        features: [{ kind: "peak", x: 100, z: 0, radius: 50 }],
        shortestHome: 1274,
      },
      places: [{ name: "Summit", x: 100, z: 0 }],
      summitName: "Summit",
      roadCenterX: () => -9,
      urls: { paper: null, portrait: null },
    });
    expect(d.seed).toBe(7);
    expect(d.text).toEqual(boardText("Trail 14", "Hugh Kowalski", "Last seen at Trail 14.", 1274));
    expect(d.map.nodes).toEqual([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
    expect(d.map.edges).toEqual([{ a: 0, b: 1, kind: "stem" }]);
    // The road sampled every 25 m from 60 m before the trails' least z to 60 m past their most.
    expect(d.map.road.map((r) => r.z)).toEqual([-60, -35, -10, 15, 40]);
    expect(d.map.road.every((r) => r.x === -9)).toBe(true);
    expect(d.map.places).toEqual([{ name: "Summit", x: 100, z: 0 }]);
    expect(d.urls).toEqual({ paper: null, portrait: null });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --root client test/game/boardPaint.test.ts test/game/trailheadMeshes.test.ts`
Expected: FAIL. The module `../../src/game/boardPaint.js` cannot be found.

- [ ] **Step 3: Say where the images are**

`client/src/game/boardImages.ts`:

```ts
/**
 * The paper's and the photograph's addresses, where the files exist. A glob
 * and not an import by name, so a checkout without one of the files still
 * builds: the board then draws a stand-in for it (`boardPaint.ts`).
 */
const found = import.meta.glob("../../assets/textures/board.*.webp", { query: "?url", import: "default", eager: true }) as Record<string, string>;

function urlOf(file: string): string | null {
  for (const [path, url] of Object.entries(found)) if (path.endsWith(`/${file}`)) return url;
  return null;
}

export const BOARD_IMAGE_URLS: { paper: string | null; portrait: string | null } = {
  paper: urlOf("board.paper.webp"),
  portrait: urlOf("board.portrait.webp"),
};
```

- [ ] **Step 4: Open the fork signs' lettering to the board**

In `client/src/game/signMeshes.ts`: `CARVED`, `CARVED_LIP` and `scrape` gain `export`. `paintedMaterial`, the `Painter` type, `WOOD` and `PAINT` are deleted with their comments; nothing reads them after this task.

- [ ] **Step 5: Write the painter**

`client/src/game/boardPaint.ts`:

```ts
/**
 * Paints the trailhead board's face: the trail's name and the distance
 * routed into the wood, three sheets of aged paper with their staples, the
 * map, the missing hiker's poster, the rules, and the wear on all of it.
 * The texture is clear wherever the board's own planks show.
 *
 * What is drawn, and where, is decided by pure modules (`boardFace.ts`,
 * `boardMap.ts`, `boardWear.ts`); this is the one module that touches a
 * canvas, and only `wrap`, `paperCrop`, `boardDrawingOf` and
 * `whenImagesArrive` of it run without one.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { BOARD_TEXTURE, DISTANCE, SHEETS, TITLE, boardText, type BoardText, type Sheet, type SheetName } from "./boardFace.js";
import { boardMap, type BoardMap, type MapInput } from "./boardMap.js";
import { sheetWear, type SheetWear } from "./boardWear.js";
import { labelWear, nameHash } from "./labelWear.js";
import { CARVED, CARVED_LIP, scrape } from "./signMeshes.js";

export type BoardDrawing = {
  seed: number;
  text: BoardText;
  map: MapInput;
  urls: { paper: string | null; portrait: string | null };
};
export type BoardPainter = (scene: Scene, name: string, drawing: BoardDrawing) => Material;

/** The paper where there is no image of it. */
const PAPER = "#E8E2D2";
const INK = "#2a2219";
const RED = "#6d1f17";
const SANS = `"Trebuchet MS", "Helvetica Neue", Arial, sans-serif`;
const SERIF = `Georgia, "Times New Roman", serif`;
/** Metres between the road's samples on the map. */
const ROAD_STEP = 25;
const MAP_MARGIN_M = 60;

/** Breaks a line at its spaces so that each part fits `width`; a word wider than that gets a line of its own. */
export function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(next) > width) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") out.push(line);
  return out;
}

/**
 * The part of the square paper image a sheet is cut from: the largest
 * rectangle of the sheet's proportions that fits in three-fifths of the
 * image, at a place the sheet's name decides, so no two sheets show the
 * same fibres.
 */
export function paperCrop(name: string, rect: { width: number; height: number }, size: number): { x: number; y: number; width: number; height: number } {
  const room = size * 0.6;
  const scale = Math.min(room / rect.width, room / rect.height);
  const width = rect.width * scale, height = rect.height * scale;
  const h = nameHash(name);
  const fx = (h & 0xffff) / 0xffff, fy = ((h >>> 16) & 0xffff) / 0xffff;
  return { x: fx * (size - width), y: fy * (size - height), width, height };
}

export type BoardSource = {
  seed: number;
  trailName: string;
  hikerName: string;
  lastSeen: string;
  graph: {
    nodes: readonly { x: number; z: number }[];
    edges: readonly { a: number; b: number; kind: string }[];
    features: readonly { kind: string; x: number; z: number; radius: number }[];
    shortestHome: number;
  };
  places: readonly { name: string; x: number; z: number }[];
  summitName: string;
  roadCenterX(seed: number, z: number): number;
  urls: { paper: string | null; portrait: string | null };
};

/** What the painter draws, gathered from a world's graph, names and seed. */
export function boardDrawingOf(source: BoardSource): BoardDrawing {
  let z0 = Infinity, z1 = -Infinity;
  for (const n of source.graph.nodes) {
    if (n.z < z0) z0 = n.z;
    if (n.z > z1) z1 = n.z;
  }
  const road: { x: number; z: number }[] = [];
  if (z0 <= z1) {
    for (let z = z0 - MAP_MARGIN_M; z <= z1 + MAP_MARGIN_M; z += ROAD_STEP) road.push({ x: source.roadCenterX(source.seed, z), z });
  }
  return {
    seed: source.seed,
    text: boardText(source.trailName, source.hikerName, source.lastSeen, source.graph.shortestHome),
    map: {
      nodes: source.graph.nodes.map((n) => ({ x: n.x, z: n.z })),
      edges: source.graph.edges.map((e) => ({ a: e.a, b: e.b, kind: e.kind })),
      road,
      features: source.graph.features.map((f) => ({ kind: f.kind, x: f.x, z: f.z, radius: f.radius })),
      places: source.places.map((p) => ({ name: p.name, x: p.x, z: p.z })),
      summitName: source.summitName,
    },
    urls: source.urls,
  };
}

type Ctx = CanvasRenderingContext2D;
type Images = { paper: CanvasImageSource | null; portrait: CanvasImageSource | null };

/** One routed line, centred, its capitals `height` tall, worn as a fork sign's name is. */
function routed(ctx: Ctx, text: string, at: { centreX: number; centreY: number; height: number }): void {
  const size = Math.round(at.height / 0.72);
  ctx.font = `bold ${size}px ${SANS}`;
  const spaced = Array.from(text).join("  ");
  const metrics = ctx.measureText(spaced);
  const x = at.centreX - metrics.width / 2;
  const baseline = at.centreY + at.height / 2;
  const lip = Math.max(1, Math.round(size * 0.05));
  const ink = { x, y: baseline - at.height, width: metrics.width, height: at.height + lip };
  const wear = labelWear(text, ink);
  const chars = Array.from(spaced);
  let letter = 0;
  for (const [i, char] of chars.entries()) {
    const left = x + ctx.measureText(chars.slice(0, i).join("")).width;
    const faded = char === " " ? 1 : (wear.letters[letter++] ?? 1);
    ctx.globalAlpha = wear.alpha * faded;
    ctx.fillStyle = CARVED_LIP;
    ctx.fillText(char, left, baseline + lip);
    ctx.fillStyle = CARVED;
    ctx.fillText(char, left, baseline);
  }
  ctx.globalAlpha = 1;
  scrape(ctx, wear);
}

function centred(ctx: Ctx, lines: readonly string[], centreX: number, top: number, leading: number): number {
  let y = top;
  for (const line of lines) {
    ctx.fillText(line, centreX - ctx.measureText(line).width / 2, y);
    y += leading;
  }
  return y;
}

function drawMap(ctx: Ctx, heading: string, map: BoardMap, w: number): void {
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.round(w * 0.022)}px ${SANS}`;
  ctx.fillText(Array.from(heading).join(" "), w * 0.03, w * 0.045);
  ctx.strokeStyle = "rgba(122, 106, 79, 0.5)";
  ctx.lineWidth = 1;
  for (const r of map.rings) {
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(111, 135, 144, 0.55)";
  for (const p of map.ponds) {
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.rx, p.ry * 0.8, 0, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#4a4136";
  ctx.lineWidth = 7;
  ctx.beginPath();
  for (const [i, p] of map.road.entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#5a4a36";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 7]);
  for (const l of map.side) {
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "#3b2f22";
  ctx.lineWidth = 4.5;
  for (const l of map.stem) {
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
  }
  ctx.fillStyle = "#3b2f22";
  if (map.summit !== null) {
    ctx.beginPath();
    ctx.moveTo(map.summit.x - 12, map.summit.y + 9);
    ctx.lineTo(map.summit.x, map.summit.y - 14);
    ctx.lineTo(map.summit.x + 12, map.summit.y + 9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = `italic ${Math.round(w * 0.024)}px ${SERIF}`;
  for (const l of map.labels) ctx.fillText(l.text, l.x + 18, l.y + 8);
  ctx.fillStyle = "#8a2f23";
  ctx.beginPath();
  ctx.arc(map.here.x, map.here.y, 9, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = `bold ${Math.round(w * 0.019)}px ${SANS}`;
  const here = "YOU ARE HERE";
  ctx.fillText(here, map.here.x - 18 - ctx.measureText(here).width, map.here.y - 16);
}

function drawPoster(ctx: Ctx, text: BoardText["poster"], portrait: CanvasImageSource | null, w: number, h: number): void {
  ctx.fillStyle = RED;
  ctx.font = `900 ${Math.round(w * 0.15)}px ${SERIF}`;
  const title = Array.from(text.title).join(" ");
  ctx.fillText(title, (w - ctx.measureText(title).width) / 2, h * 0.13);
  const pw = w * 0.5, ph = pw * 1.25, px = (w - pw) / 2, py = h * 0.17;
  if (portrait !== null) {
    ctx.save();
    ctx.globalAlpha *= 0.78;
    ctx.drawImage(portrait, px, py, pw, ph);
    ctx.restore();
    // Bleached: a pale wash over the print, as the sun leaves one.
    ctx.fillStyle = "rgba(232, 226, 210, 0.34)";
    ctx.fillRect(px, py, pw, ph);
  } else {
    const grey = ctx.createLinearGradient(px, py, px + pw, py + ph);
    grey.addColorStop(0, "#9b917c");
    grey.addColorStop(1, "#6f6655");
    ctx.fillStyle = grey;
    ctx.fillRect(px, py, pw, ph);
  }
  ctx.fillStyle = INK;
  let size = Math.round(w * 0.095);
  ctx.font = `bold ${size}px ${SERIF}`;
  const room = w * 0.9;
  if (ctx.measureText(text.name).width > room) {
    size = Math.max(14, Math.floor((size * room) / ctx.measureText(text.name).width));
    ctx.font = `bold ${size}px ${SERIF}`;
  }
  let y = py + ph + h * 0.075;
  ctx.fillText(text.name, (w - ctx.measureText(text.name).width) / 2, y);
  ctx.font = `${Math.round(w * 0.056)}px ${SERIF}`;
  y += h * 0.055;
  for (const line of text.lines) {
    y = centred(ctx, wrap(line, room, (s) => ctx.measureText(s).width), w / 2, y, h * 0.045) + h * 0.012;
  }
}

function drawRules(ctx: Ctx, text: BoardText["rules"], w: number, h: number): void {
  ctx.fillStyle = INK;
  ctx.font = `800 ${Math.round(w * 0.09)}px ${SANS}`;
  const heading = Array.from(text.heading).join(" ");
  ctx.fillText(heading, (w - ctx.measureText(heading).width) / 2, h * 0.1);
  ctx.fillRect(w * 0.08, h * 0.125, w * 0.84, Math.max(2, h * 0.004));
  ctx.font = `bold ${Math.round(w * 0.08)}px ${SANS}`;
  let y = h * 0.21;
  for (const line of text.lines) {
    y = centred(ctx, wrap(line, w * 0.86, (s) => ctx.measureText(s).width), w / 2, y, h * 0.062) + h * 0.03;
  }
  ctx.globalAlpha *= 0.8;
  ctx.font = `${Math.round(w * 0.058)}px ${SERIF}`;
  for (const line of text.small) {
    y = centred(ctx, wrap(line, w * 0.86, (s) => ctx.measureText(s).width), w / 2, y, h * 0.05);
  }
}

/** A sheet's print, worn: drawn apart, its fades rubbed out of it, then laid on the paper. */
function printed(sheet: Sheet, wear: SheetWear, draw: (ctx: Ctx, w: number, h: number) => void): HTMLCanvasElement {
  const { width: w, height: h } = sheet.rect;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.globalAlpha = wear.ink;
  draw(ctx, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  for (const f of wear.fades) {
    const fade = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    fade.addColorStop(0, `rgba(0, 0, 0, ${f.strength})`);
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(f.x - f.r, f.y - f.r, 2 * f.r, 2 * f.r);
  }
  return canvas;
}

function drawSheet(ctx: Ctx, sheet: Sheet, wear: SheetWear, images: Images, print: HTMLCanvasElement | null): void {
  const { x, y, width: w, height: h, turn } = sheet.rect;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(turn);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.beginPath();
  if (sheet.staples) {
    ctx.rect(0, 0, w, h);
  } else {
    // A corner left when the rest of a notice was torn away.
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h * 0.55);
    ctx.lineTo(w * 0.62, h);
    ctx.lineTo(w * 0.38, h * 0.62);
    ctx.lineTo(0, h * 0.84);
    ctx.closePath();
  }
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  if (images.paper !== null) {
    const size = (images.paper as { width?: number }).width ?? 512;
    const c = paperCrop(sheet.name, sheet.rect, size);
    ctx.drawImage(images.paper, c.x, c.y, c.width, c.height, 0, 0, w, h);
  }
  const corner = [[0, 0], [w, 0], [w, h], [0, h]][wear.bleach.corner] as [number, number];
  const bleach = ctx.createRadialGradient(corner[0], corner[1], 0, corner[0], corner[1], wear.bleach.r);
  bleach.addColorStop(0, `rgba(255, 252, 240, ${wear.bleach.strength})`);
  bleach.addColorStop(1, "rgba(255, 252, 240, 0)");
  ctx.fillStyle = bleach;
  ctx.fillRect(0, 0, w, h);
  const stain = ctx.createRadialGradient(wear.stain.x, wear.stain.y, wear.stain.r * 0.2, wear.stain.x, wear.stain.y, wear.stain.r);
  stain.addColorStop(0, `rgba(120, 84, 40, ${wear.stain.strength * 0.6})`);
  stain.addColorStop(0.85, `rgba(120, 84, 40, ${wear.stain.strength})`);
  stain.addColorStop(1, "rgba(120, 84, 40, 0)");
  ctx.fillStyle = stain;
  ctx.fillRect(0, 0, w, h);
  if (print !== null) ctx.drawImage(print, 0, 0);
  if (sheet.staples) {
    const inset = Math.min(w, h) * 0.045;
    const at: [number, number][] = [[inset, inset], [w - inset, inset], [w - inset, h - inset], [inset, h - inset]];
    for (const [k, [sx, sy]] of at.entries()) {
      const r = wear.rust[k] as { strength: number; run: number };
      const run = ctx.createLinearGradient(0, sy, 0, sy + r.run);
      run.addColorStop(0, `rgba(122, 58, 24, ${r.strength})`);
      run.addColorStop(1, "rgba(122, 58, 24, 0)");
      ctx.fillStyle = run;
      ctx.fillRect(sx - 14, sy, 28, r.run);
      const steel = ctx.createLinearGradient(0, sy - 3, 0, sy + 3);
      steel.addColorStop(0, "#9a958c");
      steel.addColorStop(1, "#5b564e");
      ctx.fillStyle = steel;
      ctx.fillRect(sx - 14, sy - 3, 28, 6);
    }
  }
  ctx.restore();
}

function draw(ctx: Ctx, drawing: BoardDrawing, images: Images): void {
  ctx.clearRect(0, 0, BOARD_TEXTURE.width, BOARD_TEXTURE.height);
  routed(ctx, drawing.text.title, TITLE);
  routed(ctx, drawing.text.distance, DISTANCE);
  for (const sheet of SHEETS) {
    const wear = sheetWear(drawing.seed, sheet.name, sheet.rect);
    const { width: w, height: h } = sheet.rect;
    const prints: Record<SheetName, ((c: Ctx) => void) | null> = {
      torn: null,
      map: (c) => drawMap(c, drawing.text.mapHeading, boardMap(drawing.map, { x: w * 0.03, y: w * 0.07, width: w * 0.94, height: h - w * 0.1 }), w),
      poster: (c) => drawPoster(c, drawing.text.poster, images.portrait, w, h),
      rules: (c) => drawRules(c, drawing.text.rules, w, h),
    };
    const print = prints[sheet.name];
    drawSheet(ctx, sheet, wear, images, print === null ? null : printed(sheet, wear, (c) => print(c)));
  }
}

/**
 * Waits for the images that have an address and asks for the face to be
 * drawn once more with whichever arrived. Nothing is asked for where there
 * is no address, and nothing is drawn where none arrived or the texture has
 * gone in the meantime.
 */
export async function whenImagesArrive<T>(
  urls: { paper: string | null; portrait: string | null },
  load: (url: string) => Promise<T | null>,
  gone: () => boolean,
  redraw: (images: { paper: T | null; portrait: T | null }) => void,
): Promise<void> {
  if (urls.paper === null && urls.portrait === null) return;
  const [paper, portrait] = await Promise.all([
    urls.paper === null ? null : load(urls.paper),
    urls.portrait === null ? null : load(urls.portrait),
  ]);
  if (gone() || (paper === null && portrait === null)) return;
  redraw({ paper, portrait });
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // A missing image costs the look, never the board: the stand-in stays.
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * The face's material: drawn at once with stand-ins for the paper and the
 * photograph, and drawn again with the images when they arrive. An image
 * that arrives after the texture is disposed is dropped.
 */
export const paintedBoard: BoardPainter = (scene, name, drawing) => {
  // Mipmapped: the board is read from a few metres, where a 2048-wide
  // texture on a 2 m plane is heavily minified and would shimmer without.
  const texture = new DynamicTexture(name, { width: BOARD_TEXTURE.width, height: BOARD_TEXTURE.height }, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as unknown as Ctx;
  draw(ctx, drawing, { paper: null, portrait: null });
  texture.update(true);
  let disposed = false;
  texture.onDisposeObservable.add(() => {
    disposed = true;
  });
  void whenImagesArrive(drawing.urls, loadImage, () => disposed, (images) => {
    draw(ctx, drawing, images);
    texture.update(true);
  });
  const material = new PBRMaterial(`${name}_mat`, scene);
  material.albedoTexture = texture;
  material.useAlphaFromAlbedoTexture = true;
  material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  // The clear ground must stay clear: no reflection or highlight kept where
  // the alpha is zero, which would lay a sheen over the planks.
  material.useRadianceOverAlpha = false;
  material.useSpecularOverAlpha = false;
  material.backFaceCulling = true;
  // A millimetre off the face is plenty up close; the bias keeps it on top at range.
  material.zOffset = -1;
  material.metallic = 0;
  material.roughness = 0.92;
  return material;
};
```

- [ ] **Step 6: Draw the face on the board**

In `client/src/game/trailheadMeshes.ts`:

The imports lose `PBRMaterial`, `VertexBuffer`, `AbstractMesh`, `paintedMaterial` and `Painter`, and gain

```ts
import { BOARD_FACE } from "./boardFace.js";
import { paintedBoard, type BoardDrawing, type BoardPainter } from "./boardPaint.js";
```

`POSTER_TEXTURE`, `posterMaterial` and `flipPosterV` are deleted with their comments. In their place:

```ts
/** How far in front of the model's own face the painted plane stands. */
export const BOARD_FACE_LIFT = 0.001;
```

`TrailheadDeps`:

```ts
export type TrailheadDeps = {
  /** The box material by prop name — `terrainMaterialFor`, as the prop boxes use. */
  materialFor(name: string): Material;
  /** What the board's face carries. */
  board: BoardDrawing;
  paint?: BoardPainter;
  shadows?: PropShadows;
  loader?: ModelLoader;
};
```

Inside `createTrailheadMeshes`, `const paint = deps.paint ?? paintedBoard;`, and `dressKiosk` gives way to a step taken after the board is placed. `place` takes `after?: (model: PlacedModel) => void` in place of `dress`, called once the model stands:

```ts
    let model: PlacedModel;
    try {
      model = placeStaticModel(container, name, site.x, groundH(site.x, site.z), site.z, yaw);
    } catch {
      container.dispose();
      return;
    }
    for (const m of model.meshes) deps.shadows?.add(m);
    placed.push(model);
    for (const box of boxes) dropBox(box);
    after?.(model);
```

```ts
  let face: Mesh | null = null;
  /**
   * The face's own plane: 2 m by 1 m, a millimetre in front of the model's
   * planks, in the board's own space so it turns with the board. A plane
   * looks toward -Z as it is made; half a turn points it out of the face,
   * and leaves the texture's left at the player's left.
   */
  function faceOn(model: PlacedModel): void {
    const material = paint(scene, "trailhead_board_face", deps.board);
    painted.push(material);
    const plane = MeshBuilder.CreatePlane("trailhead_board_face", { width: BOARD_FACE.width, height: BOARD_FACE.height }, scene);
    plane.parent = model.node;
    plane.position.set(0, BOARD_FACE.centreY, BOARD_FACE.front + BOARD_FACE_LIFT);
    plane.rotation.y = Math.PI;
    plane.material = material;
    plane.isPickable = false;
    // It takes the shadows the board does, but casts none of its own.
    plane.receiveShadows = true;
    face = plane;
  }
```

The board's call passes `faceOn` as `after`. `dispose` disposes the plane before the models: `face?.dispose(); face = null;`.

The module's doc comment on `createTrailheadMeshes` becomes:

```ts
/**
 * The trailhead's two models, placed once from the seed's places: the
 * ranger's SUV on the shoulder and the roofed board at the trail's
 * entrance, turned to face where a player arrives. Each stands on the
 * boxes the sim collides with and, until its model arrives (or for good, if
 * it never does), those boxes are drawn instead, exactly as the prop boxes
 * elsewhere are — so the trailhead never holds an invisible wall. The
 * board's face is a plane of the game's own, painted when the match starts
 * (`boardPaint.ts`) and placed by the face's size and place, which are the
 * model's to keep.
 */
```

- [ ] **Step 7: Give the board what it carries**

In `client/src/game/posterPanel.ts`, delete `posterBoardLines` and its comment.

In `client/src/app.ts`:

```ts
import { BOARD_IMAGE_URLS } from "./game/boardImages.js";
import { boardDrawingOf } from "./game/boardPaint.js";
import { POSTER_LAST_SEEN, createPosterPanel, posterModel } from "./game/posterPanel.js";
import { SUMMIT_LABEL, TRAIL_NAME, signPosts } from "./sim/signs.js";
```

and in `createSigns`, the names are read once and serve the posts and the board:

```ts
    const sites = signSites(seed, graph.features, hikerFirst, search.body.pos);
```

```ts
      signPosts(graph, sites),
```

```ts
      {
        materialFor: (name) => terrainMaterialFor(r.scene, name),
        board: boardDrawingOf({
          seed,
          trailName: TRAIL_NAME,
          hikerName: search.hiker.name,
          lastSeen: POSTER_LAST_SEEN,
          graph,
          places: sites,
          summitName: SUMMIT_LABEL,
          roadCenterX,
          urls: BOARD_IMAGE_URLS,
        }),
        shadows: r.shadows,
      },
```

- [ ] **Step 8: Say so in the documents**

In `ARCHITECTURE.md`:

- in "Model conventions", the sentence `the kiosk's poster its one material with no base colour texture` becomes `the board's face 2 m by 1 m toward +Z, its centre 1.37 m above the board's foot and 0.159 m in front of its centre plane, which is where the game stands its own painted plane`;
- in the paragraph that lists what is derived from the seed, `the poster's face on the trailhead kiosk, the kiosk, the car at the pad` becomes `the car at the pad, the trailhead board at the trail's entrance, turned to face where a player arrives, with the poster on its face`, and `and the post at the trail's entrance that names it Trail 14 (\`client/src/sim/signs.ts\`)` becomes `(\`client/src/sim/signs.ts\`)`; the places' module is named `client/src/sim/trailhead.ts`.

In `README.md`, the premise's first line stands. Nothing else in it names the sign.

Run: `grep -rn -i "kiosk's poster\|post at the trail's entrance\|posterBoardLines\|paintedMaterial\|posterMaterial" client/src client/test ARCHITECTURE.md README.md`
Expected: no output.

- [ ] **Step 9: Run the tests, typecheck, lint**

Run: `npx vitest run --root client test/game/boardPaint.test.ts test/game/trailheadMeshes.test.ts test/game/posterPanel.test.ts test/game/signMeshes.test.ts test/game/boardFace.test.ts test/game/boardMap.test.ts test/game/boardWear.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all clean. The build proves `import.meta.glob` finds no file and still builds.

- [ ] **Step 10: Commit**

```bash
git add client/src/game/boardImages.ts client/src/game/boardPaint.ts client/src/game/signMeshes.ts \
  client/src/game/trailheadMeshes.ts client/src/game/posterPanel.ts client/src/app.ts \
  client/test/game/boardPaint.test.ts client/test/game/trailheadMeshes.test.ts client/test/game/posterPanel.test.ts \
  ARCHITECTURE.md
git commit
```

Message:

```
feat: paint the trailhead board's face

## What

The trailhead board's face was a flat brown panel with three lines of text
in its corner. It carries the trail's name and the distance to the summit,
routed into the wood and worn as the fork signs' lettering is, and three
sheets of aged paper with their staples: a map of this world's own trails,
the missing hiker's poster with a photograph, and a sheet of rules. It is
painted onto a plane of the game's own, a millimetre in front of the
model's planks, clear wherever the planks show. Until the paper's and the
photograph's images are there, flat paper and a grey print stand in.

## How

- `client/src/game/boardPaint.ts` — the painter, the one module that
  touches a canvas; `boardDrawingOf` gathers what it draws; `wrap` and
  `paperCrop` are its two pure helpers.
- `client/src/game/boardImages.ts` — the two images' addresses, by a glob,
  so a checkout without them builds.
- `client/src/game/trailheadMeshes.ts` — the face's plane, 2 m by 1 m, in
  the board's own space; the model's materials are left as they are.
- `client/src/game/signMeshes.ts` — the routed lettering's colours and its
  scrape are exported; the old painted poster goes.
- `client/src/game/posterPanel.ts`, `client/src/app.ts` — the board is
  given the graph, the names and the seed.
- `client/test/game/boardPaint.test.ts` — wrapping, the paper's crops,
  what the painter is given, and the images arriving, not arriving, and
  arriving after disposal.
- `client/test/game/trailheadMeshes.test.ts` — the plane's place, size and
  the way its texture reads; the model's materials untouched; nothing
  painted when the model never loads or arrives after disposal.
- `ARCHITECTURE.md` — the board's face as a model convention.
```

---

### Task 8: The watcher's sweep, and the whole suite

**Files:**
- Modify: `client/test/sim/watcherSweep.test.ts` (its floors and its doc comment, if they move)

**Interfaces:**
- Consumes: the sweep's printed summary (it prints on every run).
- Produces: the sweep's floors as measured with the board at the entrance.

- [ ] **Step 1: Measure before and after**

The sweep's readings before this work are the ones its test pins: 875 of 936 stands shown, 78 955 of 187 200 tries admitted, the sightline refusing 59 815, the pad 151 of 200.

Run: `npx vitest run --root client test/sim/watcherSweep.test.ts 2>&1 | tee watcher-after.txt`

Read the `[watcher sweep]` block against those, and the `never shown:` list against the one in the test's last run on `main`. Move `watcher-after.txt` out of the repository afterwards; it is a working file.

- [ ] **Step 2: Decide by what moved**

- **Nothing moved:** the floors stand; go to Step 4 with no change to this file.
- **The counts rose or stayed, and the test passes:** raise the two floors to the measured counts, and change the test's name and doc comment to the measured numbers.
- **A count fell:** the test fails. List every stand that is in one `never shown:` list and not the other, and for each say which of the board's boxes stands on its sightline, or which sightline the old board's going has opened. The board stands about 10 m from the pad's centre along the trail, so stands at the pad and at the first stem nodes may change; a stand higher than climb 0.25 that changes is a defect to find, not a floor to lower.

- [ ] **Step 3: Re-pin, with the reason**

Write the measured counts as literals, and add to the end of the test's doc comment a paragraph in the form its last one takes, with the measured numbers and stands in it:

```
 * Re-pinned 2026-09-28 from 875 shown and 78 955 admitted: the notice
 * board left the pad's side for the trail's entrance, where it stands as
 * five boxes 2.5 m off the bed.
```

followed by which stands no longer show or show now, which box is on each one's sightline, and the four counts as measured. A comment that does not name the stands is not finished.

Run: `npx vitest run --root client test/sim/watcherSweep.test.ts`
Expected: PASS.

- [ ] **Step 4: The whole suite**

Run once, when no other test run and no frame-time measurement is using the machine:

```bash
npm run typecheck && npm run lint && npm test
```

Expected: typecheck and lint clean; the client, server and tools suites all pass. Run `npm test` on its own and read its summary line: never pipe it into a filter inside a chain. A test that times out in a file this work did not touch is re-run alone (`npx vitest run --root client <file>`) and both results are recorded; a time limit is never edited to make one pass.

- [ ] **Step 5: Commit**

Only if `client/test/sim/watcherSweep.test.ts` changed:

```bash
git add client/test/sim/watcherSweep.test.ts
git commit
```

Message, with the measured numbers in place of the letters:

```
test: re-pin the watcher sweep for the board at the entrance

## What

The trailhead board's boxes stand beside the trail now, so the watcher's
sweep was measured again. It shows on N of 936 stands within 120 ticks,
where it showed on 875; every stand that changed is at the pad or the
first stretch of the stem.

## How

- `client/test/sim/watcherSweep.test.ts` — the floors as measured, and
  which stands moved and which box stands on each one's sightline.
```

---

### Task 9: Look at it in the game

The tests prove the geometry and what the painter is given. They cannot prove the picture (spec §9.2). This needs a browser on this machine: ask before starting, and run nothing else meanwhile.

**Files:**
- Create: `docs/trail/<the date this note is written>-trailhead-board-verification.md` (text only: every file under `docs/` is a dated `.md`, so the stills are kept outside the repository)

**Interfaces:**
- Consumes: the built game on this branch.
- Produces: the verification note.

- [ ] **Step 1: Start the game**

Find two free ports (`lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(51|80)[0-9]{2}"` shows the ones taken), then from the worktree's root:

```bash
PORT=<signaling port> ALLOWED_ORIGINS=http://localhost:<vite port> npm run dev
```

with the vite port and the `/ws` proxy set in `client/vite.config.ts`; that edit is local and never staged or committed.

- [ ] **Step 2: Open each world and look**

Open `http://localhost:<vite port>/dayhike/`, press Play, and load each world by the command bar (`/`), `seed <token>`: `hollow`, `room-1`, `room-140`, `room-50`, `room-19`, `room-30`.

On each, take a still on arrival before any input, and one standing a metre in front of the board. Then check, on the high tier and again on the low one (`?tier=low`):

1. On arrival the whole board is in the frame and faces the player.
2. From where the player arrives the trail's name can be read.
3. At a metre, every sheet can be read: the map's names, the poster's lines, the rules' small print.
4. The map matches the world: walking the trail to the first fork, the fork is where the map draws it, on the side the map draws it.
5. The planks and the wear read as a weathered board. With the stand-ins, the paper is flat and the print grey; say so, and look again when the images are in.
6. A player can walk round the board and cannot walk through it at any angle; nothing solid stands where nothing is drawn. Walk into each end and the middle from the front and from behind.
7. "Read the poster" appears at the poster's sheet and nowhere along the rest of the board.
8. By headlamp after dark (`/time 23`), the board can still be read.

Also at an upright phone's size (a window 390 by 844): the whole board is in the first frame.

- [ ] **Step 3: Two players**

Create a party on one page, open its invite link on a second, and start the match. Both players see the same marks on the board: the same stains, the same faint letters.

- [ ] **Step 4: Write the note**

`docs/trail/<date>-trailhead-board-verification.md`: the commit looked at, the browser and its renderer string, and for each world what its stills showed and the eight checks, each met or missed. A check that is missed is reported as missed with what was seen; it is not re-worded into a pass.

- [ ] **Step 5: Revert the local edit and commit the note alone**

```bash
git checkout -- client/vite.config.ts
git status --short   # only the note
git add docs/trail/<date>-trailhead-board-verification.md
git commit
```

Message:

```
docs: record the trailhead board as it looks in the game

## What

The trailhead board was looked at in the running game on six worlds, on
the high tier and the low, at a phone's size and with two players in one
match. The note says what each view showed.

## How

- `docs/trail/<date>-trailhead-board-verification.md` — the commit, the
  browser, and for each world the view on arrival, each sheet read at a
  metre, the map against the trail, the board walked round, the poster's
  prompt, and the board by headlamp.
```
