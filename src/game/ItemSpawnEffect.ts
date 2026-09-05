import Phaser from "phaser";
import type { ItemGameObject } from "./ItemSpawner";

/** Entrance pop duration (ms). */
const ENTRANCE_MS = 400;
/** Ripple expand/fade duration (ms). */
const RIPPLE_MS = 520;
/** Start scale as a fraction of configured base scale. */
const START_SCALE_FRAC = 0.5;
/** Start above final Y (logical pixels). */
const START_Y_OFFSET_PX = 8;
/** Catchable once alpha reaches this during the entrance. */
const CATCHABLE_ALPHA = 0.55;
const RIPPLE_COLOR = 0xffffff;
const RIPPLE_START_RADIUS = 6;
const RIPPLE_END_RADIUS = 38;
const RIPPLE_DEPTH_OFFSET = -1;

/**
 * One-shot spawn entrance for stationary items (not creatures).
 * Owns the item tween + temporary ripple Graphics; cleans up on complete/destroy.
 */
export class ItemSpawnEffect {
	private readonly object: ItemGameObject;
	private readonly baseScale: number;
	private readonly finalY: number;
	private readonly ripple: Phaser.GameObjects.Graphics;
	private itemTween?: Phaser.Tweens.Tween;
	private rippleTween?: Phaser.Tweens.Tween;
	private destroyed = false;
	private catchable = false;

	constructor(
		scene: Phaser.Scene,
		object: ItemGameObject,
		baseScale: number,
		finalY: number,
		private readonly onEntranceComplete?: () => void,
	) {
		this.object = object;
		this.baseScale = baseScale;
		this.finalY = finalY;

		object.setAlpha(0);
		object.setScale(baseScale * START_SCALE_FRAC);
		object.setY(finalY - START_Y_OFFSET_PX);
		object.setData("spawnEntranceActive", true);
		object.setData("spawnCatchable", false);

		this.ripple = scene.add.graphics();
		this.ripple.setDepth(object.depth + RIPPLE_DEPTH_OFFSET);
		this.ripple.setPosition(object.x, finalY);
		this.ripple.setName(`item-spawn-ripple-${object.name}`);
		this.drawRipple(RIPPLE_START_RADIUS, 0.55);

		this.itemTween = scene.tweens.add({
			targets: object,
			alpha: 1,
			scale: baseScale,
			y: finalY,
			duration: ENTRANCE_MS,
			ease: "Back.easeOut",
			onUpdate: () => {
				if (this.destroyed) {
					return;
				}
				if (!this.catchable && object.alpha >= CATCHABLE_ALPHA) {
					this.catchable = true;
					object.setData("spawnCatchable", true);
				}
			},
			onComplete: () => {
				if (this.destroyed) {
					return;
				}
				object.setAlpha(1);
				object.setScale(baseScale);
				object.setY(finalY);
				object.setData("spawnEntranceActive", false);
				object.setData("spawnCatchable", true);
				this.catchable = true;
				this.itemTween = undefined;
				this.onEntranceComplete?.();
			},
		});

		const rippleState = { radius: RIPPLE_START_RADIUS, alpha: 0.55 };
		this.rippleTween = scene.tweens.add({
			targets: rippleState,
			radius: RIPPLE_END_RADIUS,
			alpha: 0,
			duration: RIPPLE_MS,
			ease: "Cubic.easeOut",
			onUpdate: () => {
				if (this.destroyed) {
					return;
				}
				this.drawRipple(rippleState.radius, rippleState.alpha);
			},
			onComplete: () => {
				this.rippleTween = undefined;
				this.destroyRippleOnly();
			},
		});
	}

	get isCatchable(): boolean {
		return this.catchable;
	}

	setPaused(paused: boolean): void {
		if (this.destroyed) {
			return;
		}
		if (paused) {
			this.itemTween?.pause();
			this.rippleTween?.pause();
		} else {
			this.itemTween?.resume();
			this.rippleTween?.resume();
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		if (this.itemTween) {
			this.itemTween.stop();
			this.itemTween = undefined;
		}
		if (this.rippleTween) {
			this.rippleTween.stop();
			this.rippleTween = undefined;
		}
		this.destroyRippleOnly();
		if (this.object.active) {
			this.object.setAlpha(1);
			this.object.setScale(this.baseScale);
			this.object.setY(this.finalY);
			this.object.setData("spawnEntranceActive", false);
			this.object.setData("spawnCatchable", true);
		}
	}

	private destroyRippleOnly(): void {
		if (!this.ripple.scene) {
			return;
		}
		this.ripple.destroy();
	}

	private drawRipple(radius: number, alpha: number): void {
		this.ripple.clear();
		if (alpha <= 0.01 || radius <= 0) {
			return;
		}
		this.ripple.lineStyle(2.5, RIPPLE_COLOR, alpha);
		this.ripple.strokeCircle(0, 0, radius);
	}
}
