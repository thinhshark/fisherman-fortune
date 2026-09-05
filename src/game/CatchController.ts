import Phaser from "phaser";
import type { CreatureCategory, CreatureWeight } from "./CreatureCatalog";
import type { CatchableCreature, CreatureSpawner } from "./CreatureSpawner";
import type {
	ItemEffectType,
	ItemWeight,
	RewardOperation,
} from "./ItemCatalog";
import type {
	CatchableItem,
	ItemGameObject,
	ItemSpawner,
} from "./ItemSpawner";
import { type HookController } from "./HookController";
import { getCreatureBalance } from "./config/CreatureBalance";

/** Dev-only: stroke the hook collision circle and catchable bounds. */
const SHOW_CATCH_DEBUG = false;

/** Behind the hook Container (depth 20), above water (1) and swimming fish (5). */
const CAUGHT_DEPTH = 15;

/**
 * Item catch rectangle from displayed bounds, optionally shrunk via hitSizeFrac
 * (e.g. Pearl uses ~80% so the huge source PNG does not keep a giant hit box).
 */
function getItemCatchBounds(
	object: ItemGameObject,
): Phaser.Geom.Rectangle {
	const bounds = object.getBounds();
	const rawFrac = object.getData("hitSizeFrac");
	const frac =
		typeof rawFrac === "number" &&
		Number.isFinite(rawFrac) &&
		rawFrac > 0 &&
		rawFrac < 1
			? rawFrac
			: 1;
	if (frac >= 1) {
		return bounds;
	}
	const w = bounds.width * frac;
	const h = bounds.height * frac;
	return new Phaser.Geom.Rectangle(
		bounds.centerX - w * 0.5,
		bounds.centerY - h * 0.5,
		w,
		h,
	);
}

export const CREATURE_DELIVERED_EVENT = "creature-delivered";
export const ITEM_DELIVERED_EVENT = "item-delivered";

export interface CreatureDeliveredPayload {
	id: string;
	category: CreatureCategory;
	value: number;
	weight: CreatureWeight;
	isToxic: boolean;
	/** World position of the sprite immediately before destroy. */
	deliveryX: number;
	deliveryY: number;
}

export interface ItemDeliveredPayload {
	id: string;
	rewardMin: number;
	rewardMax: number;
	rewardOperation: RewardOperation;
	effectType: ItemEffectType;
	timeBonusSeconds: number;
	weight: ItemWeight;
	retractSpeed: number;
	/** World position of the item immediately before destroy. */
	deliveryX: number;
	deliveryY: number;
}

type CaughtTarget =
	| {
			kind: "creature";
			sprite: CatchableCreature["sprite"];
			definition: CatchableCreature["definition"];
	  }
	| {
			kind: "item";
			object: ItemGameObject;
			definition: CatchableItem["definition"];
	  };

type CatchCandidate =
	| {
			kind: "creature";
			candidate: CatchableCreature;
			distSq: number;
	  }
	| {
			kind: "item";
			candidate: CatchableItem;
			distSq: number;
	  };

/**
 * Geometry-based hook catching for creatures and stationary items.
 * Does not parent targets into the hook Container and does not award score.
 */
export class CatchController {
	private readonly scene: Phaser.Scene;
	private readonly hook: HookController;
	private readonly creatureSpawner: CreatureSpawner;
	private readonly itemSpawner: ItemSpawner;
	private readonly hookCircle = new Phaser.Geom.Circle();
	private readonly boundHandler = this.handleRetractComplete.bind(this);

	private caught?: CaughtTarget;
	private delivered = false;
	private destroyed = false;
	private paused = false;
	private readonly debugGraphics?: Phaser.GameObjects.Graphics;

