import Phaser from "phaser";
import { getCreatureById } from "./CreatureCatalog";
import { getItemById } from "./ItemCatalog";
import {
	AudioSettings,
	MUSIC_PREF_KEY,
	SFX_PREF_KEY,
} from "./config/AudioSettings";
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
 * Construct mappings confirmed:
 * - game_music loop (Loading/Menu)
 * - winch loop while hook retracts (new_hook_es + Game_Event mute/unmute Winch)
 * - timer, game_over, game_won, bomb, explosion, bonus, score, button, pause
 * - bone/skull/jewel/gold/stone/miss preloaded (no clear per-catch play in Game_Event;
 *   fallback mapping below matches asset names + user spec)
 *
 * Cast: no confirmed cast-only SFX in Game_Event → left silent.
 */

const MUSIC_KEY = "music-game";
const WINCH_KEY = "sfx-winch";
const CATCH_VOLUME_SCALE = 0.35;

function readPref(key: string, fallback: boolean): boolean {
	try {
		const raw = globalThis.localStorage?.getItem(key);
		if (raw === null || raw === undefined) {
			return fallback;
		}
		if (raw === "true") {
			return true;
		}
		if (raw === "false") {
			return false;
		}
		return fallback;
	} catch {
		return fallback;
	}
}

function writePref(key: string, value: boolean): void {
	try {
		globalThis.localStorage?.setItem(key, value ? "true" : "false");
	} catch {
		/* ignore quota / private mode */
	}
}

/**
 * Level audio: music unlock, hook winch, catch/reward/timer/result SFX.
 */
export class AudioController {
	private readonly scene: Phaser.Scene;

	private musicEnabled: boolean;
	private sfxEnabled: boolean;
	private destroyed = false;
	private unlocked = false;
	private musicStarted = false;
	private resultPlayed = false;
	private lastTimerSecondPlayed = -1;
	private paused = false;

	private music?: Phaser.Sound.BaseSound;
	private winch?: Phaser.Sound.BaseSound;

	private readonly boundHookState = this.handleHookState.bind(this);
	private readonly boundScoreChanged = this.handleScoreChanged.bind(this);
	private readonly boundTimeBonus = this.handleTimeBonus.bind(this);
	private readonly boundTimeChanged = this.handleTimeChanged.bind(this);
	private readonly boundGameFinished = this.handleGameFinished.bind(this);
	private readonly boundUnlockPointer = this.handleUnlockGesture.bind(this);
	private readonly boundUnlockSpace = this.handleUnlockGesture.bind(this);

	constructor(scene: Phaser.Scene) {
		this.scene = scene;
		this.musicEnabled = readPref(
			MUSIC_PREF_KEY,
			AudioSettings.musicEnabled,
		);
		this.sfxEnabled = readPref(SFX_PREF_KEY, AudioSettings.sfxEnabled);

		scene.events.on(HOOK_STATE_CHANGED_EVENT, this.boundHookState);
		scene.events.on(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		scene.events.on(TIME_BONUS_EVENT, this.boundTimeBonus);
		scene.events.on(TIME_CHANGED_EVENT, this.boundTimeChanged);
		scene.events.on(GAME_FINISHED_EVENT, this.boundGameFinished);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);

		this.setupUnlock();
	}

	setMusicEnabled(enabled: boolean): void {
		this.musicEnabled = enabled;
		writePref(MUSIC_PREF_KEY, enabled);
		if (!enabled) {
			this.stopMusic();
		} else if (this.unlocked && !this.paused) {
			this.ensureMusicPlaying();
		}
	}

	setSfxEnabled(enabled: boolean): void {
		this.sfxEnabled = enabled;
		writePref(SFX_PREF_KEY, enabled);
		if (!enabled) {
			this.stopWinch();
		}
	}

	toggleMusic(): void {
		this.setMusicEnabled(!this.musicEnabled);
	}

	toggleSfx(): void {
		this.setSfxEnabled(!this.sfxEnabled);
	}

	pauseAll(): void {
		if (this.destroyed) {
			return;
		}
		this.paused = true;
		this.music?.pause();
		this.winch?.pause();
	}

	resumeAll(): void {
		if (this.destroyed) {
			return;
		}
		this.paused = false;
		if (this.musicEnabled && this.music?.isPaused) {
			this.music.resume();
		}
		if (this.sfxEnabled && this.winch?.isPaused) {
			this.winch.resume();
		}
	}

	/** Called from GameOverController as a redundant safe trigger. */
	playResultGameOver(): void {
		this.handleGameFinished({ finalScore: 0 });
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.removeUnlockListeners();
		this.scene.events.off(HOOK_STATE_CHANGED_EVENT, this.boundHookState);
		this.scene.events.off(SCORE_CHANGED_EVENT, this.boundScoreChanged);
		this.scene.events.off(TIME_BONUS_EVENT, this.boundTimeBonus);
		this.scene.events.off(TIME_CHANGED_EVENT, this.boundTimeChanged);
		this.scene.events.off(GAME_FINISHED_EVENT, this.boundGameFinished);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);

