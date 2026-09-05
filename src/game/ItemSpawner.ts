import Phaser from "phaser";
import type { ActiveTypeRegistry } from "./ActiveTypeRegistry";
import type { CreatureSpawner } from "./CreatureSpawner";
import { ItemSpawnEffect } from "./ItemSpawnEffect";
import {
	ENABLED_ITEM_CATALOG,
	ITEM_CATALOG,
	getItemById,
	type ItemDefinition,
	type SpawnZoneLabel,
} from "./ItemCatalog";
import {
	PEARL_HIT_SIZE_FRAC,
	resolveItemDisplayScale,
} from "./config/ItemBalance";
import { ITEM_IDLE_MOTION } from "./config/ItemIdleMotionConfig";

export type ItemGameObject = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

export interface CatchableItem {
	object: ItemGameObject;
	definition: ItemDefinition;
}

export interface ActiveItem extends CatchableItem {
	typeToken: number;
}

export const BARREL_EXPLODED_EVENT = "barrel-exploded";

export interface BarrelExplodedPayload {
	x: number;
	y: number;
	sourceId: string;
}

/** Set true briefly while diagnosing explosion hit detection. */
const DEBUG_EXPLOSION = false;
/** Set true to log skipped initial item placements. */
const DEBUG_ITEM_SPAWN = false;

/**
 * Spawns stationary underwater items with per-type schedules.
 * Catch API is used by CatchController; scoring stays in GameSession.
 */
export class ItemSpawner {
	static readonly TARGET_ACTIVE = 5;
	static readonly EXPLOSION_ANIM_KEY = "explosion-barrel";
	private static readonly EDGE_PADDING_PX = 55;
	private static readonly BELOW_WATER_PX = 45;
	private static readonly ABOVE_SEABED_PX = 55;
	private static readonly MIN_SEPARATION_PX = 110;
	private static readonly MAX_POSITION_ATTEMPTS = 30;
	/** Behind creatures (5) and hook (20), above water bg (1). */
	private static readonly ITEM_DEPTH = 3;
	private static readonly EXPLOSION_DEPTH = 40;
	private static readonly SKIP_RETRY_MS = 1500;
	/** Keep clear of boat / resting hook in the center surface. */
	private static readonly BOAT_EXCLUDE_HALF_W = 100;
	private static readonly BOAT_EXCLUDE_DEPTH_PX = 140;

