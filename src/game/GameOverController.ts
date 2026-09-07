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
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const TITLE_SCALE = 0.55;
/** Shared scale for Restart | Home | Leaderboard. */
const ROW_SCALE = 0.78;
const SCORE_BASE_PX = 72;
const SCORE_MIN_PX = 32;
const SCORE_MAX_WIDTH_FRAC = 0.55;
const MIN_HIT = 72;
const FONT_FAMILY = "Luckiest Guy";
const DISABLED_ALPHA = 0.55;
/** Design-space Y offsets from center (scaled by ui). */
const TITLE_OFFSET_Y = -145;
const SCORE_OFFSET_Y = -25;
const ROW_OFFSET_Y = 130;
/** Horizontal spacing between the three square action buttons. */
const ROW_GAP = 130;

export interface GameOverControllerOptions {
	audio?: AudioController;
	onPlayAgain: () => void;
	onHome: () => void;
}

/**
 * End-of-round Result: YOUR SCORE → value → Restart | Home | Leaderboard.
 * Submits score once via FlutterGameBridge; Flutter owns the real leaderboard.
 */
export class GameOverController {
	private readonly scene: Phaser.Scene;
	private readonly audio?: AudioController;
	private readonly onPlayAgain: () => void;
	private readonly onHome: () => void;

	private readonly boundFinished = this.handleGameFinished.bind(this);
	private readonly boundResize = this.layout.bind(this);
	private readonly boundPlayAgain = this.handlePlayAgain.bind(this);
	private readonly boundLeaderboard = this.handleLeaderboard.bind(this);
	private readonly boundHome = this.handleHome.bind(this);

	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private title?: Phaser.GameObjects.Image;
	private scoreText?: Phaser.GameObjects.Text;
	private playAgainButton?: Phaser.GameObjects.Image;
	private homeButton?: Phaser.GameObjects.Image;
	private leaderboardButton?: Phaser.GameObjects.Image;

	private destroyed = false;
	private visible = false;
	private uiBuilt = false;
	private actionsArmed = false;
	private leaderboardArmed = true;
	/** Per completed session — local save + GAME_FINISHED once. */
	private scoreSubmitted = false;
	private finalScore = 0;
	private gameSessionId = "";

	constructor(scene: Phaser.Scene, options: GameOverControllerOptions) {
		this.scene = scene;
		this.audio = options.audio;
		this.onPlayAgain = options.onPlayAgain;
		this.onHome = options.onHome;
		scene.events.on(GAME_FINISHED_EVENT, this.boundFinished);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get isVisible(): boolean {
		return this.visible && !this.destroyed;
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.actionsArmed = false;
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
		if (this.destroyed || this.visible || this.uiBuilt) {
			return;
		}
		this.actionsArmed = true;
		this.leaderboardArmed = true;
		this.finalScore = payload.finalScore;
		this.gameSessionId = payload.gameSessionId;

		this.submitScoreOnce(payload);
		// AudioController also listens to GAME_FINISHED (stop music + SFX once).
		this.audio?.playResultGameOver();

		this.teardownUi();
		this.buildUi();
		this.visible = true;
		this.layout();
		this.scene.scale.on("resize", this.boundResize);
	}

	/**
	 * Save local last/best and emit GAME_FINISHED to Flutter exactly once
	 * for this completed session.
	 */
	private submitScoreOnce(payload: GameFinishedPayload): void {
		if (this.scoreSubmitted) {
			return;
		}
		this.scoreSubmitted = true;

		ScoreStorage.saveFinalScore(payload.finalScore, payload.gameSessionId);

		FlutterGameBridge.sendGameFinished({
			gameSessionId: payload.gameSessionId,
			score: payload.finalScore,
			durationSeconds: GameSession.DURATION_SECONDS,
		});
	}

	private buildUi(): void {
		this.requireTextures();
		this.uiBuilt = true;

		this.overlay = this.scene.add
			.image(0, 0, "black-screen")
			.setOrigin(0.5, 0.5)
			.setAlpha(OVERLAY_ALPHA)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH)
			.setName("resultOverlay");

		this.blocker = this.scene.add
			.rectangle(0, 0, 10, 10, 0x000000, 0.001)
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 1)
			.setInteractive()
			.setName("resultBlocker");

		this.title = this.scene.add
			.image(0, 0, "text-your-score")
			.setOrigin(0.5, 0.5)
			.setScale(TITLE_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 2)
			.setName("resultTitle");

