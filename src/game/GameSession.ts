import Phaser from "phaser";
import {
	CREATURE_DELIVERED_EVENT,
	ITEM_DELIVERED_EVENT,
	type CreatureDeliveredPayload,
	type ItemDeliveredPayload,
} from "./CatchController";
import type { CreatureCategory } from "./CreatureCatalog";
import { getCreatureBalance } from "./config/CreatureBalance";
import {
	getItemBalance,
	pickGiftOutcome,
	type ItemBalanceEntry,
} from "./config/ItemBalance";
import type { ItemEffectType } from "./ItemCatalog";
import {
	BARREL_EXPLODED_EVENT,
	type BarrelExplodedPayload,
} from "./ItemSpawner";

export const SCORE_CHANGED_EVENT = "score-changed";
export const TIME_CHANGED_EVENT = "time-changed";
export const TIME_BONUS_EVENT = "time-bonus";
export const BONUS_COLLECTED_EVENT = "bonus-collected";
/** Home → Play; gameplay systems become active. */
export const GAMEPLAY_STARTED_EVENT = "gameplay-started";
/** Timer hit zero; systems freeze then result shows immediately. */
export const GAME_ENDING_EVENT = "game-ending";
/** Round over; show result overlay (no grace retract). */
export const GAME_FINISHED_EVENT = "game-finished";

export type GameSessionState = "ready" | "playing" | "ending" | "finished";
export type ScoreSourceKind = "creature" | "item";

export interface ScoreChangedPayload {
	totalScore: number;
	delta: number;
	sourceKind: ScoreSourceKind;
	/** Creature or item id. */
	sourceId: string;
	category?: CreatureCategory;
	effectType?: ItemEffectType;
	deliveryX: number;
	deliveryY: number;
}

export interface TimeChangedPayload {
	remainingSeconds: number;
}

export interface TimeBonusPayload {
	secondsAdded: number;
	sourceId: string;
	deliveryX: number;
	deliveryY: number;
	remainingSeconds: number;
}

export interface BonusCollectedPayload {
	itemId: string;
	effectType: ItemEffectType;
	deliveryX: number;
	deliveryY: number;
}

export interface GameFinishedPayload {
	finalScore: number;
	gameSessionId: string;
}

export interface GameplayStartedPayload {
	gameSessionId: string;
	durationSeconds: number;
}

/**
 * Round session: score + countdown.
 * Floating reward / time text is owned exclusively by CatchFeedbackController.
 *
 * States: ready → playing → ending (timer 0, brief) → finished (immediate cut).
 * Undelivered catches do not score after the timer hits zero.
 */
export class GameSession {
	static readonly DURATION_SECONDS = 100;

	private readonly scene: Phaser.Scene;
	private readonly boundCreatureDelivered =
		this.handleCreatureDelivered.bind(this);
	private readonly boundItemDelivered = this.handleItemDelivered.bind(this);
	private readonly boundBarrelExploded =
		this.handleBarrelExploded.bind(this);

	private _score = 0;
	private remainingMs = GameSession.DURATION_SECONDS * 1000;
	private lastEmittedSeconds = GameSession.DURATION_SECONDS;
	private _state: GameSessionState = "ready";
	private paused = false;
	private destroyed = false;
	private finishedEmitted = false;
	private endingEmitted = false;
	private startedEmitted = false;
	private readonly _gameSessionId: string;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		this._gameSessionId = createGameSessionId();
		scene.events.on(CREATURE_DELIVERED_EVENT, this.boundCreatureDelivered);
		scene.events.on(ITEM_DELIVERED_EVENT, this.boundItemDelivered);
		scene.events.on(BARREL_EXPLODED_EVENT, this.boundBarrelExploded);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get score(): number {
		return this._score;
	}

	/** Unique id for this Level round (new on each scene create / restart). */
	get gameSessionId(): string {
		return this._gameSessionId;
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

	get isEnding(): boolean {
		return this._state === "ending";
	}

	get isReady(): boolean {
		return this._state === "ready";
	}

	get isPlaying(): boolean {
		return this._state === "playing";
	}

	get state(): GameSessionState {
		return this._state;
	}

	get isPaused(): boolean {
		return this.paused;
	}

	/**
	 * Freeze the countdown without changing playing/ending/finished state.
	 * Does not call scene.pause() — overlay stays interactive in the same scene.
	 */
	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
	}

	/**
	 * Transition ready → playing and emit gameplay-started once.
	 * No-op if already started or destroyed.
	 */
	startGame(): boolean {
		if (this.destroyed || this._state !== "ready" || this.startedEmitted) {
			return false;
		}
		this._state = "playing";
		this.startedEmitted = true;
		this.scene.events.emit(GAMEPLAY_STARTED_EVENT, {
			gameSessionId: this._gameSessionId,
			durationSeconds: GameSession.DURATION_SECONDS,
		} satisfies GameplayStartedPayload);
		return true;
	}

