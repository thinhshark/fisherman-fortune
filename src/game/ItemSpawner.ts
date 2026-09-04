import Phaser from "phaser";
import {
	ITEM_CATALOG,
	type ItemDefinition,
	type SpawnZoneLabel,
} from "./ItemCatalog";

export type ItemGameObject = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

export interface CatchableItem {
	object: ItemGameObject;
	definition: ItemDefinition;
}

export interface ActiveItem extends CatchableItem {}

/**
 * Spawns stationary underwater scrap / gems / bonuses.
 * Catch API is prepared for a later HookController integration.
 */
export class ItemSpawner {
	static readonly TARGET_ACTIVE = 5;
	private static readonly EDGE_PADDING_PX = 55;
	private static readonly BELOW_WATER_PX = 45;
	private static readonly ABOVE_SEABED_PX = 55;
	private static readonly MIN_SEPARATION_PX = 110;
	private static readonly MAX_POSITION_ATTEMPTS = 30;
	/** Behind creatures (5) and hook (20), above water bg (1). */
	private static readonly ITEM_DEPTH = 3;
	/** Keep clear of boat / resting hook in the center surface. */
	private static readonly BOAT_EXCLUDE_HALF_W = 100;
	private static readonly BOAT_EXCLUDE_DEPTH_PX = 140;

	private readonly scene: Phaser.Scene;
	private readonly water: Phaser.GameObjects.Image;
	private readonly active = new Map<string, ActiveItem>();
	private readonly claimed = new Map<string, ActiveItem>();
	private destroyed = false;
	private nextNameIndex = 1;

	private readonly spawnTop: number;
	private readonly spawnBottom: number;
	private readonly zoneBands: Record<
		SpawnZoneLabel,
		{ minY: number; maxY: number }
	>;
	private readonly boatAnchorX: number;

	private readonly _initialSpawnReport: {
		id: string;
		x: number;
		y: number;
	}[] = [];

	/** Last successful initial spawn snapshot (for diagnostics). */
	get initialSpawnReport(): ReadonlyArray<{
		id: string;
		x: number;
		y: number;
	}> {
		return this._initialSpawnReport;
	}

