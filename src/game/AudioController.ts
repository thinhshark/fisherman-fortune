import Phaser from "phaser";
import { getCreatureById } from "./CreatureCatalog";
import { getItemById } from "./ItemCatalog";
import { AudioSettings } from "./config/AudioSettings";
import {
	HOOK_STATE_CHANGED_EVENT,
	type HookStateChangedPayload,
} from "./HookController";
import {
	GAME_FINISHED_EVENT,
	SCORE_CHANGED_EVENT,
	TIME_BONUS_EVENT,
	TIME_CHANGED_EVENT,
	type GameFinishedPayload,
	type ScoreChangedPayload,
	type TimeBonusPayload,
	type TimeChangedPayload,
} from "./GameSession";

/**
 * Single owner of Level background music + SFX.
 *
 * Prefs:
 * - fisherman-fortune-sfx-enabled-v1
 * - fisherman-fortune-music-enabled-v1
 *
 * Home is always silent (no BGM). Gameplay uses music-game only.
 * Winch is the only looping SFX.
 */

/** Set true while diagnosing live SoundManager duplication. */
const DEBUG_AUDIO = false;

const MUSIC_GAME_KEY = "music-game";
/** Asset exists but must never be requested/played as Home BGM. */
const MUSIC_STORY_KEY = "music-story";
const WINCH_KEY = "sfx-winch";
const CATCH_VOLUME_SCALE = 0.35;

const BGM_KEYS = [MUSIC_GAME_KEY, MUSIC_STORY_KEY] as const;

export const SFX_PREF_KEY_V1 = "fisherman-fortune-sfx-enabled-v1";
export const MUSIC_PREF_KEY_V1 = "fisherman-fortune-music-enabled-v1";
export const AUDIO_PREF_KEY_COMBINED = "fisherman-fortune-audio-enabled-v1";

export const GAME_MUSIC_KEY = MUSIC_GAME_KEY;

let nextAudioInstanceId = 1;

type ScreenMode = "home" | "gameplay" | "paused" | "gameover";

function writePref(key: string, value: boolean): void {
	try {
		globalThis.localStorage?.setItem(key, value ? "true" : "false");
	} catch {
		/* ignore */
	}
}

