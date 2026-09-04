import Phaser from "phaser";
import Level from "./scenes/Level";
import Preload from "./scenes/Preload";

class Boot extends Phaser.Scene {

    constructor() {
        super("Boot");
    }

    preload() {

        this.load.pack("pack", "assets/preload-asset-pack.json");
    }

    create() {

       this.scene.start("Preload");
    }
}

let gameBooted = false;

function startGame(): void {
	if (gameBooted) {
		return;
	}
	gameBooted = true;

	const game = new Phaser.Game({
		width: 1280,
		height: 720,
		backgroundColor: "#2f2f2f",
		parent: "game-container",
		scale: {
			mode: Phaser.Scale.ScaleModes.FIT,
			autoCenter: Phaser.Scale.Center.CENTER_BOTH
		},
		scene: [Boot, Preload, Level]
	});

	game.scene.start("Boot");
}

if (document.readyState === "complete") {
	startGame();
} else {
	window.addEventListener("load", startGame, { once: true });
}