	private readonly scene: Phaser.Scene;
	private readonly water: Phaser.GameObjects.Image;
	private readonly registry: ActiveTypeRegistry;
	private readonly active = new Map<string, ActiveItem>();
	private readonly claimed = new Map<string, ActiveItem>();
	private readonly scheduleTimers = new Map<string, Phaser.Time.TimerEvent>();
	private readonly explosionSprites = new Set<Phaser.GameObjects.Sprite>();
	private readonly explodingKeys = new Set<string>();
	private readonly spawnEffects = new Map<string, ItemSpawnEffect>();
	private readonly idleTweens = new Map<string, Phaser.Tweens.Tween>();
	private destroyed = false;
	private enabled = true;
	private paused = false;
	private nextNameIndex = 1;
	/** Explicit one-per-session Pearl counter (also mirrored by registry maxSpawns). */
	private pearlSpawnCount = 0;
	/** True after the one-shot start-of-session item fill (not reset on Pause). */
	private initialSpawnDone = false;
	/** Extra centers (creatures / hook) used only during initial placement. */
	private initialExtraOccupied: ReadonlyArray<{ x: number; y: number }> = [];

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
		registry: ActiveTypeRegistry,
		boatAnchor?: Readonly<{ x: number; y: number }>,
	) {
		this.scene = scene;
		this.water = water;
		this.registry = registry;
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
		this.enabled = false;

		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get activeCount(): number {
		return this.active.size;
	}

	get activeItems(): readonly ActiveItem[] {
		return Array.from(this.active.values());
	}

	update(_time: number, _delta: number): void {
		if (this.destroyed || this.paused || !this.enabled) {
			return;
		}
	}

	setEnabled(enabled: boolean): void {
		if (this.destroyed) {
			return;
		}
		this.enabled = enabled;
		if (!enabled) {
			this.clearScheduleTimers();
		}
	}

	/**
	 * Enable spawning and create one instance of every spawnAtStart item.
	 * Pass creature centers so pre-spawn avoids the initial fish school.
	 * Pause/Resume must not call this again; Replay/Home recreate the spawner.
	 */
	beginSpawning(
		extraOccupied: ReadonlyArray<{ x: number; y: number }> = [],
	): void {
		if (this.destroyed) {
			return;
		}
		this.enabled = true;
		if (!this.initialSpawnDone) {
			this.initialExtraOccupied = extraOccupied;
			this.spawnInitialItems();
			this.initialExtraOccupied = [];
			this.initialSpawnDone = true;
		}
		this.startSchedules();
	}

	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
		for (const timer of this.scheduleTimers.values()) {
			timer.paused = paused;
		}
		for (const effect of this.spawnEffects.values()) {
			effect.setPaused(paused);
		}
		for (const tween of this.idleTweens.values()) {
			if (paused) {
				tween.pause();
			} else {
				tween.resume();
			}
		}
		this.setItemAnimsPaused(paused);
		for (const sprite of this.explosionSprites) {
			if (!sprite.active || !sprite.anims) {
				continue;
			}
			if (paused) {
				sprite.anims.pause();
			} else if (sprite.anims.isPaused) {
				sprite.anims.resume();
			}
		}
	}

	getCatchableItems(): readonly CatchableItem[] {
		const result: CatchableItem[] = [];
		for (const entry of this.active.values()) {
			if (!entry.object.active) {
				continue;
			}
			// Skip until spawn entrance is safely visible.
			if (entry.object.getData("spawnCatchable") === false) {
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
		this.stopIdleMotion(key, entry.object, true);
		const effect = this.spawnEffects.get(key);
		if (effect) {
			effect.destroy();
			this.spawnEffects.delete(key);
		}
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

	/**
	 * Scheduled items fill empty slots. Do not instantly refill to the cap.
	 */
	refillMissingItems(): void {
		// Intentionally empty: the next due timer uses the freed slot.
	}

	/**
	 * Barrel catch: explode at the barrel's world position, then remove it.
	 * Affects all underwater catchables (creatures + items) within radius via
	 * circle∩bounds. Victims grant no rewards. Other barrels do not chain.
	 */
	detonateBarrel(
		item: CatchableItem | ItemGameObject,
		creatureSpawner?: CreatureSpawner,
	): boolean {
		if (this.destroyed) {
			return false;
		}
		const object = this.resolveObject(item);
		const key = object.name;
		if (this.explodingKeys.has(key)) {
			return false;
		}
		const entry = this.active.get(key) ?? this.claimed.get(key);
		if (!entry || entry.object !== object) {
			return false;
		}
		if (entry.definition.rewardType !== "bomb") {
			return false;
		}

		this.explodingKeys.add(key);
		const originX = object.x;
		const originY = object.y;
		const radius = entry.definition.explosionRadius;

		if (!this.claimed.has(key) && this.active.has(key)) {
			this.active.delete(key);
			this.claimed.set(key, entry);
		}

		const creatureChecked = creatureSpawner?.activeCount ?? 0;
		const itemChecked = this.active.size;
		const creatureVictims =
			creatureSpawner?.destroyVictimsInExplosionCircle(
				originX,
				originY,
				radius,
			) ?? [];
		const itemVictims = this.destroyItemVictimsInExplosionCircle(
			originX,
			originY,
			radius,
			key,
		);

		if (DEBUG_EXPLOSION) {
			console.info("[explosion]", {
				center: { x: originX, y: originY },
				radius,
				creaturesChecked: creatureChecked,
				itemsChecked: itemChecked,
				creatureVictims: creatureVictims.map((v) => ({
					id: v.id,
					bounds: {
						x: v.bounds.x,
						y: v.bounds.y,
						w: v.bounds.width,
						h: v.bounds.height,
					},
				})),
				itemVictims: itemVictims.map((v) => ({
					id: v.id,
					bounds: {
						x: v.bounds.x,
						y: v.bounds.y,
						w: v.bounds.width,
						h: v.bounds.height,
					},
				})),
			});
		}

		this.destroyEntry(key, this.claimed);
		this.playExplosion(originX, originY);
		this.scene.events.emit(BARREL_EXPLODED_EVENT, {
			x: originX,
			y: originY,
			sourceId: entry.definition.id,
		} satisfies BarrelExplodedPayload);
		this.explodingKeys.delete(key);
		return true;
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.clearScheduleTimers();

		for (const key of Array.from(this.active.keys())) {
			this.destroyEntry(key, this.active);
		}
		for (const key of Array.from(this.claimed.keys())) {
			this.destroyEntry(key, this.claimed);
		}
		for (const sprite of Array.from(this.explosionSprites)) {
			sprite.destroy();
		}
		this.explosionSprites.clear();
		for (const effect of Array.from(this.spawnEffects.values())) {
			effect.destroy();
		}
		this.spawnEffects.clear();
		this.clearAllIdleTweens();

		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private spawnInitialItems(): void {
		const report: { id: string; x: number; y: number }[] = [];
		const starters = ENABLED_ITEM_CATALOG.filter((item) => item.spawnAtStart);
		// Shuffle so placement order does not bias one zone every session.
		Phaser.Utils.Array.Shuffle(starters);

		for (const definition of starters) {
			const zoneBias = report.length;
			const placed = this.trySpawnDefinition(definition, {
				ignoreActiveCap: true,
				zoneBias,
			});
			if (!placed) {
				if (DEBUG_ITEM_SPAWN) {
					console.warn(
						`[ItemSpawner] initial spawn skipped (no valid position): ${definition.id}`,
					);
				}
				continue;
			}
			report.push({
				id: definition.id,
				x: placed.object.x,
				y: placed.object.y,
			});
		}

		this._initialSpawnReport.length = 0;
		this._initialSpawnReport.push(...report);
		if (DEBUG_ITEM_SPAWN) {
			console.info("[ItemSpawner] initial spawn report", report);
		}
	}

	private startSchedules(): void {
		this.clearScheduleTimers();
		for (const definition of ENABLED_ITEM_CATALOG) {
			if (definition.randomOnce) {
				// Pre-spawned Pearl (etc.) already counts toward the session cap.
				if (
					definition.maxSpawnsPerSession > 0 &&
					this.registry.getSpawnCount(definition.id) >=
						definition.maxSpawnsPerSession
				) {
					continue;
				}
				if (this.registry.isActive(definition.id)) {
					continue;
				}
				const minMs = Math.max(0, definition.spawnDelayMin) * 1000;
				const maxMs = Math.max(minMs, definition.spawnDelayMax * 1000);
				const delay = Phaser.Math.Between(minMs, maxMs);
				this.armTimer(definition.id, delay, true);
				continue;
			}
			if (definition.spawnInterval > 0) {
				this.armTimer(definition.id, definition.spawnInterval * 1000, false);
			}
		}
	}

	private armTimer(typeId: string, delayMs: number, once: boolean): void {
		if (this.destroyed || !this.enabled) {
			return;
		}
		this.scheduleTimers.get(typeId)?.remove(false);
		const timer = this.scene.time.delayedCall(delayMs, () => {
			if (this.destroyed || !this.enabled) {
				return;
			}
			const spawned = this.trySpawnById(typeId);
			const definition = getItemById(typeId);
			if (!definition || !definition.enabled) {
				return;
			}
			if (once) {
				if (spawned) {
					this.scheduleTimers.delete(typeId);
					return;
				}
				if (
					definition.maxSpawnsPerSession > 0 &&
					this.registry.getSpawnCount(typeId) >=
						definition.maxSpawnsPerSession
				) {
					this.scheduleTimers.delete(typeId);
					return;
				}
				this.armTimer(typeId, ItemSpawner.SKIP_RETRY_MS, true);
				return;
			}
			if (
				definition.maxSpawnsPerSession > 0 &&
				this.registry.getSpawnCount(typeId) >=
					definition.maxSpawnsPerSession
			) {
				this.scheduleTimers.delete(typeId);
				return;
			}
			this.armTimer(typeId, definition.spawnInterval * 1000, false);
		});
		if (this.paused) {
			timer.paused = true;
		}
		this.scheduleTimers.set(typeId, timer);
	}

	private trySpawnById(typeId: string): ActiveItem | undefined {
		const definition = getItemById(typeId);
		if (!definition || !definition.enabled) {
			return undefined;
		}
		return this.trySpawnDefinition(definition);
	}

	private trySpawnDefinition(
		definition: ItemDefinition,
		options?: { ignoreActiveCap?: boolean; zoneBias?: number },
	): ActiveItem | undefined {
		if (this.destroyed || !this.enabled || this.paused) {
			return undefined;
		}
		if (
			!options?.ignoreActiveCap &&
			this.active.size >= ItemSpawner.TARGET_ACTIVE
		) {
			return undefined;
		}
		if (
			!this.registry.canSpawn(
				definition.id,
				definition.maxSpawnsPerSession,
			)
		) {
			return undefined;
		}
		if (definition.id === "pearl" && this.pearlSpawnCount >= 1) {
			return undefined;
		}

		const occupied = [
			...this.collectOccupiedCenters(),
			...this.initialExtraOccupied,
		];
		const position = this.pickSpawnPosition(
			definition,
			occupied,
			options?.zoneBias,
		);
		if (!position) {
			return undefined;
		}

		const object = this.createItemObject(definition);
		object.setName(`item-${definition.id}-${this.nextNameIndex}`);
		this.nextNameIndex += 1;
		object.setPosition(position.x, position.y);
		const displayScale = resolveItemDisplayScale(
			definition,
			this.scene.textures,
		);
		object.setScale(displayScale);
		object.setData("baseScale", displayScale);
		object.setDepth(ItemSpawner.ITEM_DEPTH);
		object.setData("itemId", definition.id);
		object.setData("rewardMin", definition.scoreMin);
		object.setData("rewardMax", definition.scoreMax);
		object.setData("scoreValue", definition.scoreValue);
		object.setData("rewardOperation", definition.rewardOperation);
		object.setData("weight", definition.weight);
		object.setData("retractSpeed", definition.retractSpeed);
		object.setData("effectType", definition.effectType);
		object.setData("rewardType", definition.rewardType);
		object.setData("timeBonusSeconds", definition.timeValue);
		if (definition.id === "pearl") {
			object.setData("hitSizeFrac", PEARL_HIT_SIZE_FRAC);
		}

		if (
			definition.animationKey &&
			object instanceof Phaser.GameObjects.Sprite
		) {
			object.play(definition.animationKey);
			if (this.paused) {
				object.anims.pause();
			}
		}

		const typeToken = this.registry.acquire(definition.id);
		if (typeToken === undefined) {
			object.destroy();
			return undefined;
		}
		object.setData("typeToken", typeToken);

		if (definition.id === "pearl") {
			this.pearlSpawnCount += 1;
		}

		const entry: ActiveItem = { object, definition, typeToken };
		this.active.set(object.name, entry);
		this.playSpawnEntrance(entry);
		return entry;
	}

	private playSpawnEntrance(entry: ActiveItem): void {
		const key = entry.object.name;
		this.spawnEffects.get(key)?.destroy();
		const effect = new ItemSpawnEffect(
			this.scene,
			entry.object,
			Number(entry.object.getData("baseScale")) || entry.definition.scale,
			entry.object.y,
			() => {
				if (this.destroyed || !this.active.has(key)) {
					return;
				}
				this.startIdleMotion(entry);
			},
		);
		this.spawnEffects.set(key, effect);
		if (this.paused) {
			effect.setPaused(true);
		}
	}

	private startIdleMotion(entry: ActiveItem): void {
		if (this.destroyed || !entry.object.active) {
			return;
		}
		const key = entry.object.name;
		this.stopIdleMotion(key, entry.object, false);

		const object = entry.object;
		const baseX = object.x;
		const baseY = object.y;
		const baseAngle = object.angle;
		const baseScale =
			Number(object.getData("baseScale")) || object.scaleX;

		object.setData("idleBaseX", baseX);
		object.setData("idleBaseY", baseY);
		object.setData("idleBaseAngle", baseAngle);

		const cfg = ITEM_IDLE_MOTION;
		const amplitudeY = Phaser.Math.FloatBetween(
			cfg.bobMinPixels,
			cfg.bobMaxPixels,
		);
		const amplitudeAngle = Phaser.Math.FloatBetween(
			cfg.rotationMinDegrees,
			cfg.rotationMaxDegrees,
		);
		const duration = Phaser.Math.Between(
			cfg.durationMinMs,
			cfg.durationMaxMs,
		);
		const delay = Phaser.Math.Between(0, cfg.initialDelayMaxMs);
		// Vary starting direction so items are not phase-locked.
		const ySign = Math.random() < 0.5 ? -1 : 1;
		const angleSign = Math.random() < 0.5 ? -1 : 1;

		const tween = this.scene.tweens.add({
			targets: object,
			y: baseY + ySign * amplitudeY,
			angle: baseAngle + angleSign * amplitudeAngle,
			duration,
			delay,
			ease: "Sine.easeInOut",
			yoyo: true,
			repeat: -1,
		});

		this.idleTweens.set(key, tween);
		if (this.paused) {
			tween.pause();
		}

		// Keep scale locked to the approved display size.
		object.setScale(baseScale);
	}

	/**
	 * Stop idle bobbing. When `snapToBase` is true (catch), restore base angle
	 * and keep current world XY so HookController can attach cleanly.
	 */
	private stopIdleMotion(
		key: string,
		object: ItemGameObject,
		snapToBase: boolean,
	): void {
		const tween = this.idleTweens.get(key);
		if (tween) {
			tween.stop();
			this.idleTweens.delete(key);
		}
		if (!object.active) {
			return;
		}
		if (snapToBase) {
			const baseAngle = object.getData("idleBaseAngle");
			if (typeof baseAngle === "number" && Number.isFinite(baseAngle)) {
				object.setAngle(baseAngle);
			} else {
				object.setAngle(0);
			}
			const baseScale = Number(object.getData("baseScale"));
			if (baseScale > 0) {
				object.setScale(baseScale);
			}
		}
	}

	private clearAllIdleTweens(): void {
		for (const [key, tween] of this.idleTweens) {
			tween.stop();
			this.idleTweens.delete(key);
		}
		this.idleTweens.clear();
	}

	private destroyItemVictimsInExplosionCircle(
		originX: number,
		originY: number,
		radius: number,
		sourceKey: string,
	): { id: string; bounds: Phaser.Geom.Rectangle }[] {
		if (!(radius > 0)) {
			return [];
		}
		const circle = new Phaser.Geom.Circle(originX, originY, radius);
		const victims: {
			key: string;
			id: string;
			bounds: Phaser.Geom.Rectangle;
		}[] = [];

		for (const [key, entry] of this.active) {
			if (key === sourceKey) {
				continue;
			}
			// Do not recursively detonate other barrels.
			if (entry.definition.rewardType === "bomb") {
				if (DEBUG_EXPLOSION) {
					console.info("[explosion] skipped other barrel", {
						id: entry.definition.id,
						key,
					});
				}
				continue;
			}
			if (!entry.object.active) {
				continue;
			}

			const bounds = entry.object.getBounds();
			const hit = Phaser.Geom.Intersects.CircleToRectangle(
				circle,
				bounds,
			);
			if (!hit) {
				const fallback =
					Phaser.Math.Distance.Between(
						originX,
						originY,
						entry.object.x,
						entry.object.y,
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
			entry.object.setData("destroyedByExplosion", true);
			entry.object.disableInteractive();
			if (
				entry.object instanceof Phaser.GameObjects.Sprite &&
				entry.object.anims
			) {
				entry.object.anims.stop();
			}
			this.destroyEntry(victim.key, this.active);
		}

		return victims.map((v) => ({ id: v.id, bounds: v.bounds }));
	}

	private playExplosion(x: number, y: number): void {
		if (!this.scene.anims.exists(ItemSpawner.EXPLOSION_ANIM_KEY)) {
			return;
		}
		const sprite = this.scene.add.sprite(
			x,
			y,
			"explosion-barrel-001",
		);
		sprite.setDepth(ItemSpawner.EXPLOSION_DEPTH);
		sprite.setName(`explosion-${this.nextNameIndex}`);
		this.nextNameIndex += 1;
		this.explosionSprites.add(sprite);
		sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
			this.explosionSprites.delete(sprite);
			sprite.destroy();
		});
		sprite.play(ItemSpawner.EXPLOSION_ANIM_KEY);
		if (this.paused) {
			sprite.anims.pause();
		}
	}

	private setItemAnimsPaused(paused: boolean): void {
		const apply = (entry: ActiveItem): void => {
			const object = entry.object;
			if (
				!(object instanceof Phaser.GameObjects.Sprite) ||
				!object.active ||
				!object.anims
			) {
				return;
			}
			if (paused) {
				object.anims.pause();
			} else if (object.anims.isPaused) {
				object.anims.resume();
			}
		};
		for (const entry of this.active.values()) {
			apply(entry);
		}
		for (const entry of this.claimed.values()) {
			apply(entry);
		}
	}

	private createItemObject(definition: ItemDefinition): ItemGameObject {
		if (definition.animationKey) {
			return this.scene.add.sprite(0, 0, definition.textureKey);
		}
		return this.scene.add.image(0, 0, definition.textureKey);
	}

	private pickSpawnPosition(
		definition: ItemDefinition,
		occupied: ReadonlyArray<{ x: number; y: number }>,
		zoneBias?: number,
	): { x: number; y: number } | undefined {
		const zones = definition.spawnZones;
		const zone =
			typeof zoneBias === "number" && zones.length > 0
				? zones[zoneBias % zones.length]
				: zones[Phaser.Math.Between(0, zones.length - 1)];
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

		// Only accept a near-miss if it still has meaningful separation.
		if (best && bestMinDist >= ItemSpawner.MIN_SEPARATION_PX * 0.65) {
			return best;
		}
		return undefined;
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
		this.stopIdleMotion(key, entry.object, false);
		const effect = this.spawnEffects.get(key);
		if (effect) {
			effect.destroy();
			this.spawnEffects.delete(key);
		}
		this.registry.release(entry.definition.id, entry.typeToken);
		entry.object.destroy();
	}

	private clearScheduleTimers(): void {
		for (const timer of this.scheduleTimers.values()) {
			timer.remove(false);
		}
		this.scheduleTimers.clear();
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
		if (!this.scene.anims.exists(ItemSpawner.EXPLOSION_ANIM_KEY)) {
			throw new Error(
				`Missing item animation: ${ItemSpawner.EXPLOSION_ANIM_KEY}`,
			);
		}
	}
}
