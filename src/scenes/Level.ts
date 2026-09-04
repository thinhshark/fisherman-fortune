
// You can write more code here

/* START OF COMPILED CODE */

import Phaser from "phaser";
/* START-USER-IMPORTS */
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

	// Write your code here

	create() {

		this.editorCreate();
	}

	/* END-USER-CODE */
}

/* END OF COMPILED CODE */

// You can write more code here
