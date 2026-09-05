import Phaser from "phaser";
import {
	SCORE_CHANGED_EVENT,
	TIME_CHANGED_EVENT,
	type ScoreChangedPayload,
	type TimeChangedPayload,
} from "./GameSession";

const HUD_DEPTH = 1000;
const HUD_MARGIN_PX = 20;
/** Uniform scale so panels keep aspect ratio (source ~330×225). */
const PANEL_SCALE = 0.48;
const FONT_FAMILY = "Luckiest Guy";
/** Base font size at design resolution 1280×720. */
const FONT_SIZE_BASE_AT_1280 = 36;
const FONT_SIZE_MAX = 38;
const FONT_SIZE_MIN = 22;
const STROKE_THICKNESS = 5;
/** Shift number center toward the right of the panel (away from left icon). */
const TEXT_CENTER_X_OFFSET_FRAC = 0.11;
/** Nudge Score/Time numbers down relative to the panel center (panels stay put). */
const TEXT_Y_OFFSET_PX = 8;
const SCORE_TEXT_COLOR = "#FFD34E";
const TIME_TEXT_COLOR = "#66E6FF";
const TEXT_STROKE_COLOR = "#1a1208";
/** Max fraction of panel width the number may occupy. */
const TEXT_MAX_WIDTH_FRAC = 0.55;
const DESIGN_WIDTH = 1280;

/**
 * Score + timer HUD panels (gui-score / gui-time) with Luckiest Guy text.
 */
export class HudController {
	private readonly scene: Phaser.Scene;
	private readonly scorePanel: Phaser.GameObjects.Image;
	private readonly timePanel: Phaser.GameObjects.Image;
	private readonly scoreText: Phaser.GameObjects.Text;
	private readonly timeText: Phaser.GameObjects.Text;

	private readonly boundScoreChanged = this.handleScoreChanged.bind(this);
	private readonly boundTimeChanged = this.handleTimeChanged.bind(this);
	private readonly boundResize = this.handleResize.bind(this);

	private destroyed = false;

