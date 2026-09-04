import Phaser from "phaser";

const FONT_FAMILY = "Luckiest Guy";
const FILL = 0x3b2418;
const BORDER = 0xdca63a;
const SHADOW = 0x1a0e08;
const TEXT_COLOR = "#fff3c8";
const TEXT_STROKE = "#2a1608";

/** Compact jungle/wood Leaderboard control: [list icon] LEADERBOARD */
export const LEADERBOARD_BUTTON_WIDTH = 330;
export const LEADERBOARD_BUTTON_HEIGHT = 74;
const ICON_DISPLAY = 56;
const ICON_TEXT_GAP = 16;
const CORNER_RADIUS = 16;
const PRESS_SCALE = 0.96;

export interface LeaderboardButtonOptions {
	scene: Phaser.Scene;
	depth: number;
	namePrefix: string;
	onActivate: () => void;
	/** Optional uniform UI scale (Home responsive). Default 1. */
	scale?: number;
}

/**
 * One unified horizontal Leaderboard button (icon + label in one container).
 * Opens Flutter leaderboard via the caller's onActivate; no Phaser leaderboard UI.
 */
export class LeaderboardButton {
	readonly container: Phaser.GameObjects.Container;

	private readonly scene: Phaser.Scene;
	private readonly onActivate: () => void;
	private readonly boundPointerUp = this.handlePointerUp.bind(this);
	private readonly boundPointerDown = this.handlePointerDown.bind(this);
	private readonly boundPointerOut = this.handlePointerOut.bind(this);

	private destroyed = false;
	private armed = true;
	private baseScale = 1;
	private shadow?: Phaser.GameObjects.Graphics;
	private panel?: Phaser.GameObjects.Graphics;
	private icon?: Phaser.GameObjects.Image;
	private label?: Phaser.GameObjects.Text;

	constructor(options: LeaderboardButtonOptions) {
		this.scene = options.scene;
		this.onActivate = options.onActivate;
		this.baseScale = options.scale ?? 1;

		if (!this.scene.textures.exists("menu-001")) {
			throw new Error(
				'LeaderboardButton requires registered texture "menu-001"',
			);
		}

		const w = LEADERBOARD_BUTTON_WIDTH;
		const h = LEADERBOARD_BUTTON_HEIGHT;

		this.shadow = this.scene.add.graphics();
		this.shadow.fillStyle(SHADOW, 0.45);
		this.shadow.fillRoundedRect(
			-w * 0.5 + 3,
			-h * 0.5 + 4,
			w,
			h,
			CORNER_RADIUS,
		);
		this.shadow.setName(`${options.namePrefix}Shadow`);

		this.panel = this.scene.add.graphics();
		this.panel.fillStyle(FILL, 1);
		this.panel.fillRoundedRect(-w * 0.5, -h * 0.5, w, h, CORNER_RADIUS);
		this.panel.lineStyle(3, BORDER, 1);
		this.panel.strokeRoundedRect(-w * 0.5, -h * 0.5, w, h, CORNER_RADIUS);
		this.panel.setName(`${options.namePrefix}Panel`);

		this.icon = this.scene.add
			.image(0, 0, "menu-001")
			.setOrigin(0.5, 0.5)
			.setName(`${options.namePrefix}Icon`);
		const iconTex = this.scene.textures.get("menu-001").getSourceImage() as {
			width: number;
			height: number;
		};
		const iconScale =
			ICON_DISPLAY / Math.max(iconTex.width, iconTex.height, 1);
		this.icon.setScale(iconScale);

		this.label = this.scene.add
			.text(0, 0, "LEADERBOARD", {
				fontFamily: FONT_FAMILY,
				fontSize: "28px",
				color: TEXT_COLOR,
				stroke: TEXT_STROKE,
				strokeThickness: 5,
				align: "left",
			})
			.setOrigin(0, 0.5)
			.setName(`${options.namePrefix}Label`);

		const contentWidth =
			this.icon.displayWidth + ICON_TEXT_GAP + this.label.width;
		const contentLeft = -contentWidth * 0.5;
		this.icon.setPosition(
			contentLeft + this.icon.displayWidth * 0.5,
			0,
		);
		this.label.setPosition(
			contentLeft + this.icon.displayWidth + ICON_TEXT_GAP,
			1,
		);

		this.container = this.scene.add.container(0, 0, [
			this.shadow,
			this.panel,
			this.icon,
			this.label,
		]);
		this.container
			.setSize(w, h)
			.setScrollFactor(0)
			.setDepth(options.depth)
			.setScale(this.baseScale)
			.setName(`${options.namePrefix}Button`);

		this.container.setInteractive(
			new Phaser.Geom.Rectangle(-w * 0.5, -h * 0.5, w, h),
			Phaser.Geom.Rectangle.Contains,
		);
		if (this.container.input) {
			this.container.input.cursor = "pointer";
		}

		this.container.on("pointerdown", this.boundPointerDown);
		this.container.on("pointerout", this.boundPointerOut);
		this.container.on("pointerup", this.boundPointerUp);
	}

	get isArmed(): boolean {
		return this.armed && !this.destroyed;
	}

	setArmed(armed: boolean): void {
		this.armed = armed;
		if (!armed) {
			this.container.disableInteractive();
			this.container.setAlpha(0.55);
			this.container.setScale(this.baseScale);
		} else if (!this.destroyed) {
			this.container.setInteractive(
				new Phaser.Geom.Rectangle(
					-LEADERBOARD_BUTTON_WIDTH * 0.5,
					-LEADERBOARD_BUTTON_HEIGHT * 0.5,
					LEADERBOARD_BUTTON_WIDTH,
					LEADERBOARD_BUTTON_HEIGHT,
				),
				Phaser.Geom.Rectangle.Contains,
			);
			if (this.container.input) {
				this.container.input.cursor = "pointer";
			}
			this.container.setAlpha(1);
		}
	}

	setPosition(x: number, y: number): void {
		this.container.setPosition(x, y);
	}

	setBaseScale(scale: number): void {
		this.baseScale = scale;
		if (!this.destroyed) {
			this.container.setScale(scale);
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.armed = false;
		this.container.off("pointerdown", this.boundPointerDown);
		this.container.off("pointerout", this.boundPointerOut);
		this.container.off("pointerup", this.boundPointerUp);
		this.container.destroy(true);
		this.shadow = undefined;
		this.panel = undefined;
		this.icon = undefined;
		this.label = undefined;
	}

	private handlePointerDown(): void {
		if (this.destroyed || !this.armed) {
			return;
		}
		this.container.setScale(this.baseScale * PRESS_SCALE);
	}

	private handlePointerOut(): void {
		if (this.destroyed) {
			return;
		}
		this.container.setScale(this.baseScale);
	}

	private handlePointerUp(): void {
		if (this.destroyed || !this.armed) {
			return;
		}
		this.container.setScale(this.baseScale);
		this.onActivate();
	}
}
