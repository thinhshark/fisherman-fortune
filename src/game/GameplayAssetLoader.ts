import Phaser from "phaser";

export const GAMEPLAY_ASSETS_READY_EVENT = "gameplay-assets-ready";
export const GAMEPLAY_ASSETS_PROGRESS_EVENT = "gameplay-assets-progress";
export const MUSIC_READY_EVENT = "music-ready";

const REG_READY = "ff.gameplayAssetsReady";
const REG_LOADING = "ff.gameplayAssetsLoading";
const REG_MUSIC_READY = "ff.musicReady";
const REG_MUSIC_LOADING = "ff.musicLoading";

export interface GameplayAssetsProgressPayload {
	progress: number;
}

/**
 * Background loader for gameplay pack + on-demand game music.
 * State lives on game.registry so scene restarts stay idempotent.
 */
export class GameplayAssetLoader {
	static isGameplayReady(scene: Phaser.Scene): boolean {
		return scene.game.registry.get(REG_READY) === true;
	}

	static isMusicReady(scene: Phaser.Scene): boolean {
		return (
			scene.game.registry.get(REG_MUSIC_READY) === true ||
			scene.cache.audio.exists("music-game")
		);
	}

	/** Start gameplay pack if needed (safe to call from Level.create). */
	static ensureGameplayLoading(scene: Phaser.Scene): void {
		if (GameplayAssetLoader.isGameplayReady(scene)) {
			scene.events.emit(GAMEPLAY_ASSETS_READY_EVENT);
			return;
		}
		if (scene.game.registry.get(REG_LOADING) === true) {
			return;
		}

		scene.game.registry.set(REG_LOADING, true);

		const onProgress = (value: number) => {
			scene.events.emit(GAMEPLAY_ASSETS_PROGRESS_EVENT, {
				progress: value,
			} satisfies GameplayAssetsProgressPayload);
			scene.game.events.emit(GAMEPLAY_ASSETS_PROGRESS_EVENT, {
				progress: value,
			} satisfies GameplayAssetsProgressPayload);
		};

		const onComplete = () => {
			scene.load.off("progress", onProgress);
			scene.game.registry.set(REG_READY, true);
			scene.game.registry.set(REG_LOADING, false);
			scene.events.emit(GAMEPLAY_ASSETS_READY_EVENT);
			scene.game.events.emit(GAMEPLAY_ASSETS_READY_EVENT);
		};

		scene.load.pack("gameplay-asset-pack", "assets/gameplay-asset-pack.json");
		scene.load.on("progress", onProgress);
		scene.load.once("complete", onComplete);
		scene.load.start();
	}

	/**
	 * Load BGM after Play. No-op if already cached.
	 * Emits MUSIC_READY_EVENT when available.
	 */
	static ensureMusicLoading(scene: Phaser.Scene): void {
		if (GameplayAssetLoader.isMusicReady(scene)) {
			scene.game.registry.set(REG_MUSIC_READY, true);
			scene.events.emit(MUSIC_READY_EVENT);
			return;
		}
		if (scene.game.registry.get(REG_MUSIC_LOADING) === true) {
			return;
		}

		scene.game.registry.set(REG_MUSIC_LOADING, true);
		scene.load.audio("music-game", [
			"assets/audio/music/game-music.ogg",
			"assets/audio/music/game-music.mp3",
		]);
		scene.load.once("complete", () => {
			scene.game.registry.set(REG_MUSIC_READY, true);
			scene.game.registry.set(REG_MUSIC_LOADING, false);
			scene.events.emit(MUSIC_READY_EVENT);
			scene.game.events.emit(MUSIC_READY_EVENT);
		});
		scene.load.start();
	}
}
