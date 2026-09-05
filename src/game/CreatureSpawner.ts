import Phaser from "phaser";
import type { ActiveTypeRegistry } from "./ActiveTypeRegistry";
import {
	getCreatureBalance,
	INITIAL_CREATURE_COUNT,
} from "./config/CreatureBalance";
import {
	CREATURE_CATALOG,
	type CreatureDefinition,
	type MovementDirection,
	type SpawnZoneLabel,
	representativeValue,
} from "./CreatureCatalog";

export interface CatchableCreature {
	sprite: Phaser.GameObjects.Sprite;
	definition: CreatureDefinition;
}

export interface ActiveCreature extends CatchableCreature {
	/** +1 right, -1 left */
	direction: 1 | -1;
	movementDirection: MovementDirection;
	typeToken: number;
	/** Optional debug label; destroyed with the creature. */
	debugLabel?: Phaser.GameObjects.Text;
}

interface SpawnPlacement {
	x: number;
	y: number;
	/** Spawn edge that produced this placement. */
	spawnSide: "Left" | "Right";
	movementDirection: MovementDirection;
}

/**
 * Spawns and moves fish / jelly / crab sprites across the underwater area.
 * Does not own hook collision or scoring.
 */
export class CreatureSpawner {
	private static readonly INITIAL_DELAY_MS = 700;
	private static readonly MIN_SPAWN_INTERVAL_MS = 650;
	private static readonly MAX_SPAWN_INTERVAL_MS = 1300;
	private static readonly MAX_ACTIVE = 14;
	private static readonly EDGE_PADDING_PX = 20;
	private static readonly VERTICAL_MARGIN_PX = 40;
	private static readonly CREATURE_DEPTH = 5;
	/** Keep clear of boat / resting hook in the center surface. */
	private static readonly BOAT_EXCLUDE_HALF_W = 110;
	private static readonly BOAT_EXCLUDE_DEPTH_PX = 120;
	/** Dev-only: show catalog IDs above creatures. Keep false in normal play. */
	private static readonly SHOW_CREATURE_IDS = false;

	private readonly scene: Phaser.Scene;
	private readonly registry: ActiveTypeRegistry;
	private readonly active = new Map<string, ActiveCreature>();
	private readonly claimed = new Map<string, ActiveCreature>();
	private spawnTimer?: Phaser.Time.TimerEvent;
	private destroyed = false;
	private enabled = true;
	private paused = false;
	private nextNameIndex = 1;
	private initialPopulationDone = false;

	private readonly spawnTop: number;
	private readonly spawnBottom: number;
	private readonly boatAnchorX: number;
	private readonly zoneBands: Record<
		SpawnZoneLabel,
		{ minY: number; maxY: number }
	>;

	constructor(
		scene: Phaser.Scene,
		water: Phaser.GameObjects.Image,
		registry: ActiveTypeRegistry,
		boatAnchor?: Readonly<{ x: number }>,
	) {
		this.scene = scene;
		this.registry = registry;
		this.boatAnchorX = boatAnchor?.x ?? scene.scale.width * 0.5;

		const waterTop = water.y - water.originY * water.displayHeight;
		this.spawnTop = waterTop + CreatureSpawner.VERTICAL_MARGIN_PX;
		this.spawnBottom =
			scene.scale.height - CreatureSpawner.VERTICAL_MARGIN_PX;

		if (this.spawnBottom <= this.spawnTop) {
			throw new Error(
				"CreatureSpawner: invalid underwater spawn bounds from water object.",
			);
		}

		const bandHeight = (this.spawnBottom - this.spawnTop) / 3;
		this.zoneBands = {
			Upper: {
				minY: this.spawnTop,
				maxY: this.spawnTop + bandHeight,
			},
			Middle: {
				minY: this.spawnTop + bandHeight,
				maxY: this.spawnTop + bandHeight * 2,
			},
			Lower: {
				minY: this.spawnTop + bandHeight * 2,
				maxY: this.spawnBottom,
			},
		};

		this.validateCatalogAssets();
		this.enabled = false;

		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get activeCount(): number {
		return this.active.size;
	}

	get activeCreatures(): readonly ActiveCreature[] {
		return Array.from(this.active.values());
	}

	getCatchableCreatures(): readonly CatchableCreature[] {
		const result: CatchableCreature[] = [];
		for (const entry of this.active.values()) {
			if (!entry.sprite.active) {
				continue;
			}
			result.push({
				sprite: entry.sprite,
				definition: entry.definition,
			});
		}
		return result;
	}

	/** World centers of active (uncaught) creatures — for item pre-spawn spacing. */
	getActiveCenters(): ReadonlyArray<{ x: number; y: number }> {
		const points: { x: number; y: number }[] = [];
		for (const entry of this.active.values()) {
			if (!entry.sprite.active) {
				continue;
			}
			points.push({ x: entry.sprite.x, y: entry.sprite.y });
		}
		return points;
	}

	setEnabled(enabled: boolean): void {
		if (this.destroyed) {
			return;
		}
		this.enabled = enabled;
		if (!enabled) {
			this.spawnTimer?.remove(false);
			this.spawnTimer = undefined;
		} else if (!this.spawnTimer && !this.paused) {
			this.scheduleSpawn(CreatureSpawner.INITIAL_DELAY_MS);
		}
	}

	/**
	 * Home → Play / Play Again: fill the water immediately, then schedule
	 * normal edge spawns. Pause/Resume does not re-run initial population.
	 */
	beginSpawning(): void {
		if (this.destroyed) {
			return;
		}
		this.enabled = true;
		if (!this.initialPopulationDone) {
			this.spawnInitialPopulation();
			this.initialPopulationDone = true;
		}
		if (!this.spawnTimer && !this.paused) {
			this.scheduleSpawn(CreatureSpawner.INITIAL_DELAY_MS);
		}
	}

	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;

		if (this.spawnTimer) {
			this.spawnTimer.paused = paused;
		}

		this.setCreatureAnimsPaused(paused);
	}

