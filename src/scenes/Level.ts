
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
/* START-USER-IMPORTS */
import { HookController } from "../game/HookController";
import { CreatureSpawner } from "../game/CreatureSpawner";
import { CatchController } from "../game/CatchController";
import { CatchFeedbackController } from "../game/CatchFeedbackController";
import {
	GameSession,
	GAME_ENDING_EVENT,
} from "../game/GameSession";
import { GameOverController } from "../game/GameOverController";
import { HudController } from "../game/HudController";
import { ItemSpawner } from "../game/ItemSpawner";
import { AudioController } from "../game/AudioController";
import { PauseController } from "../game/PauseController";
import { HomeController } from "../game/HomeController";
import { FlutterGameBridge } from "../game/FlutterGameBridge";
import { ActiveTypeRegistry } from "../game/ActiveTypeRegistry";
import { EnvironmentEffects } from "../game/EnvironmentEffects";
import {
	consumeLevelBootIntent,
	setLevelBootIntent,
} from "../game/LevelBoot";
import { DEBUG_PULL_SPEED } from "../game/config/CreatureBalance";
/* END-USER-IMPORTS */

export default class Level extends Phaser.Scene {

	constructor() {
		super("Level");

		/* START-USER-CTR-CODE */
		// Write your code here.
		/* END-USER-CTR-CODE */
	}

	editorCreate(): void {

		// gameBackground
		const gameBackground = this.add.image(642, 295.3333333333333, "game-bg");
		gameBackground.scaleX = 0.9548611111111112;
		gameBackground.scaleY = 0.8950892857142857;

		// water
		const water = this.add.image(650.6666666666666, 276, "bg");
		water.scaleX = 0.6840277777777778;
		water.scaleY = 0.7015625;
		water.setOrigin(0.5, 0.01687116564417178);

		// player
		const player = this.add.image(638.9688750209934, 289.0012601206786, "fisherman-idle");
		player.scaleX = 0.72842474;
		player.scaleY = 0.72842474;
		player.setOrigin(0.676, 0.8228228228228228);

		// rope
		const rope = this.add.image(640, 289.48717830155135, "hook-sine");
		rope.scaleX = 0.675929855162;
		rope.scaleY = 0.660344053;
		rope.setOrigin(0.5, 0);

		// hookLeft
		const hookLeft = this.add.image(632.9036995365968, 347.1169994301449, "hook-left");
		hookLeft.scaleX = 0.6666666666666666;
		hookLeft.scaleY = 0.6666666666666666;
		hookLeft.angle = 5;
		hookLeft.setOrigin(0.78125, 0.146341);

		// hookRight
		const hookRight = this.add.image(646.1641161388904, 347.01283278922745, "hook-right");
		hookRight.scaleX = 0.6666666666666666;
		hookRight.scaleY = 0.6666666666666666;
		hookRight.angle = 355;
		hookRight.setOrigin(0.171875, 0.146341);

		this.gameBackground = gameBackground;
		this.water = water;
		this.player = player;
		this.rope = rope;
		this.hookLeft = hookLeft;
		this.hookRight = hookRight;

		this.events.emit("scene-awake");
	}

	public gameBackground!: Phaser.GameObjects.Image;
	public water!: Phaser.GameObjects.Image;
	public player!: Phaser.GameObjects.Image;
	public rope!: Phaser.GameObjects.Image;
	public hookLeft!: Phaser.GameObjects.Image;
	public hookRight!: Phaser.GameObjects.Image;

	/* START-USER-CODE */

	private hookController!: HookController;
	private creatureSpawner!: CreatureSpawner;
	private catchController!: CatchController;
	private catchFeedbackController!: CatchFeedbackController;
	private gameSession!: GameSession;
	private gameOverController!: GameOverController;
	private hudController!: HudController;
	private itemSpawner!: ItemSpawner;
	private activeTypes!: ActiveTypeRegistry;
	private environmentEffects?: EnvironmentEffects;
	private audioController?: AudioController;
	private pauseController!: PauseController;
	private homeController?: HomeController;
	private readonly boundGameEnding = this.handleGameEnding.bind(this);
	private endingHandled = false;
	/** Discard first gameplay delta after resume to avoid a large frame jump. */
	private skipNextGameplayDelta = false;

