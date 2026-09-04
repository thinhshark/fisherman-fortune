import Phaser from "phaser";
import {
	CREATURE_DELIVERED_EVENT,
	ITEM_DELIVERED_EVENT,
	type CreatureDeliveredPayload,
	type ItemDeliveredPayload,
} from "./CatchController";
import type { CreatureCategory } from "./CreatureCatalog";
import { getCreatureBalance } from "./config/CreatureBalance";
import { getItemBalance } from "./config/ItemBalance";
import type { ItemEffectType } from "./ItemCatalog";

export const SCORE_CHANGED_EVENT = "score-changed";
export const TIME_CHANGED_EVENT = "time-changed";
export const TIME_BONUS_EVENT = "time-bonus";
export const BONUS_COLLECTED_EVENT = "bonus-collected";
export const GAME_FINISHED_EVENT = "game-finished";

export type GameSessionState = "playing" | "finished";

export interface ScoreChangedPayload {
	totalScore: number;
	delta: number;
	creatureId?: string;
	category?: CreatureCategory;
	itemId?: string;
	effectType?: ItemEffectType;
}

export interface TimeChangedPayload {
	remainingSeconds: number;
}

export interface TimeBonusPayload {
	seconds: number;
	remainingSeconds: number;
	itemId: string;
}

export interface BonusCollectedPayload {
	itemId: string;
	effectType: ItemEffectType;
}

export interface GameFinishedPayload {
	finalScore: number;
}

export interface GameSessionOptions {
	/** Boat / hook anchor for floating delivery feedback. */
	feedbackAnchor?: Readonly<{ x: number; y: number }>;
}

/**
 * Round session: score + countdown. Does not stop gameplay when finished;
 * only emits game-finished once and clamps the timer at zero.
 */
export class GameSession {
	static readonly DURATION_SECONDS = 100;

	private readonly scene: Phaser.Scene;
	private readonly feedbackAnchor: { x: number; y: number };
	private readonly boundCreatureDelivered =
		this.handleCreatureDelivered.bind(this);
	private readonly boundItemDelivered = this.handleItemDelivered.bind(this);

	private _score = 0;
	private remainingMs = GameSession.DURATION_SECONDS * 1000;
	private lastEmittedSeconds = GameSession.DURATION_SECONDS;
	private _state: GameSessionState = "playing";
	private destroyed = false;
	private finishedEmitted = false;