	claimCreature(sprite: Phaser.GameObjects.Sprite): boolean {
		if (this.destroyed || !sprite.active) {
			return false;
		}
		const key = sprite.name;
		if (this.claimed.has(key)) {
			return false;
		}
		const entry = this.active.get(key);
		if (!entry || entry.sprite !== sprite) {
			return false;
		}
		this.active.delete(key);
		this.claimed.set(key, entry);
		return true;
	}

	destroyClaimedCreature(sprite: Phaser.GameObjects.Sprite): void {
		const key = sprite.name;
		const entry = this.claimed.get(key);
		if (!entry || entry.sprite !== sprite) {
			return;
		}
		this.destroyEntry(key, this.claimed);
	}

	/**
	 * Remove active (uncaught) creatures whose world bounds intersect the
	 * explosion circle. No rewards. Lifetime spawn counts are not decremented.
	 */
	destroyVictimsInExplosionCircle(
		originX: number,
		originY: number,
		radius: number,
	): { id: string; bounds: Phaser.Geom.Rectangle }[] {
		if (this.destroyed || !(radius > 0)) {
			return [];
		}
		const circle = new Phaser.Geom.Circle(originX, originY, radius);
		const victims: {
			key: string;
			id: string;
			bounds: Phaser.Geom.Rectangle;
		}[] = [];

		for (const [key, entry] of this.active) {
			if (!entry.sprite.active) {
				continue;
			}
			const bounds = entry.sprite.getBounds();
			const hit = Phaser.Geom.Intersects.CircleToRectangle(
				circle,
				bounds,
			);
			if (!hit) {
				const fallback =
					Phaser.Math.Distance.Between(
						originX,
						originY,
						entry.sprite.x,
						entry.sprite.y,
					) <= radius;
				if (!fallback) {
					continue;
				}
			}
			victims.push({ key, id: entry.definition.id, bounds });
		}

		for (const victim of victims) {
			const entry = this.active.get(victim.key);
			if (!entry) {
				continue;
			}
			entry.sprite.setData("destroyedByExplosion", true);
			entry.sprite.disableInteractive();
			if (entry.sprite.anims) {
				entry.sprite.anims.stop();
			}
			this.destroyEntry(victim.key, this.active);
		}

		return victims.map((v) => ({ id: v.id, bounds: v.bounds }));
	}

	getSpawnBounds(): Readonly<{
		spawnTop: number;
		spawnBottom: number;
		zoneBands: Record<SpawnZoneLabel, { minY: number; maxY: number }>;
	}> {
		return {
			spawnTop: this.spawnTop,
			spawnBottom: this.spawnBottom,
			zoneBands: this.zoneBands,
		};
	}

