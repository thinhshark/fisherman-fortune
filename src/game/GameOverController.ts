import Phaser from "phaser";
import {
	GAME_FINISHED_EVENT,
	GameSession,
	type GameFinishedPayload,
} from "./GameSession";
import type { AudioController } from "./AudioController";
import { FlutterGameBridge } from "./FlutterGameBridge";
import { ScoreStorage } from "./ScoreStorage";

const OVERLAY_DEPTH = 2000;
const OVERLAY_ALPHA = 0.72;
const TITLE_SCALE = 0.55;
const BUTTON_SCALE = 1.15;
const SCORE_BASE_PX = 52;
const SCORE_MIN_PX = 28;
const BEST_LABEL_PX = 22;
const BEST_VALUE_PX = 32;
const NEW_BEST_PX = 28;
const SCORE_MAX_WIDTH_FRAC = 0.55;
const FONT_FAMILY = "Luckiest Guy";

function formatScoreDollars(score: number): string {
	return `${Math.max(0, Math.floor(score))}$`;
}

/**
 * End-of-round result overlay: darken screen, show final + best score, restart.
 * Persists anonymous local scores and notifies the Flutter host bridge.
 * Menu / local leaderboard are omitted (Flutter owns the real leaderboard).
 */
export class GameOverController {
	private readonly scene: Phaser.Scene;
	private readonly audio?: AudioController;
	private readonly boundFinished = this.handleGameFinished.bind(this);
	private readonly boundResize = this.layout.bind(this);
	private readonly boundRestart = this.handleRestart.bind(this);

	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private title?: Phaser.GameObjects.Image;
	private scoreText?: Phaser.GameObjects.Text;
	private bestLabelText?: Phaser.GameObjects.Text;
	private bestValueText?: Phaser.GameObjects.Text;
	private newBestText?: Phaser.GameObjects.Text;
	private restartButton?: Phaser.GameObjects.Image;

	private destroyed = false;
	private visible = false;
	private restartArmed = false;
	private persisted = false;
	private finalScore = 0;
	private bestScore = 0;
	private isNewBest = false;
	private gameSessionId = "";

	constructor(scene: Phaser.Scene, audio?: AudioController) {
		this.scene = scene;
		this.audio = audio;
		scene.events.on(GAME_FINISHED_EVENT, this.boundFinished);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.scene.events.off(GAME_FINISHED_EVENT, this.boundFinished);
		this.scene.scale.off("resize", this.boundResize);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
		this.teardownUi();
	}

	private handleGameFinished(payload: GameFinishedPayload): void {
		if (this.destroyed || this.visible) {
			return;
		}
		this.visible = true;
		this.restartArmed = true;
		this.finalScore = payload.finalScore;
		this.gameSessionId = payload.gameSessionId;
		this.persistAndNotifyOnce(payload);
		this.audio?.playResultGameOver();
		this.buildUi();
		this.layout();
		this.scene.scale.on("resize", this.boundResize);
	}

	/**
	 * Save local last/best score and emit GAME_FINISHED to Flutter exactly once.
	 */
	private persistAndNotifyOnce(payload: GameFinishedPayload): void {
		if (this.persisted) {
			return;
		}
		this.persisted = true;

		const result = ScoreStorage.saveFinalScore(
			payload.finalScore,
			payload.gameSessionId,
		);
		this.bestScore = result.bestScore;
		this.isNewBest = result.isNewBest;

		FlutterGameBridge.sendGameFinished({
			gameSessionId: payload.gameSessionId,
			score: payload.finalScore,
			durationSeconds: GameSession.DURATION_SECONDS,
		});
	}

	private buildUi(): void {
		if (!this.scene.textures.exists("black-screen")) {
			throw new Error('GameOverController requires texture "black-screen"');
		}
		if (!this.scene.textures.exists("text-your-score")) {
			throw new Error(
				'GameOverController requires texture "text-your-score"',
			);
		}
		if (!this.scene.textures.exists("restart-001")) {
			throw new Error('GameOverController requires texture "restart-001"');
		}

		this.overlay = this.scene.add
			.image(0, 0, "black-screen")
			.setOrigin(0.5, 0.5)
			.setAlpha(OVERLAY_ALPHA)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH)
			.setName("gameOverOverlay");