	create() {
		this.editorCreate();
		this.endingHandled = false;
		this.skipNextGameplayDelta = false;

		const bootIntent = consumeLevelBootIntent();

		// Scene restart can re-enter create(); destroy any surviving owner first.
		this.audioController?.destroy();
		this.homeController?.destroy();
		this.homeController = undefined;
		this.environmentEffects?.destroy();
		this.environmentEffects = undefined;
		this.activeTypes?.destroy();

		this.activeTypes = new ActiveTypeRegistry();
		this.itemSpawner = this.createItemSpawner();
		this.hookController = this.createHookController();
		this.creatureSpawner = this.createCreatureSpawner();
		this.environmentEffects = new EnvironmentEffects(
			this,
			this.player,
			this.water,
		);
		this.catchController = this.createCatchController();
		this.gameSession = new GameSession(this);
		this.exposePullDebugBridge();
		this.catchFeedbackController = new CatchFeedbackController(this);
		this.hudController = new HudController(this);
		this.hudController.setVisible(false);
		this.audioController = new AudioController(this);
		this.gameOverController = new GameOverController(this, {
			audio: this.audioController,
			onPlayAgain: () => this.handleResultPlayAgain(),
			onHome: () => this.handleResultHome(),
		});
		this.pauseController = new PauseController(this, this.audioController, {
			canPause: () =>
				this.gameSession.state === "playing" && !this.endingHandled,
			onPausedChanged: (paused) => this.applyGameplayPaused(paused),
			onHome: () => this.handlePauseHome(),
			onReplay: () => this.handlePauseReplay(),
		});
		this.pauseController.setGameplayActive(false);

		this.applyDisplayDepths();

		this.events.on(GAME_ENDING_EVENT, this.boundGameEnding);

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.events.off(GAME_ENDING_EVENT, this.boundGameEnding);
			this.homeController?.destroy();
			this.homeController = undefined;
			this.pauseController?.destroy();
			this.audioController?.destroy();
			this.audioController = undefined;
			this.gameOverController?.destroy();
			this.hudController?.destroy();
			this.catchFeedbackController?.destroy();
			this.gameSession?.destroy();
			this.catchController?.destroy();
			this.creatureSpawner?.destroy();
			this.itemSpawner?.destroy();
			this.environmentEffects?.destroy();
			this.environmentEffects = undefined;
			this.activeTypes?.destroy();
		});

		if (bootIntent === "playAgain") {
			// Play Again: skip Home, start one clean gameplay session immediately.
			this.beginGameplaySession({ playButtonSfx: false });
		} else {
			this.homeController = new HomeController(this, {
				audio: this.audioController,
				onPlay: () => this.handleHomePlay(),
			});
			// Home must be silent — preference only, no BGM request.
			this.audioController.enterHomeScreen();
		}
	}

	update(time: number, delta: number): void {
		if (this.homeController?.isVisible) {
			return;
		}
		if (this.gameOverController?.isVisible) {
			return;
		}
		if (this.pauseController?.isPaused) {
			return;
		}
		if (this.gameSession.isReady) {
			return;
		}

		let gameplayDelta = delta;
		if (this.skipNextGameplayDelta) {
			gameplayDelta = 0;
			this.skipNextGameplayDelta = false;
		}

		this.environmentEffects?.update(time, gameplayDelta);
		// HookController is the single owner of hook extension/position.
		// Catch runs after it so a claim uses this frame's hook pose, exactly once.
		this.hookController.update(time, gameplayDelta);
		this.creatureSpawner.update(time, gameplayDelta);
		this.itemSpawner.update(time, gameplayDelta);
		this.catchController.update(time, gameplayDelta);
		this.gameSession.update(time, gameplayDelta);

		// After timer zero: wait until hook is safely SWINGING, then finish.
		if (
			this.gameSession.isEnding &&
			this.hookController.isAtRest
		) {
			this.gameSession.completeEnding();
		}
	}

	private handleHomePlay(): void {
		if (!this.gameSession.isReady) {
			return;
		}
		this.homeController = undefined;
		this.beginGameplaySession({ playButtonSfx: true });
	}

	/**
	 * Shared ready → playing transition (Home Play and Result Play Again).
	 */
	private beginGameplaySession(options: { playButtonSfx: boolean }): void {
		const audio = this.audioController;
		if (!audio || !this.gameSession.isReady) {
			return;
		}

		audio.notifyGameplayStarted();
		audio.unlockFromGesture();
		if (options.playButtonSfx) {
			audio.playButtonSfx();
		}

		const started = this.gameSession.startGame();
		if (!started) {
			return;
		}

		this.hookController.beginGameplay();
		this.environmentEffects?.beginGameplay();
		this.creatureSpawner.beginSpawning();
		this.itemSpawner.beginSpawning(this.creatureSpawner.getActiveCenters());
		this.catchController.setPaused(false);
		this.hudController.setVisible(true);
		this.pauseController.setGameplayActive(true);

		FlutterGameBridge.sendGameStarted({
			gameSessionId: this.gameSession.gameSessionId,
			durationSeconds: GameSession.DURATION_SECONDS,
		});

		this.skipNextGameplayDelta = true;
	}

	private applyGameplayPaused(paused: boolean): void {
		this.gameSession.setPaused(paused);
		this.hookController.setPaused(paused);
		this.environmentEffects?.setPaused(paused);
		this.creatureSpawner.setPaused(paused);
		this.itemSpawner.setPaused(paused);
		this.catchController.setPaused(paused);
		this.catchFeedbackController.setPaused(paused);

		const audio = this.audioController;
		if (!audio) {
			return;
		}
		if (paused) {
			audio.onPauseOverlayOpened();
		} else {
			audio.onPauseOverlayClosed({
				resumeWinch: this.hookController.isRetracting,
			});
			this.skipNextGameplayDelta = true;
		}
	}

	private handlePauseHome(): void {
		// Abort mid-run: no GAME_FINISHED, no score save/submit.
		this.endingHandled = true;
		this.pauseController.setGameplayActive(false);
		const audio = this.audioController;
		if (audio) {
			audio.clearPauseHold();
			audio.enterHomeScreen();
		}
		setLevelBootIntent("home");
		this.scene.restart();
	}

	/** Pause → Replay: same clean restart path as Game Over → Play Again. */
	private handlePauseReplay(): void {
		this.endingHandled = true;
		this.pauseController.setGameplayActive(false);
		this.audioController?.clearPauseHold();
		setLevelBootIntent("playAgain");
		this.scene.restart();
	}

	private handleResultPlayAgain(): void {
		setLevelBootIntent("playAgain");
		this.scene.restart();
	}

	private handleResultHome(): void {
		const audio = this.audioController;
		if (audio) {
			audio.enterHomeScreen();
		}
		setLevelBootIntent("home");
		this.scene.restart();
	}

	private handleGameEnding(): void {
		if (this.endingHandled) {
			return;
		}
		this.endingHandled = true;

		this.hookController.setInputEnabled(false);
		this.creatureSpawner.setEnabled(false);
		this.creatureSpawner.setPaused(true);
		this.itemSpawner.setEnabled(false);
		this.itemSpawner.setPaused(true);
		this.catchFeedbackController.setPaused(true);
		this.pauseController.setGameplayActive(false);

		if (this.hookController.state === "SWINGING") {
			this.gameSession.completeEnding();
			return;
		}

		if (this.hookController.state === "CASTING") {
			// Empty cast: pull back. If CatchController already claimed a target,
			// state is RETRACTING and this no-ops.
			this.hookController.forceEmptyRetractIfCasting();
		}
		// RETRACTING: continue; CatchController delivers once at boat.
	}

	/**
	 * Temporary pull-speed diagnostics (DEBUG_PULL_SPEED only): lets a dev
	 * console inspect the live controllers and verify one hook owner exists.
	 */
	private exposePullDebugBridge(): void {
		if (!DEBUG_PULL_SPEED) {
			return;
		}
		(
			window as unknown as { __ffPullDebug?: unknown }
		).__ffPullDebug = {
			scene: this,
			hook: this.hookController,
			catch: this.catchController,
			creatures: this.creatureSpawner,
		};
	}

	private createHookController(): HookController {
		const rope = this.rope;
		const hookLeft = this.hookLeft;
		const hookRight = this.hookRight;

		if (!rope || !hookLeft || !hookRight) {
			throw new Error(
				"Level is missing required hook assembly objects: rope, hookLeft, and hookRight must exist.",
			);
		}

		return new HookController(this, rope, hookLeft, hookRight, this.player);
	}

	private createCreatureSpawner(): CreatureSpawner {
		const water = this.water;
		if (!water) {
			throw new Error(
				"Level is missing required scene object: water must exist for creature spawning.",
			);
		}
		const boatAnchor = this.rope
			? { x: this.rope.x }
			: { x: this.player?.x ?? this.scale.width * 0.5 };
		return new CreatureSpawner(this, water, this.activeTypes, boatAnchor);
	}

	private createItemSpawner(): ItemSpawner {
		const water = this.water;
		if (!water) {
			throw new Error(
				"Level is missing required scene object: water must exist for item spawning.",
			);
		}
		const boatAnchor = this.rope
			? { x: this.rope.x, y: this.rope.y }
			: { x: this.player?.x ?? this.scale.width * 0.5, y: water.y };
		return new ItemSpawner(this, water, this.activeTypes, boatAnchor);
	}

	private createCatchController(): CatchController {
		const catchController = new CatchController(
			this,
			this.hookController,
			this.creatureSpawner,
			this.itemSpawner,
		);
		// Inactive until Home → Play.
		catchController.setPaused(true);
		return catchController;
	}

	/** Background < items < creatures < player / hook. HUD 1000. Overlay 1500+. */
	private applyDisplayDepths(): void {
		this.gameBackground?.setDepth(0);
		this.water?.setDepth(1);
		this.player?.setDepth(10);

		const hookParent = this.rope?.parentContainer;
		if (hookParent) {
			hookParent.setDepth(20);
		}
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