	constructor(scene: Phaser.Scene) {
		this.scene = scene;

		if (!scene.textures.exists("gui-score")) {
			throw new Error('HudController requires texture "gui-score"');
		}
		if (!scene.textures.exists("gui-time")) {
			throw new Error('HudController requires texture "gui-time"');
		}

		const initialFontSize = this.getBaseFontSize();

		this.scorePanel = scene.add
			.image(0, 0, "gui-score")
			.setOrigin(0, 0)
			.setScale(PANEL_SCALE)
			.setScrollFactor(0)
			.setDepth(HUD_DEPTH)
			.setName("hudScorePanel");

		this.timePanel = scene.add
			.image(0, 0, "gui-time")
			.setOrigin(1, 0)
			.setScale(PANEL_SCALE)
			.setScrollFactor(0)
			.setDepth(HUD_DEPTH)
			.setName("hudTimePanel");

		this.scoreText = scene.add
			.text(0, 0, "0", {
				fontFamily: FONT_FAMILY,
				fontSize: `${initialFontSize}px`,
				color: SCORE_TEXT_COLOR,
				stroke: TEXT_STROKE_COLOR,
				strokeThickness: STROKE_THICKNESS,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(HUD_DEPTH + 1)
			.setName("hudScoreText");

		this.timeText = scene.add
			.text(0, 0, "100", {
				fontFamily: FONT_FAMILY,
				fontSize: `${initialFontSize}px`,
				color: TIME_TEXT_COLOR,
				stroke: TEXT_STROKE_COLOR,
				strokeThickness: STROKE_THICKNESS,
				align: "center",
			})
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(HUD_DEPTH + 1)
			.setName("hudTimeText");

		this.layout();

		scene.events.on(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		scene.events.on(TIME_CHANGED_EVENT, this.boundTimeChanged);
		scene.scale.on("resize", this.boundResize);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

		this.refreshFontWhenReady();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.scene.events.off(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		this.scene.events.off(TIME_CHANGED_EVENT, this.boundTimeChanged);
		this.scene.scale.off("resize", this.boundResize);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);

		this.scoreText.destroy();
		this.timeText.destroy();
		this.scorePanel.destroy();
		this.timePanel.destroy();
	}

	private handleScoreChanged(payload: ScoreChangedPayload): void {
		if (this.destroyed) {
			return;
		}
		this.scoreText.setText(String(payload.totalScore));
		this.fitTextToPanel(this.scoreText, this.scorePanel);
	}

	private handleTimeChanged(payload: TimeChangedPayload): void {
		if (this.destroyed) {
			return;
		}
		this.timeText.setText(String(Math.max(0, payload.remainingSeconds)));
		this.fitTextToPanel(this.timeText, this.timePanel);
	}

	private handleResize(): void {
		if (this.destroyed) {
			return;
		}
		this.layout();
	}

	private layout(): void {
		const width = this.scene.scale.width;

		this.scorePanel.setPosition(HUD_MARGIN_PX, HUD_MARGIN_PX);
		this.timePanel.setPosition(width - HUD_MARGIN_PX, HUD_MARGIN_PX);

		this.positionTextOnPanel(this.scoreText, this.scorePanel);
		this.positionTextOnPanel(this.timeText, this.timePanel);

		this.fitTextToPanel(this.scoreText, this.scorePanel);
		this.fitTextToPanel(this.timeText, this.timePanel);
	}

	/**
	 * Number origin 0.5/0.5 at panel center Y + TEXT_Y_OFFSET_PX,
	 * shifted right by 11% of panel width (away from the icon).
	 */
	private positionTextOnPanel(
		text: Phaser.GameObjects.Text,
		panel: Phaser.GameObjects.Image,
	): void {
		const centerX = panel.x + (0.5 - panel.originX) * panel.displayWidth;
		const centerY = panel.y + (0.5 - panel.originY) * panel.displayHeight;
		text.setPosition(
			centerX + panel.displayWidth * TEXT_CENTER_X_OFFSET_FRAC,
			centerY + TEXT_Y_OFFSET_PX,
		);
	}

	/**
	 * Reset to base size, then shrink uniformly until the string fits
	 * panel.displayWidth * 0.55 (floor 22px).
	 */
	private fitTextToPanel(
		text: Phaser.GameObjects.Text,
		panel: Phaser.GameObjects.Image,
	): void {
		const maxWidth = panel.displayWidth * TEXT_MAX_WIDTH_FRAC;
		let size = this.getBaseFontSize();
		text.setFontSize(size);

		while (text.width > maxWidth && size > FONT_SIZE_MIN) {
			size -= 1;
			text.setFontSize(size);
		}
	}

	/** Base size scaled from 36px @ 1280 wide, clamped to [22, 38]. */
	private getBaseFontSize(): number {
		const scale = this.scene.scale.width / DESIGN_WIDTH;
		return Phaser.Math.Clamp(
			Math.round(FONT_SIZE_BASE_AT_1280 * scale),
			FONT_SIZE_MIN,
			FONT_SIZE_MAX,
		);
	}

	/**
	 * Wait for web font without blocking scene start; refresh family when ready.
	 */
	private refreshFontWhenReady(): void {
		const apply = (): void => {
			if (this.destroyed) {
				return;
			}
			this.scoreText.setStyle({ fontFamily: FONT_FAMILY });
			this.timeText.setStyle({ fontFamily: FONT_FAMILY });
			this.fitTextToPanel(this.scoreText, this.scorePanel);
			this.fitTextToPanel(this.timeText, this.timePanel);
		};

		const fonts = (
			globalThis as unknown as { document?: Document }
		).document?.fonts;
		if (!fonts) {
			return;
		}

		const loadSize = this.getBaseFontSize();
		void fonts
			.load(`${loadSize}px "${FONT_FAMILY}"`)
			.then(apply)
			.catch(() => {
				/* non-blocking */
			});
		void fonts.ready.then(apply).catch(() => {
			/* non-blocking */
		});
	}

	/** Show/hide score + timer panels (ready-state / overlay coordination). */
	setVisible(visible: boolean): void {
		if (this.destroyed) {
			return;
		}
		this.scorePanel.setVisible(visible);
		this.timePanel.setVisible(visible);
		this.scoreText.setVisible(visible);
		this.timeText.setVisible(visible);
	}
}