	constructor(
		scene: Phaser.Scene,
		hook: HookController,
		creatureSpawner: CreatureSpawner,
		itemSpawner: ItemSpawner,
	) {
		this.scene = scene;
		this.hook = hook;
		this.creatureSpawner = creatureSpawner;
		this.itemSpawner = itemSpawner;

		if (SHOW_CATCH_DEBUG) {
			this.debugGraphics = scene.add.graphics();
			this.debugGraphics.setName("catchDebug");
			this.debugGraphics.setDepth(1000);
		}

		this.hook.onRetractComplete(this.boundHandler);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	update(_time: number, _delta: number): void {
		if (this.destroyed || this.paused) {
			return;
		}

		if (!this.caught && this.hook.isCasting) {
			this.tryCatch();
		}

		if (this.caught) {
			this.attachCaught();
		}

		this.drawDebug();
	}

	/**
	 * Stop collision checks and caught-target position updates while paused.
	 * The attached target stays where it was.
	 */
	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.hook.offRetractComplete(this.boundHandler);

		if (this.caught) {
			this.destroyCaughtTarget(this.caught);
			this.caught = undefined;
		}

		this.debugGraphics?.destroy();

		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private tryCatch(): void {
		if (this.caught) {
			return;
		}

		const hookPos = this.hook.hookWorldPosition;
		this.hookCircle.setTo(
			hookPos.x,
			hookPos.y,
			this.hook.hookCollisionRadius,
		);

		let best: CatchCandidate | undefined;

		for (const creature of this.creatureSpawner.getCatchableCreatures()) {
			const bounds = creature.sprite.getBounds();
			if (
				!Phaser.Geom.Intersects.CircleToRectangle(
					this.hookCircle,
					bounds,
				)
			) {
				continue;
			}
			const dx = creature.sprite.x - hookPos.x;
			const dy = creature.sprite.y - hookPos.y;
			const distSq = dx * dx + dy * dy;
			if (!best || distSq < best.distSq) {
				best = { kind: "creature", candidate: creature, distSq };
			}
		}

		for (const item of this.itemSpawner.getCatchableItems()) {
			const bounds = getItemCatchBounds(item.object);
			if (
				!Phaser.Geom.Intersects.CircleToRectangle(
					this.hookCircle,
					bounds,
				)
			) {
				continue;
			}
			const dx = item.object.x - hookPos.x;
			const dy = item.object.y - hookPos.y;
			const distSq = dx * dx + dy * dy;
			if (!best || distSq < best.distSq) {
				best = { kind: "item", candidate: item, distSq };
			}
		}

		if (!best) {
			return;
		}

		if (best.kind === "creature") {
			this.catchCreature(best.candidate);
		} else {
			this.catchItem(best.candidate);
		}
	}

	private catchCreature(best: CatchableCreature): void {
		if (!this.creatureSpawner.claimCreature(best.sprite)) {
			return;
		}

		// Snapshot stable metadata before the sprite is reparented/destroyed.
		// creatureId comes from the definition, never from an animation frame key.
		const catchData = {
			creatureId: best.definition.id,
			weight: best.definition.weight,
			retractSpeed: best.definition.retractSpeed,
		};

		if (
			typeof catchData.retractSpeed !== "number" ||
			!Number.isFinite(catchData.retractSpeed) ||
			catchData.retractSpeed <= 0
		) {
			if (import.meta.env.DEV) {
				console.warn(
					`[pullSpeed] Missing pull configuration for ${catchData.creatureId} ` +
						`(category=${best.definition.category}, weight=${String(catchData.weight)}). ` +
						`Refusing silent fallback.`,
				);
			}
			this.creatureSpawner.destroyClaimedCreature(best.sprite);
			return;
		}

		const animationKey = best.sprite.anims?.currentAnim?.key;

		// Temporary remapping verification — remove after confirming shark/toxic IDs.
		if (import.meta.env.DEV) {
			const balance = getCreatureBalance(catchData.creatureId);
			console.info("[catch-identity]", {
				creatureId: catchData.creatureId,
				animationKey,
				weight: catchData.weight,
				retractSpeed: catchData.retractSpeed,
				rewardOperation: balance?.rewardOperation,
			});
		}

		if (
			!this.hook.beginRetractingWithCatch(catchData.retractSpeed, {
				creatureId: catchData.creatureId,
				category: best.definition.category,
				weight: catchData.weight,
				textureKey: best.sprite.texture.key,
				animationKey,
			})
		) {
			this.creatureSpawner.destroyClaimedCreature(best.sprite);
			return;
		}

		this.caught = {
			kind: "creature",
			sprite: best.sprite,
			definition: best.definition,
		};
		this.delivered = false;
		best.sprite.setDepth(CAUGHT_DEPTH);
	}

	private catchItem(best: CatchableItem): void {
		if (best.definition.rewardType === "bomb") {
			this.detonateCaughtBarrel(best);
			return;
		}

		if (!this.itemSpawner.claimItem(best)) {
			return;
		}

		const retractSpeed = best.definition.retractSpeed;
		if (
			!this.hook.beginRetractingWithCatch(retractSpeed, {
				itemId: best.definition.id,
				weight: best.definition.weight,
			})
		) {
			this.itemSpawner.destroyClaimedItem(best);
			return;
		}

		this.caught = {
			kind: "item",
			object: best.object,
			definition: best.definition,
		};
		this.delivered = false;
		best.object.setDepth(CAUGHT_DEPTH);
	}

	private detonateCaughtBarrel(best: CatchableItem): void {
		if (!this.itemSpawner.claimItem(best)) {
			return;
		}
		this.itemSpawner.detonateBarrel(best, this.creatureSpawner);
		this.hook.forceEmptyRetractIfCasting();
	}

	private attachCaught(): void {
		const caught = this.caught;
		if (!caught) {
			return;
		}

		const hookPos = this.hook.hookAttachWorldPosition;

		if (caught.kind === "creature") {
			if (!caught.sprite.active) {
				return;
			}
			caught.sprite.setPosition(hookPos.x, hookPos.y);
			return;
		}

		if (!caught.object.active) {
			return;
		}
		caught.object.setPosition(hookPos.x, hookPos.y);
	}

	private handleRetractComplete(): void {
		if (this.destroyed || this.delivered || !this.caught) {
			return;
		}

		const target = this.caught;
		this.delivered = true;
		this.caught = undefined;

		if (target.kind === "creature") {
			const { sprite, definition } = target;
			const deliveryX = sprite.x;
			const deliveryY = sprite.y;
			const payload: CreatureDeliveredPayload = {
				id: definition.id,
				category: definition.category,
				value: Number(sprite.getData("value") ?? 0),
				weight: definition.weight,
				isToxic: definition.isToxic,
				deliveryX,
				deliveryY,
			};
			this.creatureSpawner.destroyClaimedCreature(sprite);
			this.scene.events.emit(CREATURE_DELIVERED_EVENT, payload);
			return;
		}

		const { object, definition } = target;
		const deliveryX = object.x;
		const deliveryY = object.y;
		const payload: ItemDeliveredPayload = {
			id: definition.id,
			rewardMin: definition.rewardMin,
			rewardMax: definition.rewardMax,
			rewardOperation: definition.rewardOperation,
			effectType: definition.effectType,
			timeBonusSeconds: definition.timeBonusSeconds,
			weight: definition.weight,
			retractSpeed: definition.retractSpeed,
			deliveryX,
			deliveryY,
		};
		this.itemSpawner.destroyClaimedItem(object);
		this.scene.events.emit(ITEM_DELIVERED_EVENT, payload);
		// Graceful end-of-game: ItemSpawner.setEnabled(false) no-ops refill.
		this.itemSpawner.refillMissingItems();
	}

	private destroyCaughtTarget(target: CaughtTarget): void {
		if (target.kind === "creature") {
			if (target.sprite.active) {
				this.creatureSpawner.destroyClaimedCreature(target.sprite);
			}
			return;
		}
		if (target.object.active) {
			this.itemSpawner.destroyClaimedItem(target.object);
		}
	}

	private drawDebug(): void {
		const graphics = this.debugGraphics;
		if (!graphics) {
			return;
		}

		graphics.clear();

		const hookPos = this.hook.hookWorldPosition;
		graphics.lineStyle(2, 0xffdd00, 0.9);
		graphics.strokeCircle(
			hookPos.x,
			hookPos.y,
			this.hook.hookCollisionRadius,
		);

		if (!this.hook.isCasting) {
			return;
		}

		graphics.lineStyle(1, 0x00ff88, 0.7);
		for (const candidate of this.creatureSpawner.getCatchableCreatures()) {
			const bounds = candidate.sprite.getBounds();
			graphics.strokeRect(
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height,
			);
		}

		graphics.lineStyle(1, 0xff88ff, 0.7);
		for (const candidate of this.itemSpawner.getCatchableItems()) {
			const bounds = getItemCatchBounds(candidate.object);
			graphics.strokeRect(
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height,
			);
		}
	}
}