		this.scoreText = this.scene.add
			.text(0, 0, String(Math.max(0, Math.floor(this.finalScore))), {
				fontFamily: FONT_FAMILY,
				fontSize: `${SCORE_BASE_PX}px`,
				color: "#f5ead0",
				stroke: "#2a1608",
				strokeThickness: 8,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("resultScore");

		this.playAgainButton = this.createActionButton(
			"restart-002",
			"restart-002",
			"resultPlayAgain",
			this.boundPlayAgain,
		);
		this.homeButton = this.createActionButton(
			"home",
			"home",
			"resultHome",
			this.boundHome,
		);
		this.leaderboardButton = this.createActionButton(
			"leaderboard",
			"leaderboard",
			"resultLeaderboard",
			this.boundLeaderboard,
		);
	}

	private requireTextures(): void {
		const keys = [
			"black-screen",
			"text-your-score",
			"restart-001",
			"restart-002",
			"home",
			"leaderboard",
		];
		for (const key of keys) {
			if (!this.scene.textures.exists(key)) {
				throw new Error(`GameOverController requires texture "${key}"`);
			}
		}
	}

	private createActionButton(
		idleKey: string,
		pressedKey: string,
		name: string,
		onUp: () => void,
	): Phaser.GameObjects.Image {
		const button = this.scene.add
			.image(0, 0, idleKey)
			.setOrigin(0.5, 0.5)
			.setScale(ROW_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 4)
			.setName(name)
			.setInteractive({ useHandCursor: true });

		this.ensureMinHitArea(button);
		this.bindPressVisual(button, idleKey, pressedKey);
		button.on("pointerup", onUp);
		return button;
	}

	private bindPressVisual(
		button: Phaser.GameObjects.Image,
		idleKey: string,
		pressedKey: string,
	): void {
		const hasPressedTexture = idleKey !== pressedKey;
		button.on("pointerover", () => {
			if (this.actionsArmed && button.visible && hasPressedTexture) {
				button.setTexture(pressedKey);
			}
		});
		button.on("pointerout", () => {
			button.setTexture(idleKey);
			button.clearTint();
		});
		button.on("pointerdown", () => {
			if (!this.actionsArmed || !button.visible) {
				return;
			}
			if (hasPressedTexture) {
				button.setTexture(pressedKey);
			} else {
				button.setTint(0xbbbbbb);
			}
		});
		button.on("pointerup", () => {
			button.clearTint();
		});
	}

	private layout(): void {
		if (!this.visible || this.destroyed || !this.uiBuilt) {
			return;
		}

		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		const cx = w * 0.5;
		const cy = h * 0.5;
		const ui = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);

		this.overlay?.setPosition(cx, cy).setDisplaySize(w, h);
		this.blocker?.setPosition(cx, cy).setSize(w, h).setInteractive();

		this.title
			?.setScale(TITLE_SCALE * ui)
			.setPosition(cx, cy + TITLE_OFFSET_Y * ui);

		if (this.scoreText) {
			this.scoreText.setText(
				String(Math.max(0, Math.floor(this.finalScore))),
			);
			this.fitScoreText(
				this.scoreText,
				Math.round(SCORE_BASE_PX * ui),
				Math.min(w * SCORE_MAX_WIDTH_FRAC, 480 * ui),
			);
			this.scoreText.setPosition(cx, cy + SCORE_OFFSET_Y * ui);
		}

		const rowY = cy + ROW_OFFSET_Y * ui;
		const rowScale = ROW_SCALE * ui;
		const gap = ROW_GAP * ui;
		const rowButtons = [
			this.playAgainButton,
			this.homeButton,
			this.leaderboardButton,
		];
		for (let i = 0; i < rowButtons.length; i++) {
			const button = rowButtons[i];
			button?.setScale(rowScale).setPosition(cx + (i - 1) * gap, rowY);
			if (button) {
				this.ensureMinHitArea(button);
			}
		}
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

	private ensureMinHitArea(button: Phaser.GameObjects.Image): void {
		const w = Math.max(button.displayWidth, MIN_HIT);
		const h = Math.max(button.displayHeight, MIN_HIT);
		button.setInteractive(
			new Phaser.Geom.Rectangle(-w * 0.5, -h * 0.5, w, h),
			Phaser.Geom.Rectangle.Contains,
		);
		if (button.input) {
			button.input.cursor = "pointer";
		}
	}

	private disableAllActions(): void {
		this.actionsArmed = false;
		this.leaderboardArmed = false;
		this.playAgainButton?.disableInteractive();
		this.homeButton?.disableInteractive();
		this.leaderboardButton?.disableInteractive();
		this.playAgainButton?.setAlpha(DISABLED_ALPHA);
		this.homeButton?.setAlpha(DISABLED_ALPHA);
		this.leaderboardButton?.setAlpha(DISABLED_ALPHA);
	}

	private handlePlayAgain(): void {
		if (this.destroyed || !this.visible || !this.actionsArmed) {
			return;
		}
		this.disableAllActions();
		this.audio?.playButtonSfx();

		if (this.gameSessionId) {
			FlutterGameBridge.sendRestartGame(this.gameSessionId);
		}

		this.scene.scale.off("resize", this.boundResize);
		this.teardownUi();
		this.onPlayAgain();
	}

	private handleLeaderboard(): void {
		if (
			this.destroyed ||
			!this.visible ||
			!this.actionsArmed ||
			!this.leaderboardArmed
		) {
			return;
		}
		this.leaderboardArmed = false;
		this.leaderboardButton?.disableInteractive();
		this.audio?.playButtonSfx();
		FlutterGameBridge.sendOpenLeaderboard();
		this.scene.time.delayedCall(400, () => {
			if (!this.destroyed && this.visible && this.actionsArmed) {
				this.leaderboardArmed = true;
				this.leaderboardButton?.setInteractive();
				if (this.leaderboardButton) {
					this.ensureMinHitArea(this.leaderboardButton);
				}
			}
		});
	}

	private handleHome(): void {
		if (this.destroyed || !this.visible || !this.actionsArmed) {
			return;
		}
		this.disableAllActions();
		this.audio?.playButtonSfx();
		this.scene.scale.off("resize", this.boundResize);
		this.teardownUi();
		this.onHome();
	}

	private teardownUi(): void {
		this.playAgainButton?.off("pointerup", this.boundPlayAgain);
		this.homeButton?.off("pointerup", this.boundHome);
		this.leaderboardButton?.off("pointerup", this.boundLeaderboard);

		this.leaderboardButton?.destroy();
		this.homeButton?.destroy();
		this.playAgainButton?.destroy();
		this.scoreText?.destroy();
		this.title?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();

		this.leaderboardButton = undefined;
		this.homeButton = undefined;
		this.playAgainButton = undefined;
		this.scoreText = undefined;
		this.title = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
		this.uiBuilt = false;
		this.visible = false;
	}
}