		this.stopWinch();
		this.stopMusic();
	}

	private setupUnlock(): void {
		const sound = this.scene.sound;
		if (!sound.locked) {
			this.onUnlocked();
			return;
		}

		sound.once(Phaser.Sound.Events.UNLOCKED, this.onUnlocked, this);

		this.scene.input.on("pointerdown", this.boundUnlockPointer);
		this.scene.input.keyboard?.on("keydown-SPACE", this.boundUnlockSpace);
	}

	private handleUnlockGesture(): void {
		// Unlock only — does not call beginCasting (hook has its own listener).
		if (this.destroyed || this.unlocked) {
			return;
		}
		try {
			this.scene.sound.unlock();
		} catch {
			/* ignore */
		}
		if (!this.scene.sound.locked) {
			this.onUnlocked();
		}
	}

	private onUnlocked = (): void => {
		if (this.destroyed || this.unlocked) {
			return;
		}
		this.unlocked = true;
		this.removeUnlockListeners();
		this.ensureMusicPlaying();
	};

	private removeUnlockListeners(): void {
		this.scene.input.off("pointerdown", this.boundUnlockPointer);
		this.scene.input.keyboard?.off("keydown-SPACE", this.boundUnlockSpace);
		this.scene.sound.off(Phaser.Sound.Events.UNLOCKED, this.onUnlocked, this);
	}

	private ensureMusicPlaying(): void {
		if (
			this.destroyed ||
			!this.musicEnabled ||
			!this.unlocked ||
			this.paused ||
			this.musicStarted
		) {
			return;
		}
		if (!this.scene.cache.audio.exists(MUSIC_KEY)) {
			return;
		}

		this.musicStarted = true;
		this.music = this.scene.sound.add(MUSIC_KEY, {
			loop: true,
			volume: 0,
		});
		this.music.play();

		this.scene.tweens.add({
			targets: this.music,
			volume: AudioSettings.gameMusicVolume,
			duration: AudioSettings.musicFadeInMs,
			ease: "Linear",
		});
	}

	private stopMusic(): void {
		if (this.music) {
			this.scene.tweens.killTweensOf(this.music);
			this.music.stop();
			this.music.destroy();
			this.music = undefined;
		}
		this.musicStarted = false;
	}

	private fadeOutMusic(durationMs = 400): void {
		if (!this.music) {
			return;
		}
		const target = this.music;
		this.scene.tweens.killTweensOf(target);
		this.scene.tweens.add({
			targets: target,
			volume: 0,
			duration: durationMs,
			ease: "Linear",
			onComplete: () => {
				target.stop();
				target.destroy();
				if (this.music === target) {
					this.music = undefined;
					this.musicStarted = false;
				}
			},
		});
	}

	private handleHookState(payload: HookStateChangedPayload): void {
		if (this.destroyed || this.paused) {
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

		// CASTING: no confirmed Construct cast SFX — remain silent.
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
		if (this.winch) {
			this.winch.stop();
			this.winch.destroy();
			this.winch = undefined;
		}
	}

	private playCatchForClaim(payload: HookStateChangedPayload): void {
		const key = this.resolveCatchSfxKey(payload);
		if (!key) {
			return;
		}
		// Low volume at catch; full reward volume plays on score-changed.
		this.playSfx(key, AudioSettings.catchVolume * CATCH_VOLUME_SCALE);
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
		if (this.destroyed || this.paused || payload.delta === 0) {
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

		this.playSfx(key, AudioSettings.rewardVolume);
	}

	private handleTimeBonus(_payload: TimeBonusPayload): void {
		if (this.destroyed || this.paused) {
			return;
		}
		this.playSfx("sfx-bonus", AudioSettings.rewardVolume);
	}

	private handleTimeChanged(payload: TimeChangedPayload): void {
		if (this.destroyed || this.paused) {
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
		this.playSfx("sfx-timer", AudioSettings.timerVolume);
	}

	private handleGameFinished(_payload: GameFinishedPayload): void {
		if (this.destroyed || this.resultPlayed) {
			return;
		}
		this.resultPlayed = true;
		this.stopWinch();
		this.fadeOutMusic(500);
		this.playSfx("sfx-game-over", AudioSettings.resultVolume);
	}

	private playSfx(key: string, volume: number): void {
		if (!this.sfxEnabled || this.destroyed || this.paused) {
			return;
		}
		if (!this.scene.cache.audio.exists(key)) {
			return;
		}
		try {
			this.scene.sound.play(key, { volume });
		} catch {
			/* missing decode / unlocked race — fail safe */
		}
	}
}
