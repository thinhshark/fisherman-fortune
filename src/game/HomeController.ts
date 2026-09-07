import Phaser from "phaser";
import type { AudioController } from "./AudioController";
import { FlutterGameBridge } from "./FlutterGameBridge";

const OVERLAY_DEPTH = 1500;
const CONTROL_DEPTH = 1510;
const OVERLAY_ALPHA = 0.4;
const SAFE_MARGIN = 28;
const MIN_HIT = 72;
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
/** Vertical rhythm: logo → Play → Sound | Music | Leaderboard. */
const LOGO_Y = 125;
const PLAY_Y = 330;
const ROW_Y = 470;
const ROW_GAP = 115;
/** Uniform scale so square menu assets display ≥72px. */
const ROW_SCALE = 0.72;
const EXIT_SCALE = 0.55;
const PLAY_SCALE = 1.2;
const DISABLED_ALPHA = 0.45;

export interface HomeControllerOptions {
	audio: AudioController;
	onPlay: () => void;
}

/**
 * Ready-state Home: logo → Play (start-game) → Sound | Music | Leaderboard;
 * Exit (X) top-right. Score/Time HUD stays hidden while Home is visible.
 */
export class HomeController {
	private readonly scene: Phaser.Scene;
	private readonly audio: AudioController;
	private readonly onPlay: () => void;

	private readonly boundResize = this.layout.bind(this);
	private readonly boundPlay = this.handlePlay.bind(this);
	private readonly boundLeaderboard = this.handleLeaderboard.bind(this);
	private readonly boundSound = this.handleSoundToggle.bind(this);
	private readonly boundMusic = this.handleMusicToggle.bind(this);
	private readonly boundExit = this.handleExit.bind(this);

	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private logo?: Phaser.GameObjects.Image;
	private playButton?: Phaser.GameObjects.Image;
	private soundButton?: Phaser.GameObjects.Image;
	private musicButton?: Phaser.GameObjects.Image;
	private leaderboardButton?: Phaser.GameObjects.Image;
	private exitButton?: Phaser.GameObjects.Image;

	private destroyed = false;
	private visible = true;
	private playArmed = true;
	private exitArmed = true;
	private leaderboardArmed = true;
	private soundArmed = true;
	private musicArmed = true;

	constructor(scene: Phaser.Scene, options: HomeControllerOptions) {
		this.scene = scene;
		this.audio = options.audio;
		this.onPlay = options.onPlay;

		this.requireTextures();
		this.buildUi();
		this.layout();
		this.refreshAudioAppearance();

		scene.scale.on("resize", this.boundResize);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

		this.playLogoEntrance();
	}

	get isVisible(): boolean {
		return this.visible && !this.destroyed;
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
		this.scene.tweens.killTweensOf(this.logo ?? []);

		this.teardownUi();
	}

	private requireTextures(): void {
		const keys = [
			"game-logo",
			"start-game",
			"sound-001",
			"sound-002",
			"music-001",
			"music-002",
			"leaderboard",
			"exit-001",
			"exit-002",
			"black-screen",
		];
		for (const key of keys) {
			if (!this.scene.textures.exists(key)) {
				throw new Error(`HomeController requires texture "${key}"`);
			}
		}
	}

	private buildUi(): void {
		this.overlay = this.scene.add
			.image(0, 0, "black-screen")
			.setOrigin(0.5, 0.5)
			.setAlpha(OVERLAY_ALPHA)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH)
			.setName("homeOverlay");

