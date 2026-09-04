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
const ACTION_BUTTON_SCALE = 1.05;
const CONTINUE_SCALE = 0.9;
const TOGGLE_SCALE = 0.7;
const MIN_HIT = 48;

export interface PauseControllerOptions {
	/** True only while the round is actively playable (not ending/finished). */
	canPause: () => boolean;
	/** Apply/clear explicit gameplay freeze (controllers + audio pause bus). */
	onPausedChanged: (paused: boolean) => void;
	/** Scene restart after full cleanup; PauseController destroys itself first. */
	onRestart: () => void;
}

/**
 * In-game pause HUD button + overlay (Continue / Restart / Music / Sound).
 * Does not call scene.pause() — overlay stays interactive in the same scene.
 */
export class PauseController {
	private readonly scene: Phaser.Scene;
	private readonly audio: AudioController;
	private readonly canPauseFn: () => boolean;
	private readonly onPausedChanged: (paused: boolean) => void;
	private readonly onRestart: () => void;

	private readonly boundToggleKey = this.handleToggleKey.bind(this);
	private readonly boundResize = this.layout.bind(this);
	private readonly boundEnding = this.handleGameEnding.bind(this);
	private readonly boundFinished = this.handleGameFinished.bind(this);
	private readonly boundPauseButton = this.handlePauseButton.bind(this);
	private readonly boundContinue = this.handleContinue.bind(this);
	private readonly boundRestart = this.handleRestart.bind(this);
	private readonly boundMusic = this.handleMusicToggle.bind(this);
	private readonly boundSound = this.handleSoundToggle.bind(this);

	private pauseButton?: Phaser.GameObjects.Image;
	private overlay?: Phaser.GameObjects.Image;
	private blocker?: Phaser.GameObjects.Rectangle;
	private title?: Phaser.GameObjects.Image;
	private continueButton?: Phaser.GameObjects.Image;
	private restartButton?: Phaser.GameObjects.Image;
	private musicButton?: Phaser.GameObjects.Image;
	private soundButton?: Phaser.GameObjects.Image;

	private _isPaused = false;
	private _isVisible = false;
	private destroyed = false;
	private pauseAllowed = true;
	private restartArmed = true;
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
		this.onRestart = options.onRestart;

		this.requireTextures();
		this.buildPauseButton();
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
		// Game-finished force-close must not resume gameplay.
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

		// Do not resume audio/gameplay on destroy (restart / shutdown while paused).
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
			"music-001",
			"music-002",
			"sound-001",
			"sound-002",
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
		this.restartButton = this.createActionButton(
			"restart-001",
			"restart-002",
			"pauseRestart",
			ACTION_BUTTON_SCALE,
			this.boundRestart,
		);
		this.musicButton = this.createActionButton(
			"music-001",
			"music-002",
			"pauseMusic",
			TOGGLE_SCALE,
			this.boundMusic,
		);
		this.soundButton = this.createActionButton(
			"sound-001",
			"sound-002",
			"pauseSound",
			TOGGLE_SCALE,
			this.boundSound,
		);

		this.refreshToggleAlphas();
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
		button.input!.cursor = "pointer";
	}

	private showOverlay(): void {
		this.buildOverlay();
		this._isVisible = true;
		this.restartArmed = true;
		this.setOverlayVisible(true);
		this.refreshToggleAlphas();
		this.layout();
	}

	private hideOverlay(): void {
		this._isVisible = false;
		this.setOverlayVisible(false);
		this.continueButton?.setTexture("continue-001");
		this.restartButton?.setTexture("restart-001");
		this.musicButton?.setTexture("music-001");
		this.soundButton?.setTexture("sound-001");
	}

	/** Close overlay + clear paused flag without resuming gameplay. */
	private closeOverlayOnly(): void {
		this._isPaused = false;
		this.hideOverlay();
		this.setPauseButtonVisible(false);
		// Allow GameOver result SFX / music fade without resuming winch/music.
		this.audio.clearPauseHold();
	}

	private setOverlayVisible(visible: boolean): void {
		this.overlay?.setVisible(visible);
		this.blocker?.setVisible(visible);
		this.title?.setVisible(visible);
		this.continueButton?.setVisible(visible);
		this.restartButton?.setVisible(visible);
		this.musicButton?.setVisible(visible);
		this.soundButton?.setVisible(visible);

		if (visible) {
			this.blocker?.setInteractive();
			this.continueButton?.setInteractive();
			if (this.restartArmed) {
				this.restartButton?.setInteractive();
			}
			this.musicButton?.setInteractive();
			this.soundButton?.setInteractive();
		} else {
			this.blocker?.disableInteractive();
			this.continueButton?.disableInteractive();
			this.restartButton?.disableInteractive();
			this.musicButton?.disableInteractive();
			this.soundButton?.disableInteractive();
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

		this.title?.setPosition(cx, cy - 120);
		this.continueButton?.setPosition(cx - 130, cy + 10);
		this.restartButton?.setPosition(cx + 130, cy + 10);
		this.musicButton?.setPosition(cx - 70, cy + 145);
		this.soundButton?.setPosition(cx + 70, cy + 145);

		this.refreshHitAreas();
	}

	private refreshHitAreas(): void {
		const buttons = [
			this.pauseButton,
			this.continueButton,
			this.restartButton,
			this.musicButton,
			this.soundButton,
		];
		for (const button of buttons) {
			if (!button || !button.visible || !button.input?.enabled) {
				continue;
			}
			this.ensureMinHitArea(button);
		}
	}

	private refreshToggleAlphas(): void {
		this.musicButton?.setAlpha(
			this.audio.isMusicEnabled ? 1 : DISABLED_ALPHA,
		);
		this.soundButton?.setAlpha(
			this.audio.isSfxEnabled ? 1 : DISABLED_ALPHA,
		);
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

	private handleRestart(): void {
		if (this.destroyed || !this._isPaused || !this.restartArmed) {
			return;
		}
		this.restartArmed = false;
		this.audio.playButtonSfx();
		this.restartButton?.disableInteractive();
		this.onRestart();
	}

	private handleMusicToggle(): void {
		if (this.destroyed || !this._isVisible) {
			return;
		}
		this.audio.toggleMusic();
		this.refreshToggleAlphas();
		this.musicButton?.setTexture("music-001");
	}

	private handleSoundToggle(): void {
		if (this.destroyed || !this._isVisible) {
			return;
		}
		this.audio.toggleSfx();
		this.refreshToggleAlphas();
		this.soundButton?.setTexture("sound-001");
		// Intentionally no confirmation SFX (especially when turning SFX off).
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
		this.restartButton?.off("pointerup", this.boundRestart);
		this.musicButton?.off("pointerup", this.boundMusic);
		this.soundButton?.off("pointerup", this.boundSound);

		this.continueButton?.destroy();
		this.restartButton?.destroy();
		this.musicButton?.destroy();
		this.soundButton?.destroy();
		this.title?.destroy();
		this.blocker?.destroy();
		this.overlay?.destroy();

		this.continueButton = undefined;
		this.restartButton = undefined;
		this.musicButton = undefined;
		this.soundButton = undefined;
		this.title = undefined;
		this.blocker = undefined;
		this.overlay = undefined;
		this.overlayBuilt = false;
	}
}