function readBoolPref(key: string): boolean | undefined {
	try {
		const raw = globalThis.localStorage?.getItem(key);
		if (raw === "true") {
			return true;
		}
		if (raw === "false") {
			return false;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function readSeparatedPrefs(fallback: boolean): {
	sfx: boolean;
	music: boolean;
} {
	const sfxStored = readBoolPref(SFX_PREF_KEY_V1);
	const musicStored = readBoolPref(MUSIC_PREF_KEY_V1);
	if (sfxStored !== undefined && musicStored !== undefined) {
		return { sfx: sfxStored, music: musicStored };
	}

	const combined = readBoolPref(AUDIO_PREF_KEY_COMBINED);
	const migrated = combined ?? fallback;
	if (sfxStored === undefined) {
		writePref(SFX_PREF_KEY_V1, migrated);
	}
	if (musicStored === undefined) {
		writePref(MUSIC_PREF_KEY_V1, migrated);
	}
	return {
		sfx: sfxStored ?? migrated,
		music: musicStored ?? migrated,
	};
}

/**
 * Exclusive owner of one looping gameplay BGM instance + one-shot / winch SFX.
 */
export class AudioController {
	private readonly scene: Phaser.Scene;
	private readonly instanceId = nextAudioInstanceId++;

	private sfxEnabled: boolean;
	private musicEnabled: boolean;
	private destroyed = false;
	private unlocked = false;
	/** Gameplay BGM key only; always null on Home. */
	private requestedMusicKey: string | null = null;
	private currentMusic: Phaser.Sound.BaseSound | null = null;
	private currentMusicKey: string | null = null;
	private resultPlayed = false;
	private lastTimerSecondPlayed = -1;
	/** Pause overlay open — do not start/resume BGM until closed. */
	private pauseOverlayOpen = false;
	private hookRetracting = false;
	private gameplayActive = false;
	private screenMode: ScreenMode = "home";
	/** Bumped on lifecycle changes so stale unlock callbacks no-op. */
	private lifecycleToken = 0;
	private unlockToken = 0;
	private unlockHandler: (() => void) | null = null;

	private winch: Phaser.Sound.BaseSound | null = null;

	private readonly boundHookState = this.handleHookState.bind(this);
	private readonly boundScoreChanged = this.handleScoreChanged.bind(this);
	private readonly boundTimeBonus = this.handleTimeBonus.bind(this);
	private readonly boundTimeChanged = this.handleTimeChanged.bind(this);
	private readonly boundGameFinished = this.handleGameFinished.bind(this);
	private readonly boundUnlockPointer = this.handleUnlockGesture.bind(this);
	private readonly boundUnlockSpace = this.handleUnlockGesture.bind(this);
	private readonly boundDestroy = this.destroy.bind(this);

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		const prefs = readSeparatedPrefs(
			AudioSettings.musicEnabled && AudioSettings.sfxEnabled,
		);
		this.sfxEnabled = prefs.sfx;
		this.musicEnabled = prefs.music;
		this.requestedMusicKey = null;
		this.lifecycleToken += 1;

		scene.events.on(HOOK_STATE_CHANGED_EVENT, this.boundHookState);
		scene.events.on(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		scene.events.on(TIME_BONUS_EVENT, this.boundTimeBonus);
		scene.events.on(TIME_CHANGED_EVENT, this.boundTimeChanged);
		scene.events.on(GAME_FINISHED_EVENT, this.boundGameFinished);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.boundDestroy);
		scene.events.once(Phaser.Scenes.Events.DESTROY, this.boundDestroy);

		this.setupUnlock();
		this.log("create", null);
		this.dumpAudioState("construct");
	}

	get isSfxEnabled(): boolean {
		return this.sfxEnabled;
	}

	get isMusicEnabled(): boolean {
		return this.musicEnabled;
	}

	get isDestroyed(): boolean {
		return this.destroyed;
	}

	setSfxEnabled(enabled: boolean): void {
		if (this.destroyed || this.sfxEnabled === enabled) {
			return;
		}
		this.sfxEnabled = enabled;
		writePref(SFX_PREF_KEY_V1, enabled);
		if (!enabled) {
			this.stopWinch();
		}
	}

	toggleSfx(): void {
		this.setSfxEnabled(!this.sfxEnabled);
	}

	/**
	 * Music preference toggle.
	 * On Home: preference + visual only — never starts BGM.
	 * During gameplay: pause / resume-or-create game music once.
	 */
	setMusicEnabled(enabled: boolean): void {
		if (this.destroyed || this.musicEnabled === enabled) {
			return;
		}
		this.musicEnabled = enabled;
		writePref(MUSIC_PREF_KEY_V1, enabled);

		if (!enabled) {
			this.pauseMusic();
			this.dumpAudioState("music-off");
			return;
		}

		// Music On
		if (!this.gameplayActive || this.screenMode === "home") {
			this.dumpAudioState("music-on-home-pref-only");
			return;
		}
		if (this.pauseOverlayOpen || this.screenMode === "paused") {
			this.dumpAudioState("music-on-paused-defer");
			return;
		}
		if (this.currentMusic?.isPaused) {
			this.currentMusic.resume();
			this.dumpAudioState("music-on-resume");
			return;
		}
		this.playMusic(MUSIC_GAME_KEY);
		this.dumpAudioState("music-on");
	}

	toggleMusic(): void {
		this.setMusicEnabled(!this.musicEnabled);
	}

	unlockFromGesture(): void {
		this.handleUnlockGesture();
	}

	/**
	 * Home is silent: stop/destroy any BGM, clear request, do not queue music.
	 */
	enterHomeScreen(): void {
		if (this.destroyed) {
			return;
		}
		this.lifecycleToken += 1;
		this.gameplayActive = false;
		this.pauseOverlayOpen = false;
		this.resultPlayed = false;
		this.screenMode = "home";
		this.requestedMusicKey = null;
		this.stopMusic();
		this.purgeOrphanBgm();
		this.stopWinch();
		this.log("enterHome:silent", null);
		this.dumpAudioState("home-shown");
	}

	/** Start gameplay BGM once after Play (if music enabled + unlocked). */
	notifyGameplayStarted(): void {
		if (this.destroyed) {
			return;
		}
		this.lifecycleToken += 1;
		this.gameplayActive = true;
		this.pauseOverlayOpen = false;
		this.screenMode = "gameplay";
		this.requestedMusicKey = MUSIC_GAME_KEY;
		this.playMusic(MUSIC_GAME_KEY);
		this.dumpAudioState("play-pressed");
	}

	/**
	 * Idempotent gameplay BGM. Never used for Home/story/menu music.
	 */
	playMusic(key: string): void {
		if (this.destroyed || !key) {
			return;
		}
		if (key !== MUSIC_GAME_KEY) {
			this.log("playMusic:rejected-non-game", key);
			return;
		}
		if (!this.gameplayActive || this.screenMode === "home") {
			this.log("playMusic:blocked-home", key);
			return;
		}

		this.requestedMusicKey = key;

		if (!this.musicEnabled) {
			this.log("playMusic:disabled-remember", key);
			return;
		}
		if (!this.unlocked) {
			this.log("playMusic:wait-unlock", key);
			return;
		}
		if (this.pauseOverlayOpen) {
			this.log("playMusic:pause-overlay", key);
			return;
		}
		if (!this.scene.cache.audio.exists(key)) {
			this.log("playMusic:missing", key);
			return;
		}

		if (this.currentMusic && this.currentMusicKey === key) {
			if (this.currentMusic.isPaused) {
				this.log("resume", key);
				this.currentMusic.resume();
				return;
			}
			if (this.currentMusic.isPlaying) {
				this.log("playMusic:already-playing", key);
				return;
			}
			this.log("playMusic:replay-existing", key);
			this.currentMusic.play({ loop: true, volume: AudioSettings.gameMusicVolume });
			return;
		}

		// Synchronous ownership transfer — never leave an audible orphan.
		this.stopMusic();
		this.purgeOrphanBgm();

		this.log("create/play", key);
		this.currentMusicKey = key;
		this.currentMusic = this.scene.sound.add(key, {
			loop: true,
			volume: AudioSettings.gameMusicVolume,
		});
		this.currentMusic.play();
	}

	stopMusic(): void {
		const target = this.currentMusic;
		if (!target) {
			this.currentMusicKey = null;
			this.purgeOrphanBgm();
			return;
		}
		this.log("stop/destroy", this.currentMusicKey);
		this.scene.tweens.killTweensOf(target);
		try {
			if (target.isPlaying || target.isPaused) {
				target.stop();
			}
		} catch {
			/* ignore */
		}
		try {
			target.destroy();
		} catch {
			/* ignore */
		}
		this.currentMusic = null;
		this.currentMusicKey = null;
		this.purgeOrphanBgm();
	}

	pauseMusic(): void {
		if (!this.currentMusic?.isPlaying) {
			return;
		}
		this.log("pause", this.currentMusicKey);
		this.currentMusic.pause();
	}

	resumeMusic(): void {
		if (
			this.destroyed ||
			!this.musicEnabled ||
			this.pauseOverlayOpen ||
			!this.gameplayActive ||
			this.screenMode === "home"
		) {
			return;
		}
		if (this.currentMusic?.isPaused) {
			this.log("resume", this.currentMusicKey);
			this.currentMusic.resume();
			return;
		}
		if (!this.currentMusic) {
			this.playMusic(MUSIC_GAME_KEY);
		}
	}

	/** Pause overlay: pause owned BGM + winch only (never SoundManager.pauseAll). */
	onPauseOverlayOpened(): void {
		if (this.destroyed) {
			return;
		}
		this.pauseOverlayOpen = true;
		this.screenMode = "paused";
		this.pauseMusic();
		if (this.winch?.isPlaying) {
			this.winch.pause();
		}
		this.dumpAudioState("pause");
	}

	/** Resume overlay: resume same BGM instance + optional winch. */
	onPauseOverlayClosed(options?: { resumeWinch?: boolean }): void {
		if (this.destroyed) {
			return;
		}
		this.pauseOverlayOpen = false;
		if (this.gameplayActive) {
			this.screenMode = "gameplay";
		}
		this.resumeMusic();
		const resumeWinch = options?.resumeWinch ?? this.hookRetracting;
		if (resumeWinch && this.sfxEnabled && this.winch?.isPaused) {
			this.winch.resume();
		} else if (!resumeWinch && this.winch?.isPaused) {
			this.stopWinch();
		}
		this.dumpAudioState("resume");
	}

	/** Clear pause flag without resuming (abort → Home / restart). */
	clearPauseHold(): void {
		if (this.destroyed) {
			return;
		}
		this.pauseOverlayOpen = false;
	}

	playButtonSfx(): void {
		this.playSfx("sfx-button", { volume: AudioSettings.uiVolume });
	}

	playPauseSfx(): void {
		this.playSfx("sfx-pause", { volume: AudioSettings.uiVolume });
	}

	playResultGameOver(): void {
		this.handleGameFinished({
			finalScore: 0,
			gameSessionId: "audio-result-trigger",
		});
	}

	/**
	 * One-shot SFX. Never loop unless config.loop is explicitly true (winch uses its own path).
	 */
	playSfx(
		key: string,
		config?: { volume?: number; loop?: boolean },
	): void {
		if (!this.sfxEnabled || this.destroyed) {
			return;
		}
		if (
			this.pauseOverlayOpen &&
			key !== "sfx-button" &&
			key !== "sfx-pause"
		) {
			return;
		}
		if (!this.scene.cache.audio.exists(key)) {
			return;
		}
		try {
			this.scene.sound.play(key, {
				volume: config?.volume ?? 1,
				loop: config?.loop === true,
			});
		} catch {
			/* fail safe */
		}
	}

	dumpAudioState(reason: string): void {
		if (!DEBUG_AUDIO) {
			return;
		}
		try {
			const manager = this.scene.sound;
			const seen = new Set<Phaser.Sound.BaseSound>();
			const all: Phaser.Sound.BaseSound[] = [];
			const pushAll = (list: Phaser.Sound.BaseSound[]) => {
				for (const sound of list) {
					if (!seen.has(sound)) {
						seen.add(sound);
						all.push(sound);
					}
				}
			};
			pushAll(manager.getAllPlaying());
			for (const key of [...BGM_KEYS, WINCH_KEY]) {
				pushAll(manager.getAll(key));
			}
			if (this.currentMusic) {
				pushAll([this.currentMusic]);
			}
			const playing = all.filter((s) => s.isPlaying);
			const rows = all.map((s) => {
				const extra = s as unknown as {
					loop?: boolean;
					volume?: number;
				};
				return {
					key: s.key,
					isPlaying: s.isPlaying,
					isPaused: s.isPaused,
					loop: extra.loop,
					volume: extra.volume,
					owned: s === this.currentMusic,
				};
			});
			console.info(`[Audio#${this.instanceId}] dump:${reason}`, {
				screen: this.screenMode,
				gameplayActive: this.gameplayActive,
				musicEnabled: this.musicEnabled,
				sfxEnabled: this.sfxEnabled,
				unlocked: this.unlocked,
				lifecycleToken: this.lifecycleToken,
				requestedMusicKey: this.requestedMusicKey,
				currentMusicKey: this.currentMusicKey,
				currentPlaying: this.currentMusic?.isPlaying ?? false,
				currentPaused: this.currentMusic?.isPaused ?? false,
				managerCount: all.length,
				playingCount: playing.length,
				sounds: rows,
			});
		} catch (err) {
			console.info(`[Audio#${this.instanceId}] dump:${reason}:failed`, err);
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.lifecycleToken += 1;
		this.log("destroy", this.currentMusicKey);
		this.dumpAudioState("shutdown");

		this.removeUnlockListeners();
		this.scene.events.off(HOOK_STATE_CHANGED_EVENT, this.boundHookState);
		this.scene.events.off(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		this.scene.events.off(TIME_BONUS_EVENT, this.boundTimeBonus);
		this.scene.events.off(TIME_CHANGED_EVENT, this.boundTimeChanged);
		this.scene.events.off(GAME_FINISHED_EVENT, this.boundGameFinished);
		this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.boundDestroy);
		this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.boundDestroy);

		this.stopWinch();
		this.stopMusic();
		this.requestedMusicKey = null;
		this.gameplayActive = false;
		this.screenMode = "home";
	}

	private setupUnlock(): void {
		this.removeUnlockListeners();
		const sound = this.scene.sound;
		if (!sound.locked) {
			this.markUnlocked();
			return;
		}
		this.unlockToken = this.lifecycleToken;
		this.unlockHandler = () => {
			if (this.destroyed || this.unlockToken !== this.lifecycleToken) {
				return;
			}
			this.markUnlocked();
		};
		sound.once(Phaser.Sound.Events.UNLOCKED, this.unlockHandler);
		this.scene.input.on("pointerdown", this.boundUnlockPointer);
		this.scene.input.keyboard?.on("keydown-SPACE", this.boundUnlockSpace);
	}

	private handleUnlockGesture(): void {
		if (this.destroyed || this.unlocked) {
			return;
		}
		try {
			this.scene.sound.unlock();
		} catch {
			/* ignore */
		}
		if (!this.scene.sound.locked) {
			this.markUnlocked();
		}
	}

	private markUnlocked(): void {
		if (this.destroyed || this.unlocked) {
			return;
		}
		this.unlocked = true;
		this.removeUnlockListeners();
		this.dumpAudioState("unlocked");

		// Home must stay silent even after unlock.
		if (!this.gameplayActive || this.screenMode === "home") {
			return;
		}
		if (this.pauseOverlayOpen) {
			return;
		}
		if (this.requestedMusicKey === MUSIC_GAME_KEY) {
			this.playMusic(MUSIC_GAME_KEY);
		}
	}

	private removeUnlockListeners(): void {
		this.scene.input.off("pointerdown", this.boundUnlockPointer);
		this.scene.input.keyboard?.off("keydown-SPACE", this.boundUnlockSpace);
		if (this.unlockHandler) {
			this.scene.sound.off(
				Phaser.Sound.Events.UNLOCKED,
				this.unlockHandler,
			);
			this.unlockHandler = null;
		}
	}

	/**
	 * Destroy any leftover BGM instances in the game-level SoundManager
	 * (orphans from fade races / prior scene restarts).
	 */
	private purgeOrphanBgm(): void {
		const manager = this.scene.sound;
		for (const key of BGM_KEYS) {
			const matches = manager.getAll(key) as Phaser.Sound.BaseSound[];
			for (const sound of matches) {
				if (sound === this.currentMusic) {
					continue;
				}
				this.scene.tweens.killTweensOf(sound);
				try {
					if (sound.isPlaying || sound.isPaused) {
						sound.stop();
					}
				} catch {
					/* ignore */
				}
				try {
					sound.destroy();
				} catch {
					/* ignore */
				}
			}
		}
	}

	private handleHookState(payload: HookStateChangedPayload): void {
		this.hookRetracting = payload.state === "RETRACTING";

		if (this.destroyed || this.pauseOverlayOpen || !this.gameplayActive) {
			return;
		}

		if (payload.state === "RETRACTING") {
			this.startWinch();
			if (payload.retractReason === "caught") {
				this.playCatchForClaim(payload);
			}
			return;
		}

		if (
			payload.state === "SWINGING" &&
			payload.previousState === "RETRACTING"
		) {
			this.stopWinch();
		}
	}

	private startWinch(): void {
		if (!this.sfxEnabled || this.destroyed) {
			return;
		}
		if (this.winch?.isPlaying) {
			return;
		}
		if (!this.scene.cache.audio.exists(WINCH_KEY)) {
			return;
		}
		this.stopWinch();
		this.winch = this.scene.sound.add(WINCH_KEY, {
			loop: true,
			volume: AudioSettings.hookVolume,
		});
		this.winch.play();
	}

	private stopWinch(): void {
		if (!this.winch) {
			return;
		}
		try {
			this.winch.stop();
			this.winch.destroy();
		} catch {
			/* ignore */
		}
		this.winch = null;
	}

	private playCatchForClaim(payload: HookStateChangedPayload): void {
		const key = this.resolveCatchSfxKey(payload);
		if (!key) {
			return;
		}
		this.playSfx(key, {
			volume: AudioSettings.catchVolume * CATCH_VOLUME_SCALE,
		});
	}

	private resolveCatchSfxKey(
		payload: HookStateChangedPayload,
	): string | undefined {
		if (payload.creatureId) {
			const creature = getCreatureById(payload.creatureId);
			if (creature?.isToxic) {
				return "sfx-miss";
			}
			return "sfx-score";
		}
		if (payload.itemId) {
			return this.itemSfxKey(payload.itemId);
		}
		return undefined;
	}

	private itemSfxKey(itemId: string): string {
		switch (itemId) {
			case "diamond":
			case "emerald":
			case "ruby":
			case "valuable":
				return "sfx-jewel";
			case "bag":
				return "sfx-gold";
			case "bone":
				return "sfx-bone";
			case "skull":
				return "sfx-skull";
			case "barrel":
				return "sfx-stone";
			case "star":
			case "bonus-power":
				return "sfx-bonus";
			case "bonus-bomb":
				return "sfx-bomb";
			default:
				return "sfx-score";
		}
	}

	private handleScoreChanged(payload: ScoreChangedPayload): void {
		if (
			this.destroyed ||
			this.pauseOverlayOpen ||
			!this.gameplayActive ||
			payload.delta === 0
		) {
			return;
		}

		let key = "sfx-score";
		if (payload.sourceKind === "creature") {
			key = payload.delta < 0 ? "sfx-miss" : "sfx-score";
		} else {
			const item = getItemById(payload.sourceId);
			if (item) {
				key = this.itemSfxKey(item.id);
			} else if (
				payload.effectType === "gem" ||
				payload.effectType === "valuable"
			) {
				key = "sfx-jewel";
			} else if (payload.effectType === "scrap") {
				key = this.itemSfxKey(payload.sourceId);
			}
		}

		this.playSfx(key, { volume: AudioSettings.rewardVolume });
	}

	private handleTimeBonus(_payload: TimeBonusPayload): void {
		if (this.destroyed || this.pauseOverlayOpen || !this.gameplayActive) {
			return;
		}
		this.playSfx("sfx-bonus", { volume: AudioSettings.rewardVolume });
	}

	private handleTimeChanged(payload: TimeChangedPayload): void {
		if (this.destroyed || this.pauseOverlayOpen || !this.gameplayActive) {
			return;
		}
		const sec = payload.remainingSeconds;
		if (sec < 1 || sec > 10) {
			return;
		}
		if (sec === this.lastTimerSecondPlayed) {
			return;
		}
		this.lastTimerSecondPlayed = sec;
		this.playSfx("sfx-timer", { volume: AudioSettings.timerVolume });
	}

	private handleGameFinished(_payload: GameFinishedPayload): void {
		if (this.destroyed || this.resultPlayed) {
			return;
		}
		this.resultPlayed = true;
		this.screenMode = "gameover";
		this.gameplayActive = false;
		this.requestedMusicKey = null;
		this.stopWinch();
		this.stopMusic();
		this.playSfx("sfx-game-over", { volume: AudioSettings.resultVolume });
		this.dumpAudioState("gameover");
	}

	private log(action: string, key: string | null | undefined): void {
		if (!DEBUG_AUDIO) {
			return;
		}
		try {
			console.info(
				`[Audio#${this.instanceId}] ${action} req=${this.requestedMusicKey} cur=${key ?? this.currentMusicKey} screen=${this.screenMode}`,
			);
		} catch {
			/* ignore */
		}
	}
}
