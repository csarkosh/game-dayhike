import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import type { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { SpotLight } from "@babylonjs/core/Lights/spotLight.js";

import type { EnemyState, Vec3, WorldState } from "../sim/types.js";
import { AiState, NO_CARRIER } from "../sim/types.js";
import { ITEM_RADIUS } from "../sim/register.js";
import { ENEMY_HALF, PLAYER_HALF, PLAYER_EYE_OFFSET } from "../sim/constants.js";
import { aimDirection } from "../sim/view.js";
import { HOLLOW_HEIGHT, isHollowState } from "../sim/hollow.js";
import { EnemyModelPool, type ClipKind, type EnemyInstance } from "./enemyModel.js";
import { createHeadlamp, setLamp } from "./headlamp.js";
import { LAMP_DEFAULT, type LampState } from "./lampParams.js";

type View = { node: TransformNode; previous: Vector3; target: Vector3 };

/**
 * A view's first frame is drawn where the entity is, not on the way there.
 * `advance` below interpolates from the last position the entity held, and
 * `previous` only moves when `target` does, so a view whose two points
 * started at the origin stayed a fraction of the way from the origin to the
 * entity for as long as it stood still: a player who joined and did not walk
 * was drawn hundreds of metres away until their first step.
 */
function placeView(node: TransformNode, x: number, y: number, z: number): View {
  node.position.set(x, y, z);
  return { node, previous: new Vector3(x, y, z), target: new Vector3(x, y, z) };
}

/**
 * Which clip an enemy should be playing, derived entirely from simulation
 * state — nothing about animation crosses the wire.
 *
 * Deliberately keyed off `ai` rather than velocity. Enemy velocity is not in
 * the snapshot: `clientSession.renderState` hands every remote enemy a zeroed
 * vector, so a speed test would leave every enemy on a joining client standing
 * still while the host alone saw them walk. `ai` is transmitted, and it maps
 * cleanly because an idle enemy holds position and only a chasing one moves.
 */
export function clipForEnemy(enemy: Pick<EnemyState, "health" | "ai">): ClipKind {
  if (enemy.health <= 0 || enemy.ai === AiState.Dead) return "death";
  if (enemy.ai === AiState.Attack) return "attack";
  if (enemy.ai === AiState.Chase) return "walk";
  return "idle";
}

export class EntityViews {
  private readonly players = new Map<number, View>();
  private readonly enemies = new Map<number, View>();
  private readonly enemyModels = new Map<number, { instance: EnemyInstance; view: View }>();
  private readonly lamps = new Map<number, SpotLight>();
  private readonly items = new Map<number, Mesh>();
  private readonly playerMaterial: PBRMaterial;
  private readonly enemyMaterial: PBRMaterial;
  private readonly itemMaterial: PBRMaterial;
  private readonly hollowMaterial: PBRMaterial;
  readonly models = new EnemyModelPool();

  constructor(private readonly scene: Scene) {
    // PBRMaterial, not StandardMaterial: a StandardMaterial ignores
    // `scene.environmentTexture` entirely and takes the full sun intensity
    // (4.0 at noon), so a remote player's capsule would read blown-out and
    // unlit-by-sky beside PBR terrain. Metallic 0 and a mid roughness put
    // these capsules in the same dielectric, matte-ish range as the world
    // materials in `renderer.ts`.
    this.playerMaterial = new PBRMaterial("mat_player", scene);
    this.playerMaterial.albedoColor = new Color3(0.3, 0.7, 0.95);
    this.playerMaterial.metallic = 0;
    this.playerMaterial.roughness = 0.85;
    this.enemyMaterial = new PBRMaterial("mat_enemy", scene);
    // Violet, matching the enemy-reserved band in client/assets/palette.json.
    // ARCHITECTURE.md, Model conventions reserves hue 280-340 for enemies so
    // they never camouflage against a wall, and the fallback capsule has to
    // honour that too.
    this.enemyMaterial.albedoColor = new Color3(0.54, 0.18, 0.69);
    this.enemyMaterial.metallic = 0;
    this.enemyMaterial.roughness = 0.85;
    // A pale bundle: what is left of a hiker, matte so the lamp reads it.
    this.itemMaterial = new PBRMaterial("mat_item", scene);
    this.itemMaterial.albedoColor = new Color3(0.85, 0.8, 0.7);
    this.itemMaterial.metallic = 0;
    this.itemMaterial.roughness = 0.9;
    // The Hollow's placeholder: black, unlit, and outside the fog, so it stays
    // a silhouette at any distance in mist — findable in hindsight from far off.
    this.hollowMaterial = new PBRMaterial("mat_hollow", scene);
    this.hollowMaterial.albedoColor = new Color3(0, 0, 0);
    this.hollowMaterial.unlit = true;
    this.hollowMaterial.fogEnabled = false;
  }

  /**
   * `lamp` is this frame's headlamp state (`lampUnder(weather, t)`), shared
   * by every remote player's lamp: dread dims and flickers all of them alike.
   * Defaults to the tuned lamp for callers without weather.
   */
  sync(state: WorldState, localId: number, alpha: number, lampState: LampState = LAMP_DEFAULT): void {
    const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

    for (const [id, player] of state.players) {
      // The local player is the camera; drawing their own capsule would fill
      // the screen from the inside.
      if (id === localId) {
        this.players.get(id)?.node.setEnabled(false);
        continue;
      }
      const view = this.ensure(this.players, id, player.pos, () =>
        this.makeCapsule(`player_${id}`, this.playerMaterial),
      );
      view.node.setEnabled(true);
      this.advance(view, player.pos.x, player.pos.y, player.pos.z, clamped);
      view.node.rotation.y = player.yaw;

      // Unparented: a child of the capsule would inherit its yaw and turn
      // `direction` into a local vector, so position and direction are written
      // in world space every sync instead.
      let lamp = this.lamps.get(id);
      if (lamp === undefined) {
        lamp = createHeadlamp(this.scene, `lamp_player_${id}`);
        this.lamps.set(id, lamp);
      }
      lamp.position.set(view.node.position.x, view.node.position.y + PLAYER_EYE_OFFSET, view.node.position.z);
      const d = aimDirection(player.yaw, player.pitch);
      lamp.direction.set(d.x, d.y, d.z);
      setLamp(lamp, player.lamp.on, lampState);
    }
    this.prune(this.players, state.players);
    for (const [id, lamp] of this.lamps) {
      if (!state.players.has(id) || id === localId) {
        lamp.dispose();
        this.lamps.delete(id);
      }
    }

    for (const [id, enemy] of state.enemies) {
      if (isHollowState(enemy.ai)) {
        // The capsule is taller than the hull: lift it so both stand on the same feet.
        const hollowY = enemy.pos.y + (HOLLOW_HEIGHT / 2 - ENEMY_HALF.y);
        const view = this.ensure(
          this.enemies,
          id,
          { x: enemy.pos.x, y: hollowY, z: enemy.pos.z },
          () => this.makeHollow(`hollow_${id}`),
        );
        view.node.setEnabled(true);
        this.advance(view, enemy.pos.x, hollowY, enemy.pos.z, clamped);
        view.node.rotation.y = enemy.yaw;
        continue;
      }

      const instance = this.models.acquire(id);
      if (instance !== null) {
        const entry = this.ensureModel(id, instance, enemy.pos.x, enemy.pos.y - ENEMY_HALF.y, enemy.pos.z);
        // Hide the fallback capsule if one was made before the model loaded.
        this.enemies.get(id)?.node.setEnabled(false);
        // Model origins sit at the feet (ARCHITECTURE.md, Model conventions),
        // sim positions at the centre of the hull.
        this.advance(entry.view, enemy.pos.x, enemy.pos.y - ENEMY_HALF.y, enemy.pos.z, clamped);
        entry.view.node.rotation.y = enemy.yaw;
        instance.play(clipForEnemy(enemy));
        continue;
      }

      const view = this.ensure(this.enemies, id, enemy.pos, () =>
        this.makeCapsule(`enemy_${id}`, this.enemyMaterial),
      );
      view.node.setEnabled(true);
      this.advance(view, enemy.pos.x, enemy.pos.y, enemy.pos.z, clamped);
      view.node.rotation.y = enemy.yaw;
    }

    for (const [id] of this.enemyModels) {
      if (!state.enemies.has(id)) {
        this.models.release(id);
        this.enemyModels.delete(id);
      }
    }
    this.prune(this.enemies, state.enemies);

    for (const item of state.items) {
      let mesh = this.items.get(item.id);
      if (mesh === undefined) {
        // A pale bundle about the size of a pack: the placeholder for what is
        // left of a hiker, lit like everything else so the lamp finds it.
        mesh = MeshBuilder.CreateBox(`item_${item.id}`, { width: 0.5, height: 2 * ITEM_RADIUS, depth: 0.35 }, this.scene);
        mesh.material = this.itemMaterial;
        this.items.set(item.id, mesh);
      }
      if (item.signedOut || item.carrier === localId) {
        // Gone, or in this player's own hands: the renderer's camera bundle draws that one.
        mesh.setEnabled(false);
        continue;
      }
      const carrier = item.carrier === NO_CARRIER ? undefined : this.players.get(item.carrier);
      if (carrier !== undefined) {
        // Held against the front of the carrier's body: half a metre ahead
        // along their facing, a little above the hull's centre.
        const yaw = carrier.node.rotation.y;
        mesh.position.set(
          carrier.node.position.x + Math.sin(yaw) * 0.5,
          carrier.node.position.y + 0.2,
          carrier.node.position.z + Math.cos(yaw) * 0.5,
        );
        mesh.rotation.y = yaw;
      } else if (item.carrier === NO_CARRIER) {
        mesh.position.set(item.pos.x, item.pos.y, item.pos.z);
        mesh.rotation.y = 0;
      } else {
        // Carried by someone this frame's state does not hold (a joiner
        // between snapshots): nothing to attach to, so nothing to draw.
        mesh.setEnabled(false);
        continue;
      }
      mesh.setEnabled(true);
    }
    for (const [id, mesh] of this.items) {
      if (!state.items.some((it) => it.id === id)) {
        mesh.dispose();
        this.items.delete(id);
      }
    }
  }

  private ensureModel(
    id: number,
    instance: EnemyInstance,
    x: number,
    y: number,
    z: number,
  ): { instance: EnemyInstance; view: View } {
    const existing = this.enemyModels.get(id);
    if (existing) return existing;
    const entry = { instance, view: placeView(instance.root, x, y, z) };
    this.enemyModels.set(id, entry);
    return entry;
  }

  private ensure(map: Map<number, View>, id: number, at: Vec3, make: () => Mesh): View {
    const existing = map.get(id);
    if (existing) return existing;
    const view = placeView(make(), at.x, at.y, at.z);
    map.set(id, view);
    return view;
  }

  private advance(view: View, x: number, y: number, z: number, alpha: number): void {
    if (view.target.x !== x || view.target.y !== y || view.target.z !== z) {
      view.previous.copyFrom(view.target);
      view.target.set(x, y, z);
    }
    Vector3.LerpToRef(view.previous, view.target, alpha, view.node.position);
  }

  private prune(map: Map<number, View>, live: Map<number, unknown>): void {
    for (const [id, view] of map) {
      if (!live.has(id)) {
        view.node.dispose();
        map.delete(id);
      }
    }
  }

  private makeCapsule(name: string, material: PBRMaterial): Mesh {
    const mesh = MeshBuilder.CreateCapsule(
      name,
      { height: PLAYER_HALF.y * 2, radius: PLAYER_HALF.x },
      this.scene,
    );
    mesh.material = material;
    return mesh;
  }

  private makeHollow(name: string): Mesh {
    const mesh = MeshBuilder.CreateCapsule(name, { height: HOLLOW_HEIGHT, radius: ENEMY_HALF.x }, this.scene);
    mesh.material = this.hollowMaterial;
    return mesh;
  }

  dispose(): void {
    for (const view of this.players.values()) view.node.dispose();
    for (const view of this.enemies.values()) view.node.dispose();
    for (const lamp of this.lamps.values()) lamp.dispose();
    for (const mesh of this.items.values()) mesh.dispose();
    this.items.clear();
    this.players.clear();
    this.enemies.clear();
    this.enemyModels.clear();
    this.lamps.clear();
    this.models.dispose();
    this.hollowMaterial.dispose();
  }
}