	constructor(
		scene: Phaser.Scene,
		water: Phaser.GameObjects.Image,
		boatAnchor?: Readonly<{ x: number; y: number }>,
	) {
		this.scene = scene;
		this.water = water;
		this.boatAnchorX = boatAnchor?.x ?? scene.scale.width * 0.5;

		const waterTop = water.y - water.originY * water.displayHeight;
		this.spawnTop = waterTop + ItemSpawner.BELOW_WATER_PX;
		this.spawnBottom =
			scene.scale.height - ItemSpawner.ABOVE_SEABED_PX;

		if (this.spawnBottom <= this.spawnTop) {
			throw new Error(
				"ItemSpawner: invalid underwater spawn bounds from water object.",
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
		this.spawnInitialItems();

		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get activeCount(): number {
		return this.active.size;
	}

	get activeItems(): readonly ActiveItem[] {
		return Array.from(this.active.values());
	}

	update(_time: number, _delta: number): void {
		// Stationary items — reserved for future catch / refill timing.
	}

	getCatchableItems(): readonly CatchableItem[] {
		const result: CatchableItem[] = [];
		for (const entry of this.active.values()) {
			if (!entry.object.active) {
				continue;
			}
			result.push({
				object: entry.object,
				definition: entry.definition,
			});
		}
		return result;
	}

	claimItem(item: CatchableItem | ItemGameObject): boolean {
		if (this.destroyed) {
			return false;
		}
		const object = this.resolveObject(item);
		if (!object.active) {
			return false;
		}
		const key = object.name;
		if (this.claimed.has(key)) {
			return false;
		}
		const entry = this.active.get(key);
		if (!entry || entry.object !== object) {
			return false;
		}
		this.active.delete(key);
		this.claimed.set(key, entry);
		return true;
	}

	destroyClaimedItem(item: CatchableItem | ItemGameObject): void {
		const object = this.resolveObject(item);
		const key = object.name;
		const entry = this.claimed.get(key);
		if (!entry || entry.object !== object) {
			return;
		}
		this.destroyEntry(key, this.claimed);
	}

	/** Fill back up to TARGET_ACTIVE after claimed items are removed. */
	refillMissingItems(): void {
		if (this.destroyed) {
			return;
		}
		while (this.active.size < ItemSpawner.TARGET_ACTIVE) {
			const spawned = this.trySpawnOne(this.collectOccupiedCenters());
			if (!spawned) {
				break;
			}
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

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

	private spawnInitialItems(): void {
		const report: { id: string; x: number; y: number }[] = [];
		const usedTypes = new Set<string>();

		for (let i = 0; i < ItemSpawner.TARGET_ACTIVE; i += 1) {
			const preferUnique = usedTypes.size < ITEM_CATALOG.length;
			const definition = this.pickWeightedItem(usedTypes, preferUnique);
			if (!definition) {
				break;
			}
			const placed = this.spawnDefinition(
				definition,
				this.collectOccupiedCenters(),
			);
			if (!placed) {
				break;
			}
			usedTypes.add(definition.id);
			report.push({
				id: definition.id,
				x: placed.object.x,
				y: placed.object.y,
			});
		}

		this._initialSpawnReport.push(...report);

		if (this.active.size !== ItemSpawner.TARGET_ACTIVE) {
			throw new Error(
				`ItemSpawner expected ${ItemSpawner.TARGET_ACTIVE} initial items, got ${this.active.size}`,
			);
		}
	}

	private trySpawnOne(
		occupied: ReadonlyArray<{ x: number; y: number }>,
	): ActiveItem | undefined {
		const usedTypes = new Set(
			Array.from(this.active.values()).map((e) => e.definition.id),
		);
		const preferUnique = usedTypes.size < ITEM_CATALOG.length;
		const definition = this.pickWeightedItem(usedTypes, preferUnique);
		if (!definition) {
			return undefined;
		}
		return this.spawnDefinition(definition, occupied);
	}

	private spawnDefinition(
		definition: ItemDefinition,
		occupied: ReadonlyArray<{ x: number; y: number }>,
	): ActiveItem | undefined {
		const position = this.pickSpawnPosition(definition, occupied);
		if (!position) {
			return undefined;
		}

		const object = this.createItemObject(definition);
		object.setName(`item-${definition.id}-${this.nextNameIndex}`);
		this.nextNameIndex += 1;
		object.setPosition(position.x, position.y);
		object.setScale(definition.displayScale);
		object.setDepth(ItemSpawner.ITEM_DEPTH);
		object.setData("itemId", definition.id);
		object.setData("rewardMin", definition.rewardMin);
		object.setData("rewardMax", definition.rewardMax);
		object.setData("rewardOperation", definition.rewardOperation);
		object.setData("weight", definition.weight);
		object.setData("retractSpeed", definition.retractSpeed);
		object.setData("effectType", definition.effectType);

		if (
			definition.animationKey &&
			object instanceof Phaser.GameObjects.Sprite
		) {
			object.play(definition.animationKey);
		}

		const entry: ActiveItem = { object, definition };
		this.active.set(object.name, entry);
		return entry;
	}

	private createItemObject(definition: ItemDefinition): ItemGameObject {
		if (definition.animationKey) {
			return this.scene.add.sprite(0, 0, definition.textureKey);
		}
		return this.scene.add.image(0, 0, definition.textureKey);
	}

	private pickWeightedItem(
		excludeIds: ReadonlySet<string>,
		preferUnique: boolean,
	): ItemDefinition | undefined {
		const pool = preferUnique
			? ITEM_CATALOG.filter((item) => !excludeIds.has(item.id))
			: ITEM_CATALOG.slice();
		const candidates = pool.length > 0 ? pool : ITEM_CATALOG.slice();
		const total = candidates.reduce((sum, c) => sum + c.spawnWeight, 0);
		if (total <= 0) {
			return undefined;
		}
		let roll = Math.random() * total;
		for (const item of candidates) {
			roll -= item.spawnWeight;
			if (roll <= 0) {
				return item;
			}
		}
		return candidates[candidates.length - 1];
	}

	private pickSpawnPosition(
		definition: ItemDefinition,
		occupied: ReadonlyArray<{ x: number; y: number }>,
	): { x: number; y: number } | undefined {
		const zone =
			definition.spawnZones[
				Phaser.Math.Between(0, definition.spawnZones.length - 1)
			];
		const band = this.zoneBands[zone];
		const minX = ItemSpawner.EDGE_PADDING_PX;
		const maxX = this.scene.scale.width - ItemSpawner.EDGE_PADDING_PX;
		const minY = Math.max(this.spawnTop, band.minY);
		const maxY = Math.min(this.spawnBottom, band.maxY);

		if (maxX <= minX || maxY <= minY) {
			return undefined;
		}

		let best: { x: number; y: number } | undefined;
		let bestMinDist = -1;

		for (let attempt = 0; attempt < ItemSpawner.MAX_POSITION_ATTEMPTS; attempt += 1) {
			const x = Phaser.Math.FloatBetween(minX, maxX);
			const y = Phaser.Math.FloatBetween(minY, maxY);
			if (this.isInBoatExclusion(x, y)) {
				continue;
			}
			if (this.isDuplicatePosition(x, y, occupied)) {
				continue;
			}

			const minDist = this.minDistanceToOccupied(x, y, occupied);
			if (minDist >= ItemSpawner.MIN_SEPARATION_PX) {
				return { x, y };
			}
			if (minDist > bestMinDist) {
				bestMinDist = minDist;
				best = { x, y };
			}
		}

		// After 30 attempts, accept the farthest candidate found (may be closer than 110).
		return best;
	}

	private isInBoatExclusion(x: number, y: number): boolean {
		const dx = Math.abs(x - this.boatAnchorX);
		if (dx > ItemSpawner.BOAT_EXCLUDE_HALF_W) {
			return false;
		}
		const waterTop =
			this.water.y - this.water.originY * this.water.displayHeight;
		return (
			y >= waterTop &&
			y <= waterTop + ItemSpawner.BOAT_EXCLUDE_DEPTH_PX
		);
	}

	private isDuplicatePosition(
		x: number,
		y: number,
		occupied: ReadonlyArray<{ x: number; y: number }>,
	): boolean {
		const eps = 1;
		for (const p of occupied) {
			if (Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps) {
				return true;
			}
		}
		return false;
	}

	private minDistanceToOccupied(
		x: number,
		y: number,
		occupied: ReadonlyArray<{ x: number; y: number }>,
	): number {
		if (occupied.length === 0) {
			return Number.POSITIVE_INFINITY;
		}
		let min = Number.POSITIVE_INFINITY;
		for (const p of occupied) {
			const d = Math.hypot(p.x - x, p.y - y);
			if (d < min) {
				min = d;
			}
		}
		return min;
	}

	private collectOccupiedCenters(): { x: number; y: number }[] {
		const points: { x: number; y: number }[] = [];
		for (const entry of this.active.values()) {
			points.push({ x: entry.object.x, y: entry.object.y });
		}
		return points;
	}

	private resolveObject(item: CatchableItem | ItemGameObject): ItemGameObject {
		return "object" in item ? item.object : item;
	}

	private destroyEntry(
		key: string,
		collection: Map<string, ActiveItem>,
	): void {
		const entry = collection.get(key);
		if (!entry) {
			return;
		}
		collection.delete(key);
		entry.object.destroy();
	}

	private validateCatalogAssets(): void {
		for (const item of ITEM_CATALOG) {
			if (!this.scene.textures.exists(item.textureKey)) {
				throw new Error(`Missing item texture: ${item.textureKey}`);
			}
			if (item.animationKey && !this.scene.anims.exists(item.animationKey)) {
				throw new Error(`Missing item animation: ${item.animationKey}`);
			}
		}
	}
}
