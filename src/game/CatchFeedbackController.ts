import Phaser from "phaser";
import {
	BOMB_GAINED_EVENT,
	SCORE_CHANGED_EVENT,
	TIME_BONUS_EVENT,
	type BombGainedPayload,
	type ScoreChangedPayload,
	type TimeBonusPayload,
} from "./GameSession";

const FEEDBACK_DEPTH = 50;
const FONT_FAMILY = "Luckiest Guy";
const FONT_SIZE_PX = 30;
const MONEY_POSITIVE_COLOR = "#ffe36e";
const MONEY_NEGATIVE_COLOR = "#ff5a5a";
const TIME_COLOR = "#71eaff";
const BOMB_COLOR = "#ffb347";
const STROKE_COLOR = "#3b210f";
const STROKE_THICKNESS = 6;
/** Keep below top HUD panels (~20 margin + ~108 panel height). */
const MIN_WORLD_Y = 150;
const EDGE_PAD_PX = 35;
const BOMB_FEEDBACK_ICON_SCALE = 0.42;
const BOMB_FEEDBACK_GAP = 6;

const POP_MS = 180;
const HOLD_MS = 520;
const FADE_MS = 900;

/** Floating money text: +300$ / -25$ (dollar after the number). */
export function formatMoneyFeedback(delta: number): string {
	const amount = Math.abs(delta);
	return delta >= 0 ? `+${amount}` : `-${amount}`;
}

/**
 * World-space floating reward / time text at any catchable target's
 * disappearance point (fish, jelly, crab, scrap, gems, star, etc.).
 */
