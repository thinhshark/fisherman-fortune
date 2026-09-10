import Phaser from "phaser";
import type { AudioController } from "./AudioController";

/** Above Result (2000) so the board covers Home and Game Over alike. */
const OVERLAY_DEPTH = 2100;
const OVERLAY_ALPHA = 0.72;
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const MIN_HIT = 72;
const BACK_SCALE = 0.7;
/** Max board footprint inside the design frame. */
const BOARD_MAX_W_FRAC = 0.88;
const BOARD_MAX_H_FRAC = 0.88;

export interface LeaderboardOverlayOptions {
	audio?: AudioController;
}

/**
 * Static “Bảng Xếp Hạng” panel (`bxh`) with top-left back (`back-btn`).
 * Shared by Home and Result; does not open Flutter leaderboard.
 */
export class LeaderboardOverlay {
	private readonly scene: Phaser.Scene;
	private readonly audio?: AudioController;

	private readonly boundResize = this.layout.bind(this);
	private readonly boundBack = this.handleBack.bind(this);

	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private board?: Phaser.GameObjects.Image;
	private backButton?: Phaser.GameObjects.Image;

	private destroyed = false;
	private visible = false;
	private uiBuilt = false;
	private backArmed = true;

	constructor(scene: Phaser.Scene, options: LeaderboardOverlayOptions = {}) {
		this.scene = scene;
		this.audio = options.audio;
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	get isVisible(): boolean {
		return this.visible && !this.destroyed;
	}

	show(): void {
		if (this.destroyed || this.visible) {
			return;
		}
		this.requireTextures();
		this.ensureUi();
		this.visible = true;
		this.backArmed = true;
		this.setUiVisible(true);
		this.backButton?.setInteractive({ useHandCursor: true });
		if (this.backButton) {
			this.ensureMinHitArea(this.backButton);
		}
		this.layout();
		this.scene.scale.on("resize", this.boundResize);
	}

	hide(): void {
		if (this.destroyed || !this.visible) {
			return;
		}
		this.visible = false;
		this.backArmed = false;
		this.setUiVisible(false);
		this.backButton?.disableInteractive();
		this.scene.scale.off("resize", this.boundResize);
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.visible = false;
		this.scene.scale.off("resize", this.boundResize);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
		this.teardownUi();
	}

	private requireTextures(): void {
		for (const key of ["black-screen", "bxh", "back-btn"] as const) {
			if (!this.scene.textures.exists(key)) {
				throw new Error(`LeaderboardOverlay requires texture "${key}"`);
			}
		}
	}

	private ensureUi(): void {
		if (this.uiBuilt) {
			return;
		}
		this.uiBuilt = true;

		this.overlay = this.scene.add
			.image(0, 0, "black-screen")
			.setOrigin(0.5, 0.5)
			.setAlpha(OVERLAY_ALPHA)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH)
			.setName("leaderboardOverlay")
			.setVisible(false);

		this.blocker = this.scene.add
			.rectangle(0, 0, 10, 10, 0x000000, 0.001)
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 1)
			.setInteractive()
			.setName("leaderboardBlocker")
			.setVisible(false);

		this.board = this.scene.add
			.image(0, 0, "bxh")
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 2)
			.setName("leaderboardBoard")
			.setVisible(false);

		this.backButton = this.scene.add
			.image(0, 0, "back-btn")
			.setOrigin(0.5, 0.5)
			.setScale(BACK_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName("leaderboardBack")
			.setVisible(false)
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.backButton);
		this.bindPressVisual(this.backButton);
		this.backButton.on("pointerup", this.boundBack);
	}

	private bindPressVisual(button: Phaser.GameObjects.Image): void {
		button.on("pointerdown", () => {
			if (!this.backArmed || !this.visible) {
				return;
			}
			button.setTint(0xbbbbbb);
		});
		button.on("pointerup", () => {
			button.clearTint();
		});
		button.on("pointerout", () => {
			button.clearTint();
		});
	}

	private handleBack(): void {
		if (this.destroyed || !this.visible || !this.backArmed) {
			return;
		}
		this.backArmed = false;
		this.backButton?.disableInteractive();
		this.backButton?.clearTint();
		this.audio?.playButtonSfx();
		this.hide();
	}

	private layout(): void {
		if (this.destroyed || !this.visible) {
			return;
		}

		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		const cx = w * 0.5;
		const cy = h * 0.5;
		const ui = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);

		this.overlay?.setPosition(cx, cy).setDisplaySize(w, h);
		this.blocker?.setPosition(cx, cy).setSize(w, h);
		if (this.visible) {
			this.blocker?.setInteractive();
		}

		const board = this.board;
		if (board) {
			const src = board.texture.getSourceImage() as {
				width: number;
				height: number;
			};
			const maxW = w * BOARD_MAX_W_FRAC;
			const maxH = h * BOARD_MAX_H_FRAC;
			const scale = Math.min(
				maxW / Math.max(1, src.width),
				maxH / Math.max(1, src.height),
			);
			board.setScale(scale).setPosition(cx, cy);
		}

		const back = this.backButton;
		if (back && board) {
			const backScale = Math.max(BACK_SCALE * ui, MIN_HIT / 160);
			back.setScale(backScale);
			const bounds = board.getBounds();
			const inset = Math.max(16, 20 * ui);
			// Anchor inside the board's top-left (not the raw screen corner).
			back.setPosition(
				bounds.left + inset + back.displayWidth * 0.5,
				bounds.top + inset + back.displayHeight * 0.5,
			);
			this.ensureMinHitArea(back);
		}
	}

	private setUiVisible(visible: boolean): void {
		this.overlay?.setVisible(visible);
		this.blocker?.setVisible(visible);
		this.board?.setVisible(visible);
		this.backButton?.setVisible(visible);
		if (visible) {
			this.blocker?.setInteractive();
		} else {
			this.blocker?.disableInteractive();
		}
	}

	private ensureMinHitArea(image: Phaser.GameObjects.Image): void {
		const b = image.getBounds();
		const padX = Math.max(0, (MIN_HIT - b.width) * 0.5);
		const padY = Math.max(0, (MIN_HIT - b.height) * 0.5);
		image.setInteractive(
			new Phaser.Geom.Rectangle(
				-padX,
				-padY,
				image.width + padX * 2,
				image.height + padY * 2,
			),
			Phaser.Geom.Rectangle.Contains,
		);
	}

	private teardownUi(): void {
		this.backButton?.off("pointerup", this.boundBack);
		this.overlay?.destroy();
		this.blocker?.destroy();
		this.board?.destroy();
		this.backButton?.destroy();
		this.overlay = undefined;
		this.blocker = undefined;
		this.board = undefined;
		this.backButton = undefined;
		this.uiBuilt = false;
	}
}
