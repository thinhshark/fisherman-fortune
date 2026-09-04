import Phaser from "phaser";
import {
	GAME_FINISHED_EVENT,
	type GameFinishedPayload,
} from "./GameSession";

const OVERLAY_DEPTH = 2000;
const OVERLAY_ALPHA = 0.72;
const TITLE_SCALE = 0.55;
const BUTTON_SCALE = 1.15;
const SCORE_BASE_PX = 52;
const SCORE_MIN_PX = 28;
const SCORE_MAX_WIDTH_FRAC = 0.55;
const FONT_FAMILY = "Luckiest Guy";

/**
 * End-of-round result overlay: darken screen, show final score, restart Level.
 * Menu is omitted (no Menu scene yet).
 */
export class GameOverController {
	private readonly scene: Phaser.Scene;
	private readonly boundFinished = this.handleGameFinished.bind(this);
	private readonly boundResize = this.layout.bind(this);
	private readonly boundRestart = this.handleRestart.bind(this);

	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private title?: Phaser.GameObjects.Image;
	private scoreText?: Phaser.GameObjects.Text;
	private restartButton?: Phaser.GameObjects.Image;

	private destroyed = false;
	private visible = false;
	private restartArmed = false;
	private finalScore = 0;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
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
		this.buildUi();
		this.layout();
		this.scene.scale.on("resize", this.boundResize);
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
			.text(0, 0, String(this.finalScore), {
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

		this.title?.setPosition(cx, cy - 110);

		if (this.scoreText) {
			this.scoreText.setText(String(this.finalScore));
			this.fitScoreText(Math.min(w * SCORE_MAX_WIDTH_FRAC, 420));
			this.scoreText.setPosition(cx, cy - 10);
		}

		this.restartButton?.setPosition(cx, cy + 120);
	}

	private fitScoreText(maxWidth: number): void {
		const text = this.scoreText;
		if (!text) {
			return;
		}
		let size = SCORE_BASE_PX;
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

		// Scene restart destroys all controllers via SHUTDOWN and rebuilds create().
		this.scene.scene.restart();
	}

	private teardownUi(): void {
		this.restartButton?.off("pointerup", this.boundRestart);
		this.restartButton?.destroy();
		this.scoreText?.destroy();
		this.title?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();
		this.restartButton = undefined;
		this.scoreText = undefined;
		this.title = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
		this.visible = false;
	}
}
