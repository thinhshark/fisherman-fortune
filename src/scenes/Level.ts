
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
/* START-USER-IMPORTS */
import { HookController } from "../game/HookController";
import { CreatureSpawner } from "../game/CreatureSpawner";
import { CatchController } from "../game/CatchController";
import { CatchFeedbackController } from "../game/CatchFeedbackController";
import { GameSession, GAME_ENDING_EVENT } from "../game/GameSession";
import { GameOverController } from "../game/GameOverController";
import { HudController } from "../game/HudController";
import { ItemSpawner } from "../game/ItemSpawner";
import { AudioController } from "../game/AudioController";
import { PauseController } from "../game/PauseController";
import { FlutterGameBridge } from "../game/FlutterGameBridge";
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
	private audioController!: AudioController;
	private pauseController!: PauseController;
	private readonly boundGameEnding = this.handleGameEnding.bind(this);
	private endingHandled = false;
	/** Discard first gameplay delta after resume to avoid a large frame jump. */
	private skipNextGameplayDelta = false;

	create() {
		this.editorCreate();
		this.endingHandled = false;
		this.skipNextGameplayDelta = false;
		this.itemSpawner = this.createItemSpawner();
		this.hookController = this.createHookController();
		this.creatureSpawner = this.createCreatureSpawner();
		this.catchController = this.createCatchController();
		this.gameSession = new GameSession(this);
		this.catchFeedbackController = new CatchFeedbackController(this);
		this.hudController = new HudController(this);
		this.audioController = new AudioController(this);
		this.gameOverController = new GameOverController(
			this,
			this.audioController,
		);
		this.pauseController = new PauseController(this, this.audioController, {
			canPause: () =>
				this.gameSession.state === "playing" && !this.endingHandled,
			onPausedChanged: (paused) => this.applyGameplayPaused(paused),
			onRestart: () => this.handlePauseRestart(),
		});
		this.applyDisplayDepths();

		this.events.on(GAME_ENDING_EVENT, this.boundGameEnding);

		this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
			this.events.off(GAME_ENDING_EVENT, this.boundGameEnding);
			this.pauseController.destroy();
			this.audioController.destroy();
			this.gameOverController.destroy();
			this.hudController.destroy();
			this.catchFeedbackController.destroy();
			this.gameSession.destroy();
			this.catchController.destroy();
			this.creatureSpawner.destroy();
			this.itemSpawner.destroy();
		});
	}

	update(time: number, delta: number): void {
		if (this.pauseController?.isPaused) {
			return;
		}

		let gameplayDelta = delta;
		if (this.skipNextGameplayDelta) {
			gameplayDelta = 0;
			this.skipNextGameplayDelta = false;
		}

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

	private applyGameplayPaused(paused: boolean): void {
		this.gameSession.setPaused(paused);
		this.hookController.setPaused(paused);
		this.creatureSpawner.setPaused(paused);
		this.itemSpawner.setPaused(paused);
		this.catchController.setPaused(paused);
		this.catchFeedbackController.setPaused(paused);

		if (paused) {
			this.audioController.pauseAll();
		} else {
			this.audioController.resumeAll({
				resumeWinch: this.hookController.isRetracting,
			});
			this.skipNextGameplayDelta = true;
		}
	}

	private handlePauseRestart(): void {
		FlutterGameBridge.sendRestartGame(this.gameSession.gameSessionId);
		// SHUTDOWN destroys PauseController without resuming old audio.
		this.scene.restart();
	}

	private handleGameEnding(): void {
		if (this.endingHandled) {
			return;
		}
		this.endingHandled = true;

		this.hookController.setInputEnabled(false);
		this.creatureSpawner.setEnabled(false);
		this.itemSpawner.setEnabled(false);

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

	private createHookController(): HookController {
		const rope = this.rope;
		const hookLeft = this.hookLeft;
		const hookRight = this.hookRight;

		if (!rope || !hookLeft || !hookRight) {
			throw new Error(
				"Level is missing required hook assembly objects: rope, hookLeft, and hookRight must exist.",
			);
		}

		return new HookController(this, rope, hookLeft, hookRight);
	}

	private createCreatureSpawner(): CreatureSpawner {
		const water = this.water;
		if (!water) {
			throw new Error(
				"Level is missing required scene object: water must exist for creature spawning.",
			);
		}
		return new CreatureSpawner(this, water);
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
		return new ItemSpawner(this, water, boatAnchor);
	}

	private createCatchController(): CatchController {
		return new CatchController(
			this,
			this.hookController,
			this.creatureSpawner,
			this.itemSpawner,
		);
	}

	/** Background < items < creatures < player / hook. HUD 1000. Overlay 2000+. */
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
