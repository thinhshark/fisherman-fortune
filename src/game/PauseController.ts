import Phaser from "phaser";
import type { AudioController } from "./AudioController";
import {
	GAME_ENDING_EVENT,
	GAME_FINISHED_EVENT,
} from "./GameSession";

const PAUSE_BUTTON_DEPTH = 1010;
const OVERLAY_DEPTH = 1900;
const OVERLAY_ALPHA = 0.72;
const DISABLED_ALPHA = 0.45;
const PAUSE_BUTTON_Y = 42;
const PAUSE_BUTTON_SCALE = 0.55;
const TITLE_SCALE = 0.55;
/** Continue is a wide pill; jungle squares share ACTION_SCALE. */
const CONTINUE_SCALE = 0.85;
const ACTION_SCALE = 0.95;
const TOGGLE_SCALE = 0.72;
const MIN_HIT = 72;

export interface PauseControllerOptions {
	canPause: () => boolean;
	onPausedChanged: (paused: boolean) => void;
	/** Abort run and return to Home without GAME_FINISHED / score save. */
	onHome: () => void;
	/** Close pause and restart a fresh gameplay session in-place. */
	onReplay: () => void;
}

/**
 * In-game pause: Continue, Replay, Home, separate Sound / Music toggles.
 *
 * Textures (visual inspection):
 * - Replay → restart-001 / restart-002 (circular arrows)
 * - Home → return-001 / return-002 (back arrow; menu-001 is the list/leaderboard glyph)
 */
export class PauseController {
	private readonly scene: Phaser.Scene;
	private readonly audio: AudioController;
	private readonly canPauseFn: () => boolean;
	private readonly onPausedChanged: (paused: boolean) => void;
	private readonly onHome: () => void;
	private readonly onReplay: () => void;

	private readonly boundToggleKey = this.handleToggleKey.bind(this);
	private readonly boundResize = this.layout.bind(this);
	private readonly boundEnding = this.handleGameEnding.bind(this);
	private readonly boundFinished = this.handleGameFinished.bind(this);
	private readonly boundPauseButton = this.handlePauseButton.bind(this);
	private readonly boundContinue = this.handleContinue.bind(this);
	private readonly boundReplay = this.handleReplay.bind(this);
	private readonly boundHome = this.handleHome.bind(this);
	private readonly boundSound = this.handleSoundToggle.bind(this);
	private readonly boundMusic = this.handleMusicToggle.bind(this);

	private pauseButton?: Phaser.GameObjects.Image;
	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private title?: Phaser.GameObjects.Image;
	private continueButton?: Phaser.GameObjects.Image;
	private replayButton?: Phaser.GameObjects.Image;
	private homeButton?: Phaser.GameObjects.Image;
	private soundButton?: Phaser.GameObjects.Image;
	private musicButton?: Phaser.GameObjects.Image;

	private _isPaused = false;
	private _isVisible = false;
	private destroyed = false;
	private pauseAllowed = false;
	private homeArmed = true;
	private replayArmed = true;
	private soundArmed = true;
	private musicArmed = true;
	private overlayBuilt = false;

	constructor(
		scene: Phaser.Scene,
		audio: AudioController,
		options: PauseControllerOptions,
	) {
		this.scene = scene;
		this.audio = audio;
		this.canPauseFn = options.canPause;
		this.onPausedChanged = options.onPausedChanged;
		this.onHome = options.onHome;
		this.onReplay = options.onReplay;

		this.requireTextures();
		this.buildPauseButton();
		this.setPauseButtonVisible(false);
		this.registerKeyboard();

		scene.events.on(GAME_ENDING_EVENT, this.boundEnding);
		scene.events.on(GAME_FINISHED_EVENT, this.boundFinished);
		scene.scale.on("resize", this.boundResize);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

		this.layout();
	}

	get isPaused(): boolean {
		return this._isPaused;
	}

	get isVisible(): boolean {
		return this._isVisible;
	}

	setGameplayActive(active: boolean): void {
		if (this.destroyed) {
			return;
		}
		this.pauseAllowed = active;
		if (!active) {
			if (this._isPaused || this._isVisible) {
				this.closeOverlayOnly();
			}
			this.setPauseButtonVisible(false);
			return;
		}
		if (!this._isPaused) {
			this.setPauseButtonVisible(true);
		}
	}

	pause(): void {
		if (this.destroyed || this._isPaused || !this.pauseAllowed) {
			return;
		}
		if (!this.canPauseFn()) {
			return;
		}

		this.audio.playPauseSfx();
		this._isPaused = true;
		this.onPausedChanged(true);
		this.showOverlay();
		this.setPauseButtonVisible(false);
	}

