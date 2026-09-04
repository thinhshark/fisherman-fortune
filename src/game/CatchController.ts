import Phaser from "phaser";
import type { CreatureCategory, CreatureWeight } from "./CreatureCatalog";
import type { CatchableCreature, CreatureSpawner } from "./CreatureSpawner";
import { type HookController } from "./HookController";

/** Dev-only: stroke the hook collision circle and catchable bounds. */
const SHOW_CATCH_DEBUG = false;

/** Behind the hook Container (depth 20), above water (1) and swimming fish (5). */
const CAUGHT_DEPTH = 15;

export const CREATURE_DELIVERED_EVENT = "creature-delivered";

export interface CreatureDeliveredPayload {
	id: string;
	category: CreatureCategory;
	value: number;
	weight: CreatureWeight;
	isToxic: boolean;
}

/**
 * Geometry-based hook catching. Does not parent creatures into the hook Container
 * and does not award score.
 */
export class CatchController {
	private readonly scene: Phaser.Scene;
	private readonly hook: HookController;
	private readonly spawner: CreatureSpawner;
	private readonly hookCircle = new Phaser.Geom.Circle();
	private readonly boundHandler = this.handleRetractComplete.bind(this);

	private caught?: CatchableCreature;
	private delivered = false;
	private destroyed = false;
	private readonly debugGraphics?: Phaser.GameObjects.Graphics;

	constructor(
		scene: Phaser.Scene,
		hook: HookController,
		spawner: CreatureSpawner,
	) {
		this.scene = scene;
		this.hook = hook;
		this.spawner = spawner;

		if (SHOW_CATCH_DEBUG) {
			this.debugGraphics = scene.add.graphics();
			this.debugGraphics.setName("catchDebug");
			this.debugGraphics.setDepth(1000);
		}

		this.hook.onRetractComplete(this.boundHandler);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	update(_time: number, _delta: number): void {
		if (this.destroyed) {
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

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.hook.offRetractComplete(this.boundHandler);

		if (this.caught?.sprite.active) {
			this.spawner.destroyClaimedCreature(this.caught.sprite);
		}
		this.caught = undefined;

		this.debugGraphics?.destroy();

		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private tryCatch(): void {
		const hookPos = this.hook.hookWorldPosition;
		this.hookCircle.setTo(
			hookPos.x,
			hookPos.y,
			this.hook.hookCollisionRadius,
		);

		let best: CatchableCreature | undefined;
		let bestDistSq = Number.POSITIVE_INFINITY;

		for (const candidate of this.spawner.getCatchableCreatures()) {
			const bounds = candidate.sprite.getBounds();
			if (
				!Phaser.Geom.Intersects.CircleToRectangle(
					this.hookCircle,
					bounds,
				)
			) {
				continue;
			}

			const dx = candidate.sprite.x - hookPos.x;
			const dy = candidate.sprite.y - hookPos.y;
			const distSq = dx * dx + dy * dy;
			if (distSq < bestDistSq) {
				bestDistSq = distSq;
				best = candidate;
			}
		}

		if (!best) {
			return;
		}

		if (!this.spawner.claimCreature(best.sprite)) {
			return;
		}

		const weight = best.definition.weight;
		if (
			!this.hook.beginRetractingWithCatch(weight, {
				creatureId: best.definition.id,
				category: best.definition.category,
				weight,
			})
		) {
			this.spawner.destroyClaimedCreature(best.sprite);
			return;
		}

		this.caught = best;
		this.delivered = false;
		best.sprite.setDepth(CAUGHT_DEPTH);
	}

	private attachCaught(): void {
		const caught = this.caught;
		if (!caught || !caught.sprite.active) {
			return;
		}
		const hookPos = this.hook.hookAttachWorldPosition;
		caught.sprite.setPosition(hookPos.x, hookPos.y);
	}

	private handleRetractComplete(): void {
		if (this.destroyed || this.delivered || !this.caught) {
			return;
		}

		const { sprite, definition } = this.caught;
		const payload: CreatureDeliveredPayload = {
			id: definition.id,
			category: definition.category,
			value: Number(sprite.getData("value") ?? 0),
			weight: definition.weight,
			isToxic: definition.isToxic,
		};

		this.delivered = true;
		this.caught = undefined;
		this.spawner.destroyClaimedCreature(sprite);
		this.scene.events.emit(CREATURE_DELIVERED_EVENT, payload);
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
		for (const candidate of this.spawner.getCatchableCreatures()) {
			const bounds = candidate.sprite.getBounds();
			graphics.strokeRect(
				bounds.x,
				bounds.y,
				bounds.width,
				bounds.height,
			);
		}
	}
}