		this.blocker = this.scene.add
			.rectangle(0, 0, 10, 10, 0x000000, 0.001)
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 1)
			.setInteractive()
			.setName("homeBlocker");

		this.logo = this.scene.add
			.image(0, 0, "game-logo")
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homeLogo");

		this.playButton = this.scene.add
			.image(0, 0, "start-game")
			.setOrigin(0.5, 0.5)
			.setScale(PLAY_SCALE)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homePlay")
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.playButton);
		this.bindPressVisual(this.playButton, () => PLAY_SCALE * this.uiScale());
		this.playButton.on("pointerup", this.boundPlay);

		this.soundButton = this.scene.add
			.image(0, 0, "sound-002")
			.setOrigin(0.5, 0.5)
			.setScale(ROW_SCALE)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homeSound")
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.soundButton);
		this.soundButton.on("pointerup", this.boundSound);

		this.musicButton = this.scene.add
			.image(0, 0, "music-002")
			.setOrigin(0.5, 0.5)
			.setScale(ROW_SCALE)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homeMusic")
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.musicButton);
		this.musicButton.on("pointerup", this.boundMusic);

		this.leaderboardButton = this.scene.add
			.image(0, 0, "leaderboard")
			.setOrigin(0.5, 0.5)
			.setScale(ROW_SCALE)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homeLeaderboard")
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.leaderboardButton);
		this.bindPressVisual(
			this.leaderboardButton,
			() => ROW_SCALE * this.uiScale(),
		);
		this.leaderboardButton.on("pointerup", this.boundLeaderboard);

		this.exitButton = this.scene.add
			.image(0, 0, "exit-001")
			.setOrigin(0.5, 0.5)
			.setScale(EXIT_SCALE)
			.setScrollFactor(0)
			.setDepth(CONTROL_DEPTH)
			.setName("homeExit")
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(this.exitButton);
		this.exitButton.on("pointerover", () => {
			if (this.exitArmed) {
				this.exitButton?.setTexture("exit-002");
			}
		});
		this.exitButton.on("pointerout", () => {
			this.exitButton?.setTexture("exit-001");
		});
		this.exitButton.on("pointerdown", () => {
			if (this.exitArmed) {
				this.exitButton?.setTexture("exit-002");
			}
		});
		this.exitButton.on("pointerup", this.boundExit);
	}

	private uiScale(): number {
		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		return Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
	}

	private bindPressVisual(
		button: Phaser.GameObjects.Image,
		baseScale: () => number,
	): void {
		button.on("pointerover", () => {
			button.setScale(baseScale() * 0.96);
			button.setTint(0xffe0a0);
		});
		button.on("pointerout", () => {
			button.setScale(baseScale());
			button.clearTint();
		});
		button.on("pointerdown", () => {
			button.setScale(baseScale() * 0.9);
			button.setTint(0xffd070);
		});
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

	private layout(): void {
		if (this.destroyed || !this.visible) {
			return;
		}

		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		const cx = w * 0.5;
		const scaleY = h / DESIGN_HEIGHT;
		const ui = this.uiScale();

		this.overlay?.setPosition(cx, h * 0.5).setDisplaySize(w, h);
		this.blocker?.setPosition(cx, h * 0.5).setSize(w, h).setInteractive();

		const logoMaxW = Math.min(520, w * 0.7);
		const logoTex = this.scene.textures.get("game-logo").getSourceImage() as {
			width: number;
		};
		const logoScale = logoMaxW / Math.max(1, logoTex.width);
		this.logo?.setScale(logoScale).setPosition(cx, LOGO_Y * scaleY);

		this.playButton
			?.setScale(PLAY_SCALE * ui)
			.setPosition(cx, PLAY_Y * scaleY);
		if (this.playButton) {
			this.ensureMinHitArea(this.playButton);
		}

		const rowScale = Math.max(ROW_SCALE * ui, MIN_HIT / 120);
		const rowY = ROW_Y * scaleY;
		const gap = ROW_GAP * ui;
		const rowButtons = [
			this.soundButton,
			this.musicButton,
			this.leaderboardButton,
		];
		for (let i = 0; i < rowButtons.length; i++) {
			const button = rowButtons[i];
			button?.setScale(rowScale).setPosition(cx + (i - 1) * gap, rowY);
			if (button) {
				this.ensureMinHitArea(button);
			}
		}

		this.exitButton
			?.setScale(EXIT_SCALE * ui)
			.setPosition(w - SAFE_MARGIN - 30 * ui, SAFE_MARGIN + 30 * ui);
		if (this.exitButton) {
			this.ensureMinHitArea(this.exitButton);
		}

		this.refreshAudioAppearance();
	}

	private playLogoEntrance(): void {
		const logo = this.logo;
		if (!logo) {
			return;
		}
		const target = logo.scaleX;
		logo.setScale(target * 0.86);
		logo.setAlpha(0.85);
		this.scene.tweens.add({
			targets: logo,
			scaleX: target,
			scaleY: target,
			alpha: 1,
			duration: 420,
			ease: "Back.easeOut",
		});
	}

	/** Construct: *-001 Off, *-002 On. */
	private refreshAudioAppearance(): void {
		const sfxOn = this.audio.isSfxEnabled;
		const musicOn = this.audio.isMusicEnabled;
		this.soundButton
			?.setTexture(sfxOn ? "sound-002" : "sound-001")
			.setAlpha(sfxOn ? 1 : DISABLED_ALPHA);
		this.musicButton
			?.setTexture(musicOn ? "music-002" : "music-001")
			.setAlpha(musicOn ? 1 : DISABLED_ALPHA);
	}

	private disableAllButtons(): void {
		this.playArmed = false;
		this.exitArmed = false;
		this.leaderboardArmed = false;
		this.soundArmed = false;
		this.musicArmed = false;
		this.playButton?.disableInteractive();
		this.soundButton?.disableInteractive();
		this.musicButton?.disableInteractive();
		this.leaderboardButton?.disableInteractive();
		this.exitButton?.disableInteractive();
	}

	private handlePlay(): void {
		if (this.destroyed || !this.visible || !this.playArmed) {
			return;
		}
		this.disableAllButtons();
		this.playButton?.clearTint();

		// Level owns unlock + music switch order (game track before unlock callback).
		this.visible = false;
		this.onPlay();
		this.destroy();
	}

	private handleSoundToggle(): void {
		if (this.destroyed || !this.visible || !this.soundArmed) {
			return;
		}
		this.soundArmed = false;
		this.audio.unlockFromGesture();
		const turningOn = !this.audio.isSfxEnabled;
		this.audio.toggleSfx();
		this.refreshAudioAppearance();
		if (turningOn) {
			this.audio.playButtonSfx();
		}
		this.scene.time.delayedCall(120, () => {
			if (!this.destroyed && this.visible) {
				this.soundArmed = true;
			}
		});
	}

	private handleMusicToggle(): void {
		if (this.destroyed || !this.visible || !this.musicArmed) {
			return;
		}
		this.musicArmed = false;
		// Preference + visual only while Home is visible (AudioController never starts BGM here).
		this.audio.toggleMusic();
		this.refreshAudioAppearance();
		if (this.audio.isSfxEnabled) {
			this.audio.playButtonSfx();
		}
		this.scene.time.delayedCall(120, () => {
			if (!this.destroyed && this.visible) {
				this.musicArmed = true;
			}
		});
	}

	private handleLeaderboard(): void {
		if (this.destroyed || !this.visible || !this.leaderboardArmed) {
			return;
		}
		this.leaderboardArmed = false;
		this.leaderboardButton?.disableInteractive();
		this.leaderboardButton?.clearTint();
		this.audio.playButtonSfx();
		FlutterGameBridge.sendOpenLeaderboard();
		this.scene.time.delayedCall(400, () => {
			if (!this.destroyed && this.visible) {
				this.leaderboardArmed = true;
				this.leaderboardButton?.setInteractive();
				if (this.leaderboardButton) {
					this.ensureMinHitArea(this.leaderboardButton);
				}
			}
		});
	}

	private handleExit(): void {
		if (this.destroyed || !this.visible || !this.exitArmed) {
			return;
		}
		this.exitArmed = false;
		this.exitButton?.disableInteractive();
		this.audio.playButtonSfx();
		FlutterGameBridge.sendExitGame();
		this.exitButton?.setTexture("exit-001");
		this.scene.time.delayedCall(500, () => {
			if (!this.destroyed && this.visible) {
				this.exitArmed = true;
				this.exitButton?.setInteractive();
				if (this.exitButton) {
					this.ensureMinHitArea(this.exitButton);
				}
			}
		});
	}

	private teardownUi(): void {
		this.playButton?.off("pointerup", this.boundPlay);
		this.soundButton?.off("pointerup", this.boundSound);
		this.musicButton?.off("pointerup", this.boundMusic);
		this.leaderboardButton?.off("pointerup", this.boundLeaderboard);
		this.exitButton?.off("pointerup", this.boundExit);

		this.playButton?.destroy();
		this.soundButton?.destroy();
		this.musicButton?.destroy();
		this.leaderboardButton?.destroy();
		this.exitButton?.destroy();
		this.logo?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();

		this.playButton = undefined;
		this.soundButton = undefined;
		this.musicButton = undefined;
		this.leaderboardButton = undefined;
		this.exitButton = undefined;
		this.logo = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
	}
}