	constructor(scene: Phaser.Scene, options?: GameSessionOptions) {
		this.scene = scene;
		this.feedbackAnchor = {
			x: options?.feedbackAnchor?.x ?? scene.scale.width * 0.5,
			y: options?.feedbackAnchor?.y ?? 280,
		};
		scene.events.on(CREATURE_DELIVERED_EVENT, this.boundCreatureDelivered);
		scene.events.on(ITEM_DELIVERED_EVENT, this.boundItemDelivered);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get score(): number {
		return this._score;
	}

	get remainingSeconds(): number {
		if (this.remainingMs <= 0) {
			return 0;
		}
		return Math.ceil(this.remainingMs / 1000);
	}

	get isFinished(): boolean {
		return this._state === "finished";
	}

	get state(): GameSessionState {
		return this._state;
	}

	/**
	 * Add bonus seconds to the countdown. Rejects invalid / negative / NaN.
	 * Updates the displayed whole second immediately.
	 */
	addTime(seconds: number): void {
		if (this.destroyed) {
			return;
		}
		if (
			typeof seconds !== "number" ||
			!Number.isFinite(seconds) ||
			seconds <= 0
		) {
			return;
		}

		this.remainingMs += seconds * 1000;
		const displayed = this.remainingSeconds;
		this.lastEmittedSeconds = displayed;
		this.scene.events.emit(TIME_CHANGED_EVENT, {
			remainingSeconds: displayed,
		} satisfies TimeChangedPayload);
	}

	update(_time: number, delta: number): void {
		if (this.destroyed || this._state !== "playing") {
			return;
		}

		this.remainingMs = Math.max(0, this.remainingMs - delta);
		const displayed = this.remainingSeconds;
		if (displayed !== this.lastEmittedSeconds) {
			this.lastEmittedSeconds = displayed;
			this.scene.events.emit(TIME_CHANGED_EVENT, {
				remainingSeconds: displayed,
			} satisfies TimeChangedPayload);
		}

		if (this.remainingMs <= 0) {
			this._state = "finished";
			this.remainingMs = 0;
			if (this.lastEmittedSeconds !== 0) {
				this.lastEmittedSeconds = 0;
				this.scene.events.emit(TIME_CHANGED_EVENT, {
					remainingSeconds: 0,
				} satisfies TimeChangedPayload);
			}
			this.emitFinishedOnce();
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.scene.events.off(
			CREATURE_DELIVERED_EVENT,
			this.boundCreatureDelivered,
		);
		this.scene.events.off(ITEM_DELIVERED_EVENT, this.boundItemDelivered);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private handleCreatureDelivered(payload: CreatureDeliveredPayload): void {
		if (this.destroyed) {
			return;
		}

		const balance = getCreatureBalance(payload.id);
		if (!balance) {
			throw new Error(
				`No CreatureBalance entry for delivered creature: ${payload.id}`,
			);
		}

		const roll = Phaser.Math.Between(balance.rewardMin, balance.rewardMax);
		const delta =
			balance.rewardOperation === "subtract" ? -roll : roll;

		this.applyScoreDelta(delta, {
			creatureId: payload.id,
			category: payload.category,
		});
	}

	private handleItemDelivered(payload: ItemDeliveredPayload): void {
		if (this.destroyed) {
			return;
		}

		const balance = getItemBalance(payload.id);
		if (!balance) {
			throw new Error(
				`No ItemBalance entry for delivered item: ${payload.id}`,
			);
		}

		switch (balance.effectType) {
			case "scrap":
			case "gem":
			case "valuable": {
				const roll = Phaser.Math.Between(
					balance.rewardMin,
					balance.rewardMax,
				);
				const delta =
					balance.rewardOperation === "subtract" ? -roll : roll;
				this.applyScoreDelta(delta, {
					itemId: payload.id,
					effectType: balance.effectType,
				});
				break;
			}
			case "time": {
				const bonus = balance.timeBonusSeconds;
				this.addTime(bonus);
				this.scene.events.emit(TIME_BONUS_EVENT, {
					seconds: bonus,
					remainingSeconds: this.remainingSeconds,
					itemId: payload.id,
				} satisfies TimeBonusPayload);
				this.spawnFloatingFeedback(`+${bonus}s`, "#ffe566");
				break;
			}
			case "bomb":
			case "power": {
				// PENDING: bomb / power gameplay not implemented yet.
				this.scene.events.emit(BONUS_COLLECTED_EVENT, {
					itemId: payload.id,
					effectType: balance.effectType,
				} satisfies BonusCollectedPayload);
				break;
			}
			default: {
				const invalid: never = balance.effectType;
				throw new Error(
					`Unhandled item effectType: ${String(invalid)}`,
				);
			}
		}
	}

	private applyScoreDelta(
		delta: number,
		meta: {
			creatureId?: string;
			category?: CreatureCategory;
			itemId?: string;
			effectType?: ItemEffectType;
		},
	): void {
		this._score = Math.max(0, this._score + delta);
		this.scene.events.emit(SCORE_CHANGED_EVENT, {
			totalScore: this._score,
			delta,
			creatureId: meta.creatureId,
			category: meta.category,
			itemId: meta.itemId,
			effectType: meta.effectType,
		} satisfies ScoreChangedPayload);

		if (delta !== 0) {
			const label = delta > 0 ? `+${delta}` : `${delta}`;
			const color = delta > 0 ? "#5dff7a" : "#ff5d5d";
			this.spawnFloatingFeedback(label, color);
		}
	}

	/**
	 * Brief floating label near the boat (below HUD). Rise ~45px, fade ~700ms.
	 */
	private spawnFloatingFeedback(text: string, color: string): void {
		if (this.destroyed) {
			return;
		}

		const startY = this.feedbackAnchor.y + 36;
		const label = this.scene.add
			.text(this.feedbackAnchor.x, startY, text, {
				fontFamily: "Luckiest Guy",
				fontSize: "28px",
				color,
				stroke: "#1a1208",
				strokeThickness: 5,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setDepth(900)
			.setScrollFactor(0);

		this.scene.tweens.add({
			targets: label,
			y: startY - 45,
			alpha: 0,
			duration: 700,
			ease: "Cubic.easeOut",
			onComplete: () => {
				label.destroy();
			},
		});
	}

	private emitFinishedOnce(): void {
		if (this.finishedEmitted) {
			return;
		}
		this.finishedEmitted = true;
		this.scene.events.emit(GAME_FINISHED_EVENT, {
			finalScore: this._score,
		} satisfies GameFinishedPayload);
	}
}
