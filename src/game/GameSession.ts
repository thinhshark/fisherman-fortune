import Phaser from "phaser";
import {
	CREATURE_DELIVERED_EVENT,
	type CreatureDeliveredPayload,
} from "./CatchController";
import type { CreatureCategory } from "./CreatureCatalog";
import { getCreatureBalance } from "./config/CreatureBalance";

export const SCORE_CHANGED_EVENT = "score-changed";
export const TIME_CHANGED_EVENT = "time-changed";
export const GAME_FINISHED_EVENT = "game-finished";

export type GameSessionState = "playing" | "finished";

export interface ScoreChangedPayload {
	totalScore: number;
	delta: number;
	creatureId: string;
	category: CreatureCategory;
}

export interface TimeChangedPayload {
	remainingSeconds: number;
}

export interface GameFinishedPayload {
	finalScore: number;
}

/**
 * Round session: score + countdown. Does not stop gameplay when finished;
 * only emits game-finished once and clamps the timer at zero.
 */
export class GameSession {
	static readonly DURATION_SECONDS = 100;

	private readonly scene: Phaser.Scene;
	private readonly boundDelivered = this.handleCreatureDelivered.bind(this);

	private _score = 0;
	private remainingMs = GameSession.DURATION_SECONDS * 1000;
	private lastEmittedSeconds = GameSession.DURATION_SECONDS;
	private _state: GameSessionState = "playing";
	private destroyed = false;
	private finishedEmitted = false;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		scene.events.on(CREATURE_DELIVERED_EVENT, this.boundDelivered);
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
		this.scene.events.off(CREATURE_DELIVERED_EVENT, this.boundDelivered);
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

		this._score = Math.max(0, this._score + delta);

		this.scene.events.emit(SCORE_CHANGED_EVENT, {
			totalScore: this._score,
			delta,
			creatureId: payload.id,
			category: payload.category,
		} satisfies ScoreChangedPayload);
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