	resume(): void {
		if (this.destroyed || !this._isPaused) {
			return;
		}
		if (!this.pauseAllowed) {
			this.closeOverlayOnly();
			return;
		}

		this._isPaused = false;
		this.hideOverlay();
		this.onPausedChanged(false);
		this.setPauseButtonVisible(true);
	}

	toggle(): void {
		if (this.destroyed || !this.pauseAllowed) {
			return;
		}
		if (this._isPaused) {
			this.audio.playButtonSfx();
			this.resume();
		} else {
			this.pause();
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.unregisterKeyboard();
		this.scene.events.off(GAME_ENDING_EVENT, this.boundEnding);
		this.scene.events.off(GAME_FINISHED_EVENT, this.boundFinished);
		this.scene.scale.off("resize", this.boundResize);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);

		this.teardownPauseButton();
		this.teardownOverlay();

		this._isPaused = false;
		this._isVisible = false;
	}

	private requireTextures(): void {
		const keys = [
			"pause-001",
			"pause-002",
			"continue-001",
			"continue-002",
			"restart-001",
			"restart-002",
			"return-001",
			"return-002",
			"sound-001",
			"sound-002",
			"music-001",
			"music-002",
			"black-screen",
			"text-paused",
		];
		for (const key of keys) {
			if (!this.scene.textures.exists(key)) {
				throw new Error(`PauseController requires texture "${key}"`);
			}
		}
	}

	private buildPauseButton(): void {
		this.pauseButton = this.scene.add
			.image(0, 0, "pause-001")
			.setOrigin(0.5, 0.5)
			.setScale(PAUSE_BUTTON_SCALE)
			.setScrollFactor(0)
			.setDepth(PAUSE_BUTTON_DEPTH)
			.setName("hudPauseButton")
			.setInteractive({ useHandCursor: true });

		this.ensureMinHitArea(this.pauseButton);

		this.pauseButton.on("pointerover", () => {
			this.pauseButton?.setTexture("pause-002");
		});
		this.pauseButton.on("pointerout", () => {
			this.pauseButton?.setTexture("pause-001");
		});
		this.pauseButton.on("pointerdown", () => {
			this.pauseButton?.setTexture("pause-002");
		});
		this.pauseButton.on("pointerup", this.boundPauseButton);
	}

	private buildOverlay(): void {
		if (this.overlayBuilt) {
			return;
		}
		this.overlayBuilt = true;

		this.overlay = this.scene.add
			.image(0, 0, "black-screen")
			.setOrigin(0.5, 0.5)
			.setAlpha(OVERLAY_ALPHA)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH)
			.setName("pauseOverlay")
			.setVisible(false);