		// Invisible full-screen blocker so pointer events don't reach gameplay.
		this.blocker = this.scene.add
			.rectangle(0, 0, 10, 10, 0x000000, 0.001)
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 1)
			.setInteractive()
			.setName("gameOverBlocker");

		this.title = this.scene.add
			.image(0, 0, "text-your-score")
			.setOrigin(0.5, 0.5)
			.setScale(TITLE_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 2)
			.setName("gameOverTitle");

		this.scoreText = this.scene.add
			.text(0, 0, formatScoreDollars(this.finalScore), {
				fontFamily: FONT_FAMILY,
				fontSize: `${SCORE_BASE_PX}px`,
				color: "#ffe36e",
				stroke: "#2a1608",
				strokeThickness: 8,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("gameOverScore");

		this.bestLabelText = this.scene.add
			.text(0, 0, "BEST", {
				fontFamily: FONT_FAMILY,
				fontSize: `${BEST_LABEL_PX}px`,
				color: "#d9c4a0",
				stroke: "#2a1608",
				strokeThickness: 4,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("gameOverBestLabel");

		this.bestValueText = this.scene.add
			.text(0, 0, formatScoreDollars(this.bestScore), {
				fontFamily: FONT_FAMILY,
				fontSize: `${BEST_VALUE_PX}px`,
				color: "#ffffff",
				stroke: "#2a1608",
				strokeThickness: 6,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("gameOverBestValue");

		this.newBestText = this.scene.add
			.text(0, 0, "NEW BEST!", {
				fontFamily: FONT_FAMILY,
				fontSize: `${NEW_BEST_PX}px`,
				color: "#7dff9a",
				stroke: "#2a1608",
				strokeThickness: 6,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("gameOverNewBest")
			.setVisible(this.isNewBest);

		this.restartButton = this.scene.add
			.image(0, 0, "restart-001")
			.setOrigin(0.5, 0.5)
			.setScale(BUTTON_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 4)
			.setName("gameOverRestart")
			.setInteractive({ useHandCursor: true });

		this.restartButton.on("pointerover", () => {
			if (this.restartArmed && this.restartButton) {
				this.restartButton.setTexture("restart-002");
			}
		});
		this.restartButton.on("pointerout", () => {
			if (this.restartButton) {
				this.restartButton.setTexture("restart-001");
			}
		});
		this.restartButton.on("pointerdown", () => {
			if (this.restartArmed && this.restartButton) {
				this.restartButton.setTexture("restart-002");
			}
		});
		this.restartButton.on("pointerup", this.boundRestart);
	}

	private layout(): void {
		if (!this.visible || this.destroyed) {
			return;
		}

		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		const cx = w * 0.5;
		const cy = h * 0.5;

		this.overlay?.setPosition(cx, cy).setDisplaySize(w, h);
		this.blocker?.setPosition(cx, cy).setSize(w, h);
		// Re-assert interactive hit area after resize.
		this.blocker?.setInteractive();

		this.title?.setPosition(cx, cy - 150);

		if (this.scoreText) {
			this.scoreText.setText(formatScoreDollars(this.finalScore));
			this.fitScoreText(
				this.scoreText,
				SCORE_BASE_PX,
				Math.min(w * SCORE_MAX_WIDTH_FRAC, 420),
			);
			this.scoreText.setPosition(cx, cy - 55);
		}

		this.bestLabelText?.setPosition(cx, cy + 5);
		if (this.bestValueText) {
			this.bestValueText.setText(formatScoreDollars(this.bestScore));
			this.fitScoreText(
				this.bestValueText,
				BEST_VALUE_PX,
				Math.min(w * SCORE_MAX_WIDTH_FRAC, 360),
			);
			this.bestValueText.setPosition(cx, cy + 40);
		}

		this.newBestText
			?.setVisible(this.isNewBest)
			.setPosition(cx, cy + 78);

		this.restartButton?.setPosition(cx, cy + 150);
	}

	private fitScoreText(
		text: Phaser.GameObjects.Text,
		basePx: number,
		maxWidth: number,
	): void {
		let size = basePx;
		text.setFontSize(size);
		while (text.width > maxWidth && size > SCORE_MIN_PX) {
			size -= 1;
			text.setFontSize(size);
		}
	}

	private handleRestart(): void {
		if (this.destroyed || !this.restartArmed) {
			return;
		}
		this.restartArmed = false;

		this.restartButton?.disableInteractive();
		this.scene.events.off(GAME_FINISHED_EVENT, this.boundFinished);
		this.scene.scale.off("resize", this.boundResize);

		if (this.gameSessionId) {
			FlutterGameBridge.sendRestartGame(this.gameSessionId);
		}

		// Scene restart destroys all controllers via SHUTDOWN and rebuilds create().
		// A new gameSessionId is created by GameSession; last/best scores remain.
		this.scene.scene.restart();
	}

	private teardownUi(): void {
		this.restartButton?.off("pointerup", this.boundRestart);
		this.restartButton?.destroy();
		this.newBestText?.destroy();
		this.bestValueText?.destroy();
		this.bestLabelText?.destroy();
		this.scoreText?.destroy();
		this.title?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();
		this.restartButton = undefined;
		this.newBestText = undefined;
		this.bestValueText = undefined;
		this.bestLabelText = undefined;
		this.scoreText = undefined;
		this.title = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
		this.visible = false;
	}
}