export class CatchFeedbackController {
	private readonly scene: Phaser.Scene;
	private readonly boundScoreChanged = this.handleScoreChanged.bind(this);
	private readonly boundTimeBonus = this.handleTimeBonus.bind(this);
	private readonly boundBombGained = this.handleBombGained.bind(this);
	private readonly activeLabels = new Set<Phaser.GameObjects.GameObject>();
	private readonly activeChains = new Set<Phaser.Tweens.TweenChain>();
	private destroyed = false;
	private paused = false;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		scene.events.on(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		scene.events.on(TIME_BONUS_EVENT, this.boundTimeBonus);
		scene.events.on(BOMB_GAINED_EVENT, this.boundBombGained);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	/**
	 * Pause active reward-feedback tweens in place; resume from existing progress.
	 * Does not destroy or restart chains.
	 */
	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
		for (const chain of this.activeChains) {
			if (paused) {
				chain.pause();
			} else {
				chain.resume();
			}
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.scene.events.off(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		this.scene.events.off(TIME_BONUS_EVENT, this.boundTimeBonus);
		this.scene.events.off(BOMB_GAINED_EVENT, this.boundBombGained);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);

		for (const chain of Array.from(this.activeChains)) {
			chain.destroy();
		}
		this.activeChains.clear();

		for (const label of Array.from(this.activeLabels)) {
			this.scene.tweens.killTweensOf(label);
			label.destroy();
		}
		this.activeLabels.clear();
	}

	private handleScoreChanged(payload: ScoreChangedPayload): void {
		if (this.destroyed) {
			return;
		}
		if (payload.delta === 0) {
			return;
		}
		if (!this.hasValidDelivery(payload.deliveryX, payload.deliveryY)) {
			return;
		}

		const text = formatMoneyFeedback(payload.delta);
		const color =
			payload.delta > 0 ? MONEY_POSITIVE_COLOR : MONEY_NEGATIVE_COLOR;

		this.spawnTextFeedback(text, color, payload.deliveryX, payload.deliveryY);
	}

	private handleTimeBonus(payload: TimeBonusPayload): void {
		if (this.destroyed) {
			return;
		}
		if (
			typeof payload.secondsAdded !== "number" ||
			!Number.isFinite(payload.secondsAdded) ||
			payload.secondsAdded <= 0
		) {
			return;
		}
		if (!this.hasValidDelivery(payload.deliveryX, payload.deliveryY)) {
			return;
		}

		this.spawnTextFeedback(
			`+${payload.secondsAdded}`,
			TIME_COLOR,
			payload.deliveryX,
			payload.deliveryY,
		);
	}

	private handleBombGained(payload: BombGainedPayload): void {
		if (this.destroyed) {
			return;
		}
		if (
			typeof payload.delta !== "number" ||
			!Number.isFinite(payload.delta) ||
			payload.delta <= 0
		) {
			return;
		}
		if (!this.hasValidDelivery(payload.deliveryX, payload.deliveryY)) {
			return;
		}

		this.spawnBombFeedback(payload.deliveryX, payload.deliveryY);
	}

	private hasValidDelivery(x: number, y: number): boolean {
		return (
			typeof x === "number" &&
			typeof y === "number" &&
			Number.isFinite(x) &&
			Number.isFinite(y)
		);
	}

	private spawnTextFeedback(
		text: string,
		color: string,
		deliveryX: number,
		deliveryY: number,
	): void {
		const { x, y } = this.clampDelivery(deliveryX, deliveryY);

		const label = this.scene.add
			.text(x, y, text, {
				fontFamily: FONT_FAMILY,
				fontSize: `${FONT_SIZE_PX}px`,
				color,
				stroke: STROKE_COLOR,
				strokeThickness: STROKE_THICKNESS,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setDepth(FEEDBACK_DEPTH)
			.setScale(0.7)
			.setAlpha(1);

		this.playFeedbackTween(label, y);
	}

	/** Floating "+ [bomb-button]" when Bag grants a bomb. */
	private spawnBombFeedback(deliveryX: number, deliveryY: number): void {
		const { x, y } = this.clampDelivery(deliveryX, deliveryY);

		const plus = this.scene.add
			.text(0, 0, "+", {
				fontFamily: FONT_FAMILY,
				fontSize: `${FONT_SIZE_PX}px`,
				color: BOMB_COLOR,
				stroke: STROKE_COLOR,
				strokeThickness: STROKE_THICKNESS,
			})
			.setOrigin(1, 0.5);

		const iconKey = this.scene.textures.exists("bomb-button")
			? "bomb-button"
			: "bonus-bomb";
		const icon = this.scene.add
			.image(0, 0, iconKey)
			.setOrigin(0, 0.5)
			.setScale(BOMB_FEEDBACK_ICON_SCALE);

		plus.setPosition(-BOMB_FEEDBACK_GAP * 0.5, 0);
		icon.setPosition(BOMB_FEEDBACK_GAP * 0.5, 0);

		const root = this.scene.add.container(x, y, [plus, icon]);
		root.setDepth(FEEDBACK_DEPTH);
		root.setScale(0.7);
		root.setAlpha(1);

		this.playFeedbackTween(root, y);
	}

	private playFeedbackTween(
		target: Phaser.GameObjects.Text | Phaser.GameObjects.Container,
		baseY: number,
	): void {
		this.activeLabels.add(target);

		const chain = this.scene.tweens.chain({
			targets: target,
			tweens: [
				{
					scale: 1.1,
					duration: POP_MS,
					ease: "Back.easeOut",
				},
				{
					y: baseY - 8,
					duration: HOLD_MS,
					ease: "Linear",
				},
				{
					y: baseY - 8 - 60,
					scale: 0.95,
					alpha: 0,
					duration: FADE_MS,
					ease: "Cubic.easeOut",
				},
			],
			onComplete: () => {
				this.activeChains.delete(chain);
				this.activeLabels.delete(target);
				target.destroy();
			},
		});

		this.activeChains.add(chain);
		if (this.paused) {
			chain.pause();
		}
	}

	private clampDelivery(
		deliveryX: number,
		deliveryY: number,
	): { x: number; y: number } {
		const x = Phaser.Math.Clamp(
			deliveryX,
			EDGE_PAD_PX,
			this.scene.scale.width - EDGE_PAD_PX,
		);
		const y = Phaser.Math.Clamp(
			Math.max(deliveryY, MIN_WORLD_Y),
			EDGE_PAD_PX,
			this.scene.scale.height - EDGE_PAD_PX,
		);
		return { x, y };
	}
}