		this.blocker = this.scene.add
			.rectangle(0, 0, 10, 10, 0x000000, 0.001)
			.setOrigin(0.5, 0.5)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 1)
			.setInteractive()
			.setName("pauseBlocker")
			.setVisible(false);

		this.title = this.scene.add
			.image(0, 0, "text-paused")
			.setOrigin(0.5, 0.5)
			.setScale(TITLE_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 2)
			.setName("pauseTitle")
			.setVisible(false);

		this.continueButton = this.createActionButton(
			"continue-001",
			"continue-002",
			"pauseContinue",
			CONTINUE_SCALE,
			this.boundContinue,
		);
		this.replayButton = this.createActionButton(
			"restart-001",
			"restart-002",
			"pauseReplay",
			ACTION_SCALE,
			this.boundReplay,
		);
		this.homeButton = this.createActionButton(
			"return-001",
			"return-002",
			"pauseHome",
			ACTION_SCALE,
			this.boundHome,
		);
		this.soundButton = this.createStateToggleButton(
			"pauseSound",
			this.boundSound,
		);
		this.musicButton = this.createStateToggleButton(
			"pauseMusic",
			this.boundMusic,
		);

		this.refreshToggleAppearance();
	}

	private createStateToggleButton(
		name: string,
		onUp: () => void,
	): Phaser.GameObjects.Image {
		const button = this.scene.add
			.image(0, 0, "sound-002")
			.setOrigin(0.5, 0.5)
			.setScale(TOGGLE_SCALE)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName(name)
			.setVisible(false)
			.setInteractive({ useHandCursor: true });
		this.ensureMinHitArea(button);
		button.on("pointerup", onUp);
		return button;
	}

	private createActionButton(
		defaultKey: string,
		pressedKey: string,
		name: string,
		scale: number,
		onUp: () => void,
	): Phaser.GameObjects.Image {
		const button = this.scene.add
			.image(0, 0, defaultKey)
			.setOrigin(0.5, 0.5)
			.setScale(scale)
			.setScrollFactor(0)
			.setDepth(OVERLAY_DEPTH + 3)
			.setName(name)
			.setVisible(false)
			.setInteractive({ useHandCursor: true });

		this.ensureMinHitArea(button);

		button.on("pointerover", () => {
			if (button.visible) {
				button.setTexture(pressedKey);
			}
		});
		button.on("pointerout", () => {
			button.setTexture(defaultKey);
		});
		button.on("pointerdown", () => {
			if (button.visible) {
				button.setTexture(pressedKey);
			}
		});
		button.on("pointerup", onUp);

		return button;
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

	private showOverlay(): void {
		this.buildOverlay();
		this._isVisible = true;
		this.homeArmed = true;
		this.replayArmed = true;
		this.soundArmed = true;
		this.musicArmed = true;
		this.setOverlayVisible(true);
		this.refreshToggleAppearance();
		this.layout();
	}

	private hideOverlay(): void {
		this._isVisible = false;
		this.setOverlayVisible(false);
		this.continueButton?.setTexture("continue-001");
		this.replayButton?.setTexture("restart-001");
		this.homeButton?.setTexture("return-001");
		this.refreshToggleAppearance();
	}

	private closeOverlayOnly(): void {
		this._isPaused = false;
		this.hideOverlay();
		this.setPauseButtonVisible(false);
		this.audio.clearPauseHold();
	}

	private setOverlayVisible(visible: boolean): void {
		this.overlay?.setVisible(visible);
		this.blocker?.setVisible(visible);
		this.title?.setVisible(visible);
		this.continueButton?.setVisible(visible);
		this.replayButton?.setVisible(visible);
		this.homeButton?.setVisible(visible);
		this.soundButton?.setVisible(visible);
		this.musicButton?.setVisible(visible);

		if (visible) {
			this.blocker?.setInteractive();
			this.continueButton?.setInteractive();
			if (this.replayArmed) {
				this.replayButton?.setInteractive();
			}
			if (this.homeArmed) {
				this.homeButton?.setInteractive();
			}
			this.soundButton?.setInteractive();
			this.musicButton?.setInteractive();
			this.refreshToggleAppearance();
		} else {
			this.blocker?.disableInteractive();
			this.continueButton?.disableInteractive();
			this.replayButton?.disableInteractive();
			this.homeButton?.disableInteractive();
			this.soundButton?.disableInteractive();
			this.musicButton?.disableInteractive();
		}
	}

	private setPauseButtonVisible(visible: boolean): void {
		if (!this.pauseButton) {
			return;
		}
		this.pauseButton.setVisible(visible);
		if (visible && this.pauseAllowed) {
			this.pauseButton.setInteractive();
			this.pauseButton.setTexture("pause-001");
		} else {
			this.pauseButton.disableInteractive();
		}
	}

	private layout(): void {
		if (this.destroyed) {
			return;
		}

		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		const cx = w * 0.5;
		const cy = h * 0.5;

		this.pauseButton?.setPosition(cx, PAUSE_BUTTON_Y);

		if (!this.overlayBuilt) {
			return;
		}

		this.overlay?.setPosition(cx, cy).setDisplaySize(w, h);
		this.blocker?.setPosition(cx, cy).setSize(w, h);
		if (this._isVisible) {
			this.blocker?.setInteractive();
		}

		this.title?.setPosition(cx, cy - 130);
		// Resume | Replay | Home — evenly spaced, no overlap at 1280×720.
		this.continueButton?.setPosition(cx - 160, cy - 10);
		this.replayButton?.setPosition(cx, cy - 10);
		this.homeButton?.setPosition(cx + 160, cy - 10);
		this.soundButton?.setPosition(cx - 90, cy + 130);
		this.musicButton?.setPosition(cx + 90, cy + 130);

		this.refreshHitAreas();
	}

	private refreshHitAreas(): void {
		const buttons = [
			this.pauseButton,
			this.continueButton,
			this.replayButton,
			this.homeButton,
			this.soundButton,
			this.musicButton,
		];
		for (const button of buttons) {
			if (!button || !button.visible || !button.input?.enabled) {
				continue;
			}
			this.ensureMinHitArea(button);
		}
	}

	private refreshToggleAppearance(): void {
		const sfxOn = this.audio.isSfxEnabled;
		const musicOn = this.audio.isMusicEnabled;
		this.soundButton
			?.setTexture(sfxOn ? "sound-002" : "sound-001")
			.setAlpha(sfxOn ? 1 : DISABLED_ALPHA);
		this.musicButton
			?.setTexture(musicOn ? "music-002" : "music-001")
			.setAlpha(musicOn ? 1 : DISABLED_ALPHA);
	}

	private registerKeyboard(): void {
		const keyboard = this.scene.input.keyboard;
		if (!keyboard) {
			return;
		}
		keyboard.on("keydown-P", this.boundToggleKey);
		keyboard.on("keydown-ESC", this.boundToggleKey);
	}

	private unregisterKeyboard(): void {
		const keyboard = this.scene.input.keyboard;
		if (!keyboard) {
			return;
		}
		keyboard.off("keydown-P", this.boundToggleKey);
		keyboard.off("keydown-ESC", this.boundToggleKey);
	}

	private handleToggleKey(event: KeyboardEvent): void {
		if (this.destroyed || !this.pauseAllowed) {
			return;
		}
		event.preventDefault();
		this.toggle();
	}

	private handlePauseButton(): void {
		if (this.destroyed || !this.pauseAllowed || this._isPaused) {
			return;
		}
		this.pauseButton?.setTexture("pause-001");
		this.pause();
	}

	private handleContinue(): void {
		if (this.destroyed || !this._isPaused || !this.pauseAllowed) {
			return;
		}
		this.audio.playButtonSfx();
		this.resume();
	}

	private handleReplay(): void {
		if (this.destroyed || !this._isPaused || !this.replayArmed) {
			return;
		}
		this.replayArmed = false;
		this.replayButton?.disableInteractive();
		this.audio.playButtonSfx();

		// Close overlay and restore systems before restart (same as Play Again).
		this._isPaused = false;
		this.hideOverlay();
		this.setPauseButtonVisible(false);
		this.pauseAllowed = false;
		this.audio.clearPauseHold();
		this.onPausedChanged(false);
		this.onReplay();
	}

	private handleHome(): void {
		if (this.destroyed || !this._isPaused || !this.homeArmed) {
			return;
		}
		this.homeArmed = false;
		this.homeButton?.disableInteractive();
		this.audio.playButtonSfx();

		// Close overlay without resuming gameplay; abort via Level.
		this._isPaused = false;
		this.hideOverlay();
		this.setPauseButtonVisible(false);
		this.pauseAllowed = false;
		this.audio.clearPauseHold();
		this.onHome();
	}

	private handleSoundToggle(): void {
		if (this.destroyed || !this._isVisible || !this.soundArmed) {
			return;
		}
		this.soundArmed = false;
		const turningOn = !this.audio.isSfxEnabled;
		this.audio.toggleSfx();
		this.refreshToggleAppearance();
		if (turningOn) {
			this.audio.playButtonSfx();
		}
		this.scene.time.delayedCall(120, () => {
			if (!this.destroyed && this._isVisible) {
				this.soundArmed = true;
			}
		});
	}

	private handleMusicToggle(): void {
		if (this.destroyed || !this._isVisible || !this.musicArmed) {
			return;
		}
		this.musicArmed = false;
		this.audio.toggleMusic();
		this.refreshToggleAppearance();
		this.audio.playButtonSfx();
		this.scene.time.delayedCall(120, () => {
			if (!this.destroyed && this._isVisible) {
				this.musicArmed = true;
			}
		});
	}

	private handleGameEnding(): void {
		if (this.destroyed) {
			return;
		}
		this.pauseAllowed = false;
		if (this._isPaused || this._isVisible) {
			this.closeOverlayOnly();
		}
		this.setPauseButtonVisible(false);
	}

	private handleGameFinished(): void {
		if (this.destroyed) {
			return;
		}
		this.pauseAllowed = false;
		if (this._isPaused || this._isVisible) {
			this.closeOverlayOnly();
		}
		this.setPauseButtonVisible(false);
	}

	private teardownPauseButton(): void {
		this.pauseButton?.off("pointerup", this.boundPauseButton);
		this.pauseButton?.destroy();
		this.pauseButton = undefined;
	}

	private teardownOverlay(): void {
		this.continueButton?.off("pointerup", this.boundContinue);
		this.replayButton?.off("pointerup", this.boundReplay);
		this.homeButton?.off("pointerup", this.boundHome);
		this.soundButton?.off("pointerup", this.boundSound);
		this.musicButton?.off("pointerup", this.boundMusic);

		this.continueButton?.destroy();
		this.replayButton?.destroy();
		this.homeButton?.destroy();
		this.soundButton?.destroy();
		this.musicButton?.destroy();
		this.title?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();

		this.continueButton = undefined;
		this.replayButton = undefined;
		this.homeButton = undefined;
		this.soundButton = undefined;
		this.musicButton = undefined;
		this.title = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
		this.overlayBuilt = false;
	}
}