	update(_time: number, delta: number): void {
		if (this.destroyed) {
			return;
		}

		if (!this.enabled || this.paused) {
			return;
		}

		const deltaSec = delta / 1000;
		const sceneWidth = this.scene.scale.width;
		const toDestroy: string[] = [];

		for (const [key, entry] of this.active) {
			const { sprite, definition, direction, debugLabel } = entry;
			sprite.x += definition.movementSpeed * direction * deltaSec;
			if (debugLabel) {
				debugLabel.setPosition(
					sprite.x,
					sprite.y - sprite.displayHeight * 0.5 - 8,
				);
			}

			const halfW = sprite.displayWidth * 0.5;
			const fullyLeft =
				sprite.x + halfW < -CreatureSpawner.EDGE_PADDING_PX;
			const fullyRight =
				sprite.x - halfW >
				sceneWidth + CreatureSpawner.EDGE_PADDING_PX;

			if (
				(direction < 0 && fullyLeft) ||
				(direction > 0 && fullyRight)
			) {
				toDestroy.push(key);
			}
		}

		for (const key of toDestroy) {
			this.destroyEntry(key, this.active);
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.spawnTimer?.remove(false);
		this.spawnTimer = undefined;

		for (const key of Array.from(this.active.keys())) {
			this.destroyEntry(key, this.active);
		}
		for (const key of Array.from(this.claimed.keys())) {
			this.destroyEntry(key, this.claimed);
		}

		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private spawnInitialPopulation(): void {
		const target = Math.min(
			INITIAL_CREATURE_COUNT,
			CreatureSpawner.MAX_ACTIVE,
		);
		const definitions = this.pickDistinctCreatures(target);
		if (definitions.length === 0) {
			return;
		}

		const width = this.scene.scale.width;
		const pad = CreatureSpawner.EDGE_PADDING_PX + 40;
		const usable = Math.max(1, width - pad * 2);
		const section = usable / definitions.length;
		const slots = definitions.map((_, index) => {
			const minX = pad + section * index;
			const maxX = pad + section * (index + 1);
			return Phaser.Math.FloatBetween(minX, maxX);
		});
		Phaser.Utils.Array.Shuffle(slots);

		for (let i = 0; i < definitions.length; i += 1) {
			const definition = definitions[i];
			const spawnFromLeft = Math.random() < 0.5;
			const spawnSide: "Left" | "Right" = spawnFromLeft ? "Left" : "Right";
			const movementDirection: MovementDirection = spawnFromLeft
				? "Right"
				: "Left";
			const displayHeight = this.measureDisplayHeight(definition);

			let x = slots[i];
			const y = this.pickSpawnY(definition, displayHeight);
			if (this.isInBoatExclusion(x, y)) {
				x =
					x < this.boatAnchorX
						? Math.max(
								pad,
								this.boatAnchorX -
									CreatureSpawner.BOAT_EXCLUDE_HALF_W -
									20,
							)
						: Math.min(
								width - pad,
								this.boatAnchorX +
									CreatureSpawner.BOAT_EXCLUDE_HALF_W +
									20,
							);
			}

			this.spawnCreature(definition, {
				x,
				y,
				spawnSide,
				movementDirection,
			});
		}
	}

	private pickDistinctCreatures(count: number): CreatureDefinition[] {
		const pool = CREATURE_CATALOG.filter((creature) =>
			this.registry.canSpawn(creature.id),
		);
		const picked: CreatureDefinition[] = [];
		const remaining = pool.slice();

		while (picked.length < count && remaining.length > 0) {
			const total = remaining.reduce(
				(sum, c) => sum + c.frequencyWeight,
				0,
			);
			if (total <= 0) {
				break;
			}
			let roll = Math.random() * total;
			let chosenIndex = remaining.length - 1;
			for (let i = 0; i < remaining.length; i += 1) {
				roll -= remaining[i].frequencyWeight;
				if (roll <= 0) {
					chosenIndex = i;
					break;
				}
			}
			picked.push(remaining[chosenIndex]);
			remaining.splice(chosenIndex, 1);
		}

		Phaser.Utils.Array.Shuffle(picked);
		return picked;
	}

	private scheduleSpawn(delayMs: number): void {
		if (this.destroyed || !this.enabled) {
			return;
		}

		this.spawnTimer?.remove(false);
		this.spawnTimer = this.scene.time.delayedCall(delayMs, () => {
			if (this.destroyed || !this.enabled || this.paused) {
				return;
			}
			this.trySpawnFromEdge();
			const next = Phaser.Math.Between(
				CreatureSpawner.MIN_SPAWN_INTERVAL_MS,
				CreatureSpawner.MAX_SPAWN_INTERVAL_MS,
			);
			this.scheduleSpawn(next);
		});
		if (this.paused && this.spawnTimer) {
			this.spawnTimer.paused = true;
		}
	}

	private setCreatureAnimsPaused(paused: boolean): void {
		const apply = (entry: ActiveCreature): void => {
			const sprite = entry.sprite;
			if (!sprite.active || !sprite.anims) {
				return;
			}
			if (paused) {
				sprite.anims.pause();
			} else if (sprite.anims.isPaused) {
				sprite.anims.resume();
			}
		};
		for (const entry of this.active.values()) {
			apply(entry);
		}
		for (const entry of this.claimed.values()) {
			apply(entry);
		}
	}

	private trySpawnFromEdge(): void {
		if (
			this.destroyed ||
			!this.enabled ||
			this.paused ||
			this.active.size >= CreatureSpawner.MAX_ACTIVE
		) {
			return;
		}

		const definition = this.pickWeightedCreature();
		if (!definition) {
			return;
		}

		const spawnFromLeft = Math.random() < 0.5;
		const spawnSide: "Left" | "Right" = spawnFromLeft ? "Left" : "Right";
		const movementDirection: MovementDirection = spawnFromLeft
			? "Right"
			: "Left";
		const frame = this.scene.textures.get(definition.textureKey).get();
		const displayHeight = frame.cutHeight * definition.scale;
		const halfW = (frame.cutWidth * definition.scale) * 0.5;

		const spawnX = spawnFromLeft
			? -halfW - CreatureSpawner.EDGE_PADDING_PX
			: this.scene.scale.width + halfW + CreatureSpawner.EDGE_PADDING_PX;
		const spawnY = this.pickSpawnY(definition, displayHeight);

		this.spawnCreature(definition, {
			x: spawnX,
			y: spawnY,
			spawnSide,
			movementDirection,
		});
	}

	private measureDisplayHeight(definition: CreatureDefinition): number {
		const frame = this.scene.textures.get(definition.textureKey).get();
		return frame.cutHeight * definition.scale;
	}

	private spawnCreature(
		definition: CreatureDefinition,
		placement: SpawnPlacement,
	): ActiveCreature | undefined {
		if (this.destroyed || !this.registry.canSpawn(definition.id)) {
			return undefined;
		}

		const sprite = this.scene.add.sprite(0, 0, definition.textureKey);
		sprite.setName(`creature-${definition.id}-${this.nextNameIndex}`);
		this.nextNameIndex += 1;
		// Reset orientation before scale so pooling/reuse never keeps stale flip.
		sprite.setFlipX(false);
		sprite.setScale(definition.scale);
		sprite.setData("baseScale", definition.scale);
		sprite.setDepth(CreatureSpawner.CREATURE_DEPTH);
		sprite.setData("creatureId", definition.id);
		sprite.setData("category", definition.category);
		sprite.setData("value", representativeValue(definition.value));
		sprite.setData("weight", definition.weight);
		sprite.setData("retractSpeed", definition.retractSpeed);
		sprite.setData("isToxic", definition.isToxic);
		sprite.setData("nativeFacing", definition.nativeFacing);
		sprite.setData("movementDirection", placement.movementDirection);

		sprite.setPosition(placement.x, placement.y);

		const movementDirection = placement.movementDirection;
		const direction: 1 | -1 = movementDirection === "Right" ? 1 : -1;
		// Single facing rule: flip only when artwork faces opposite of travel.
		sprite.setFlipX(definition.nativeFacing !== movementDirection);
		sprite.play(definition.animationKey);
		if (this.paused) {
			sprite.anims.pause();
		}

		if (import.meta.env.DEV) {
			const balance = getCreatureBalance(definition.id);
			console.info("[spawn-identity]", {
				creatureId: definition.id,
				nativeFacing: definition.nativeFacing,
				spawnSide: placement.spawnSide,
				movementDirection,
				flipX: sprite.flipX,
				movementSpeed: definition.movementSpeed,
				weight: definition.weight,
				retractSpeed: definition.retractSpeed,
				rewardOperation: balance?.rewardOperation,
			});
		}

		let debugLabel: Phaser.GameObjects.Text | undefined;
		if (CreatureSpawner.SHOW_CREATURE_IDS) {
			debugLabel = this.scene.add
				.text(
					placement.x,
					placement.y - sprite.displayHeight * 0.5 - 8,
					definition.id,
					{
						fontFamily: "monospace",
						fontSize: "12px",
						color: "#ffffff",
						backgroundColor: "#000000aa",
					},
				)
				.setOrigin(0.5, 1)
				.setDepth(CreatureSpawner.CREATURE_DEPTH + 1);
		}

		const typeToken = this.registry.acquire(definition.id);
		if (typeToken === undefined) {
			debugLabel?.destroy();
			sprite.destroy();
			return undefined;
		}
		sprite.setData("typeToken", typeToken);

		const entry: ActiveCreature = {
			sprite,
			definition,
			direction,
			movementDirection,
			debugLabel,
			typeToken,
		};
		this.active.set(sprite.name, entry);
		return entry;
	}

	private pickSpawnY(
		definition: CreatureDefinition,
		displayHeight: number,
	): number {
		const halfH = displayHeight * 0.5;
		const underwaterHeight = this.spawnBottom - this.spawnTop;

		if (definition.isCrab) {
			return Phaser.Math.Clamp(
				this.spawnBottom - halfH,
				this.spawnTop + halfH,
				this.spawnBottom - halfH,
			);
		}

		const minRatio = definition.spawnYMinRatio;
		const maxRatio = definition.spawnYMaxRatio;
		if (
			typeof minRatio === "number" &&
			typeof maxRatio === "number" &&
			Number.isFinite(minRatio) &&
			Number.isFinite(maxRatio)
		) {
			const lo =
				this.spawnTop +
				underwaterHeight * Math.min(minRatio, maxRatio);
			const hi =
				this.spawnTop +
				underwaterHeight * Math.max(minRatio, maxRatio);
			const minY = Math.min(lo + halfH, hi - halfH);
			const maxY = Math.max(lo + halfH, hi - halfH);
			return Phaser.Math.Clamp(
				Phaser.Math.FloatBetween(minY, maxY),
				this.spawnTop + halfH,
				this.spawnBottom - halfH,
			);
		}

		const zone =
			definition.spawnZone[
				Phaser.Math.Between(0, definition.spawnZone.length - 1)
			];
		const band = this.zoneBands[zone];
		const minY = Math.min(band.minY + halfH, band.maxY - halfH);
		const maxY = Math.max(band.minY + halfH, band.maxY - halfH);
		return Phaser.Math.FloatBetween(minY, maxY);
	}

	private isInBoatExclusion(x: number, y: number): boolean {
		const dx = Math.abs(x - this.boatAnchorX);
		if (dx > CreatureSpawner.BOAT_EXCLUDE_HALF_W) {
			return false;
		}
		return y <= this.spawnTop + CreatureSpawner.BOAT_EXCLUDE_DEPTH_PX;
	}

	private pickWeightedCreature(): CreatureDefinition | undefined {
		const candidates = CREATURE_CATALOG.filter((creature) =>
			this.registry.canSpawn(creature.id),
		);
		if (candidates.length === 0) {
			return undefined;
		}

		const total = candidates.reduce(
			(sum, c) => sum + c.frequencyWeight,
			0,
		);
		if (total <= 0) {
			return undefined;
		}

		let roll = Math.random() * total;
		for (const creature of candidates) {
			roll -= creature.frequencyWeight;
			if (roll <= 0) {
				return creature;
			}
		}
		return candidates[candidates.length - 1];
	}

	private destroyEntry(
		key: string,
		collection: Map<string, ActiveCreature>,
	): void {
		const entry = collection.get(key);
		if (!entry) {
			return;
		}
		collection.delete(key);
		this.registry.release(entry.definition.id, entry.typeToken);
		entry.debugLabel?.destroy();
		entry.sprite.destroy();
	}

	private validateCatalogAssets(): void {
		const ids = new Set<string>();
		for (const creature of CREATURE_CATALOG) {
			if (ids.has(creature.id)) {
				throw new Error(`Duplicate creature id: ${creature.id}`);
			}
			ids.add(creature.id);

			if (!this.scene.anims.exists(creature.animationKey)) {
				throw new Error(
					`Missing animation key: ${creature.animationKey}`,
				);
			}
			if (!this.scene.textures.exists(creature.textureKey)) {
				throw new Error(
					`Missing texture key: ${creature.textureKey}`,
				);
			}
		}
		if (ids.size !== 33) {
			throw new Error(
				`Expected 33 unique creature ids, got ${ids.size}`,
			);
		}
	}
}
