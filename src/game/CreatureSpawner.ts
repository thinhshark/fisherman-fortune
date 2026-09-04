import Phaser from "phaser";
import {
	CREATURE_CATALOG,
	type CreatureDefinition,
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
	/** Optional debug label; destroyed with the creature. */
	debugLabel?: Phaser.GameObjects.Text;
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
	/** Dev-only: show catalog IDs above creatures. Keep false in normal play. */
	private static readonly SHOW_CREATURE_IDS = false;

	private readonly scene: Phaser.Scene;
	private readonly active = new Map<string, ActiveCreature>();
	private readonly claimed = new Map<string, ActiveCreature>();
	private spawnTimer?: Phaser.Time.TimerEvent;
	private destroyed = false;
	private nextNameIndex = 1;

	private readonly spawnTop: number;
	private readonly spawnBottom: number;
	private readonly zoneBands: Record<
		SpawnZoneLabel,
		{ minY: number; maxY: number }
	>;

	constructor(scene: Phaser.Scene, water: Phaser.GameObjects.Image) {
		this.scene = scene;

		const waterTop =
			water.y - water.originY * water.displayHeight;
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
		this.scheduleSpawn(CreatureSpawner.INITIAL_DELAY_MS);

		scene.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
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

	/**
	 * Remove a swimming creature from movement/cleanup tracking.
	 * Returns false if it is already claimed, missing, or inactive.
	 */
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

		const deltaSec = delta / 1000;
		const sceneWidth = this.scene.scale.width;
		const toDestroy: string[] = [];

		for (const [key, entry] of this.active) {
			const { sprite, definition, direction, debugLabel } = entry;
			sprite.x += definition.movementSpeed * direction * deltaSec;
			if (debugLabel) {
				debugLabel.setPosition(sprite.x, sprite.y - sprite.displayHeight * 0.5 - 8);
			}

			const halfW = sprite.displayWidth * 0.5;
			const fullyLeft = sprite.x + halfW < -CreatureSpawner.EDGE_PADDING_PX;
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

	private scheduleSpawn(delayMs: number): void {
		if (this.destroyed) {
			return;
		}

		this.spawnTimer?.remove(false);
		this.spawnTimer = this.scene.time.delayedCall(delayMs, () => {
			if (this.destroyed) {
				return;
			}
			this.trySpawn();
			const next = Phaser.Math.Between(
				CreatureSpawner.MIN_SPAWN_INTERVAL_MS,
				CreatureSpawner.MAX_SPAWN_INTERVAL_MS,
			);
			this.scheduleSpawn(next);
		});
	}

	private trySpawn(): void {
		if (this.destroyed || this.active.size >= CreatureSpawner.MAX_ACTIVE) {
			return;
		}

		const definition = this.pickWeightedCreature();
		if (!definition) {
			return;
		}

		const movingRight = Math.random() < 0.5;
		const movingLeft = !movingRight;
		const direction: 1 | -1 = movingRight ? 1 : -1;

		const sprite = this.scene.add.sprite(
			0,
			0,
			definition.textureKey,
		);
		sprite.setName(`creature-${definition.id}-${this.nextNameIndex}`);
		this.nextNameIndex += 1;
		sprite.setScale(definition.displayScale);
		sprite.setDepth(CreatureSpawner.CREATURE_DEPTH);
		sprite.setData("creatureId", definition.id);
		sprite.setData("category", definition.category);
		sprite.setData("value", representativeValue(definition.value));
		sprite.setData("weight", definition.weight);
		sprite.setData("isToxic", definition.isToxic);

		const halfW = sprite.displayWidth * 0.5;
		const spawnX = movingRight
			? -halfW - CreatureSpawner.EDGE_PADDING_PX
			: this.scene.scale.width + halfW + CreatureSpawner.EDGE_PADDING_PX;
		const spawnY = this.pickSpawnY(definition, sprite.displayHeight);

		sprite.setPosition(spawnX, spawnY);

		const shouldFlip =
			(movingRight && definition.defaultFacing === "left") ||
			(movingLeft && definition.defaultFacing === "right");
		sprite.setFlipX(shouldFlip);
		sprite.play(definition.animationKey);

		let debugLabel: Phaser.GameObjects.Text | undefined;
		if (CreatureSpawner.SHOW_CREATURE_IDS) {
			debugLabel = this.scene.add
				.text(spawnX, spawnY - sprite.displayHeight * 0.5 - 8, definition.id, {
					fontFamily: "monospace",
					fontSize: "12px",
					color: "#ffffff",
					backgroundColor: "#000000aa",
				})
				.setOrigin(0.5, 1)
				.setDepth(CreatureSpawner.CREATURE_DEPTH + 1);
		}

		const key = sprite.name;
		this.active.set(key, { sprite, definition, direction, debugLabel });
	}

	private pickSpawnY(
		definition: CreatureDefinition,
		displayHeight: number,
	): number {
		const halfH = displayHeight * 0.5;

		if (definition.isCrab) {
			// Seabed: sit just above the lower spawn margin.
			return Phaser.Math.Clamp(
				this.spawnBottom - halfH,
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

	private pickWeightedCreature(): CreatureDefinition | undefined {
		const total = CREATURE_CATALOG.reduce(
			(sum, c) => sum + c.frequencyWeight,
			0,
		);
		if (total <= 0) {
			return undefined;
		}

		let roll = Math.random() * total;
		for (const creature of CREATURE_CATALOG) {
			roll -= creature.frequencyWeight;
			if (roll <= 0) {
				return creature;
			}
		}
		return CREATURE_CATALOG[CREATURE_CATALOG.length - 1];
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