	/**
	 * Add bonus seconds to the countdown. Rejects invalid / negative / NaN.
	 * Only applies while playing (not during ending/finished grace).
	 */
	addTime(seconds: number): void {
		if (this.destroyed || this._state !== "playing") {
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

	/**
	 * Transitions ending → finished and emits game-finished once.
	 * Called immediately when the timer hits zero (no retract grace).
	 */
	completeEnding(): void {
		if (this.destroyed || this._state !== "ending") {
			return;
		}
		this._state = "finished";
		this.emitFinishedOnce();
	}

	update(_time: number, delta: number): void {
		if (this.destroyed || this._state !== "playing" || this.paused) {
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
			this.remainingMs = 0;
			if (this.lastEmittedSeconds !== 0) {
				this.lastEmittedSeconds = 0;
				this.scene.events.emit(TIME_CHANGED_EVENT, {
					remainingSeconds: 0,
				} satisfies TimeChangedPayload);
			}
			this.beginEnding();
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
		this.scene.events.off(BARREL_EXPLODED_EVENT, this.boundBarrelExploded);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private beginEnding(): void {
		if (this._state !== "playing") {
			return;
		}
		this._state = "ending";
		if (!this.endingEmitted) {
			this.endingEmitted = true;
			this.scene.events.emit(GAME_ENDING_EVENT, {
				finalScore: this._score,
			});
		}
		// Cut immediately — no waiting for hook retract / boat delivery.
		this.completeEnding();
	}

	private handleCreatureDelivered(payload: CreatureDeliveredPayload): void {
		if (this.destroyed || this._state !== "playing") {
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

		this._score = Math.max(0, this._score + delta);
		this.scene.events.emit(SCORE_CHANGED_EVENT, {
			totalScore: this._score,
			delta,
			sourceKind: "creature",
			sourceId: payload.id,
			category: payload.category,
			deliveryX: payload.deliveryX,
			deliveryY: payload.deliveryY,
		} satisfies ScoreChangedPayload);
	}

	private handleItemDelivered(payload: ItemDeliveredPayload): void {
		if (this.destroyed || this._state !== "playing") {
			return;
		}

		const balance = getItemBalance(payload.id);
		if (!balance) {
			throw new Error(
				`No ItemBalance entry for delivered item: ${payload.id}`,
			);
		}

		switch (balance.rewardType) {
			case "score": {
				const delta = balance.scoreValue;
				if (delta === 0) {
					break;
				}
				this._score = Math.max(0, this._score + delta);
				this.scene.events.emit(SCORE_CHANGED_EVENT, {
					totalScore: this._score,
					delta,
					sourceKind: "item",
					sourceId: payload.id,
					effectType: balance.effectType,
					deliveryX: payload.deliveryX,
					deliveryY: payload.deliveryY,
				} satisfies ScoreChangedPayload);
				break;
			}
			case "time": {
				const bonus = balance.timeValue;
				this.addTime(bonus);
				this.scene.events.emit(TIME_BONUS_EVENT, {
					secondsAdded: bonus,
					sourceId: payload.id,
					deliveryX: payload.deliveryX,
					deliveryY: payload.deliveryY,
					remainingSeconds: this.remainingSeconds,
				} satisfies TimeBonusPayload);
				break;
			}
			case "gift": {
				this.applyGiftReward(balance, payload);
				break;
			}
			case "bomb":
			case "none": {
				break;
			}
			default: {
				const invalid: never = balance.rewardType;
				throw new Error(
					`Unhandled item rewardType: ${String(invalid)}`,
				);
			}
		}
	}

	/** Barrel detonates on catch (not delivery); apply score penalty here. */
	private handleBarrelExploded(payload: BarrelExplodedPayload): void {
		if (this.destroyed || this._state !== "playing") {
			return;
		}

		const balance = getItemBalance(payload.sourceId);
		if (!balance || balance.rewardType !== "bomb") {
			return;
		}

		const delta = balance.scoreValue;
		if (delta === 0) {
			return;
		}

		this._score = Math.max(0, this._score + delta);
		this.scene.events.emit(SCORE_CHANGED_EVENT, {
			totalScore: this._score,
			delta,
			sourceKind: "item",
			sourceId: payload.sourceId,
			effectType: balance.effectType,
			deliveryX: payload.x,
			deliveryY: payload.y,
		} satisfies ScoreChangedPayload);
	}

	private applyGiftReward(
		balance: ItemBalanceEntry,
		payload: ItemDeliveredPayload,
	): void {
		if (balance.giftVoucherEnabled) {
			return;
		}
		const outcome = pickGiftOutcome(balance, Math.random, (min, max) =>
			Phaser.Math.Between(min, max),
		);
		if (outcome.kind === "money") {
			this._score = Math.max(0, this._score + outcome.amount);
			this.scene.events.emit(SCORE_CHANGED_EVENT, {
				totalScore: this._score,
				delta: outcome.amount,
				sourceKind: "item",
				sourceId: payload.id,
				effectType: "gift",
				deliveryX: payload.deliveryX,
				deliveryY: payload.deliveryY,
			} satisfies ScoreChangedPayload);
			return;
		}
		this.addTime(outcome.seconds);
		this.scene.events.emit(TIME_BONUS_EVENT, {
			secondsAdded: outcome.seconds,
			sourceId: payload.id,
			deliveryX: payload.deliveryX,
			deliveryY: payload.deliveryY,
			remainingSeconds: this.remainingSeconds,
		} satisfies TimeBonusPayload);
	}

	private emitFinishedOnce(): void {
		if (this.finishedEmitted) {
			return;
		}
		this.finishedEmitted = true;
		this.scene.events.emit(GAME_FINISHED_EVENT, {
			finalScore: this._score,
			gameSessionId: this._gameSessionId,
		} satisfies GameFinishedPayload);
	}
}

function createGameSessionId(): string {
	try {
		const cryptoObj = globalThis.crypto as
			| { randomUUID?: () => string }
			| undefined;
		if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
			return cryptoObj.randomUUID();
		}
	} catch {
		/* fall through */
	}
	return `ff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
