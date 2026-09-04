/**
 * Host bridge for Flutter WebView (and browser CustomEvent fallback).
 * Sends only non-sensitive game events — never phone/account/PII.
 * Does not perform network requests.
 */

import { GameSession } from "./GameSession";

/** Dev-only: log each outgoing payload once. Keep false in production. */
const LOG_BRIDGE_EVENTS = false;

export const FISHERMAN_FORTUNE_EVENT = "fisherman-fortune";

export interface GameStartedBridgePayload {
	type: "GAME_STARTED";
	version: 1;
	gameSessionId: string;
	durationSeconds: number;
	startedAt: string;
}

export interface GameFinishedBridgePayload {
	type: "GAME_FINISHED";
	version: 1;
	gameSessionId: string;
	score: number;
	durationSeconds: number;
	completedAt: string;
}

export interface RestartGameBridgePayload {
	type: "RESTART_GAME";
	version: 1;
	previousGameSessionId: string;
}

export interface OpenLeaderboardBridgePayload {
	type: "OPEN_LEADERBOARD";
	version: 1;
}

export interface ExitGameBridgePayload {
	type: "EXIT_GAME";
	version: 1;
}

export type FishermanFortuneBridgePayload =
	| GameStartedBridgePayload
	| GameFinishedBridgePayload
	| RestartGameBridgePayload
	| OpenLeaderboardBridgePayload
	| ExitGameBridgePayload;

/** Session IDs that already emitted GAME_FINISHED this page runtime. */
const sentFinishedSessionIds = new Set<string>();
/** Session IDs that already emitted GAME_STARTED this page runtime. */
const sentStartedSessionIds = new Set<string>();

function isNonNegativeInt(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value >= 0
	);
}

function logPayload(payload: FishermanFortuneBridgePayload): void {
	if (!LOG_BRIDGE_EVENTS) {
		return;
	}
	try {
		console.info("[FlutterGameBridge]", payload);
	} catch {
		/* ignore */
	}
}

function dispatchBrowserEvent(payload: FishermanFortuneBridgePayload): void {
	try {
		const target = globalThis as unknown as {
			dispatchEvent?: (event: Event) => boolean;
			CustomEvent?: new (
				type: string,
				init?: CustomEventInit,
			) => CustomEvent;
		};
		if (typeof target.dispatchEvent !== "function" || !target.CustomEvent) {
			return;
		}
		target.dispatchEvent(
			new target.CustomEvent(FISHERMAN_FORTUNE_EVENT, {
				detail: payload,
			}),
		);
	} catch {
		/* standalone / restricted env */
	}
}

function postToWebViewFlutter(
	payload: FishermanFortuneBridgePayload,
): void {
	try {
		const bridge = globalThis.window?.GameBridge;
		if (bridge && typeof bridge.postMessage === "function") {
			bridge.postMessage(JSON.stringify(payload));
		}
	} catch {
		/* absent or broken channel */
	}
}

function postToInAppWebView(
	payload: FishermanFortuneBridgePayload,
): void {
	try {
		const inApp = globalThis.window?.flutter_inappwebview;
		if (inApp && typeof inApp.callHandler === "function") {
			void inApp.callHandler("GameBridge", payload);
		}
	} catch {
		/* absent or broken handler */
	}
}

/**
 * Deliver a payload to every available host path.
 * Always attempts the browser CustomEvent fallback for local testing.
 */
function deliver(payload: FishermanFortuneBridgePayload): void {
	logPayload(payload);
	postToWebViewFlutter(payload);
	postToInAppWebView(payload);
	dispatchBrowserEvent(payload);
}

/**
 * Flutter / browser host bridge. Safe when no host is present.
 */
export const FlutterGameBridge = {
	/**
	 * Emit GAME_STARTED once per `gameSessionId` for this page runtime.
	 */
	sendGameStarted(input: {
		gameSessionId: string;
		durationSeconds?: number;
		startedAt?: string;
	}): boolean {
		const { gameSessionId } = input;
		if (typeof gameSessionId !== "string" || gameSessionId.length === 0) {
			return false;
		}
		if (sentStartedSessionIds.has(gameSessionId)) {
			return false;
		}
		sentStartedSessionIds.add(gameSessionId);

		const payload: GameStartedBridgePayload = {
			type: "GAME_STARTED",
			version: 1,
			gameSessionId,
			durationSeconds:
				input.durationSeconds ?? GameSession.DURATION_SECONDS,
			startedAt: input.startedAt ?? new Date().toISOString(),
		};
		try {
			deliver(payload);
			return true;
		} catch {
			return true;
		}
	},

	/**
	 * Emit GAME_FINISHED once per `gameSessionId` for this page runtime.
	 */
	sendGameFinished(input: {
		gameSessionId: string;
		score: number;
		durationSeconds?: number;
		completedAt?: string;
	}): boolean {
		const { gameSessionId, score } = input;
		if (
			typeof gameSessionId !== "string" ||
			gameSessionId.length === 0 ||
			!isNonNegativeInt(score)
		) {
			return false;
		}
		if (sentFinishedSessionIds.has(gameSessionId)) {
			return false;
		}

		sentFinishedSessionIds.add(gameSessionId);

		const payload: GameFinishedBridgePayload = {
			type: "GAME_FINISHED",
			version: 1,
			gameSessionId,
			score,
			durationSeconds:
				input.durationSeconds ?? GameSession.DURATION_SECONDS,
			completedAt: input.completedAt ?? new Date().toISOString(),
		};

		try {
			deliver(payload);
			return true;
		} catch {
			return true;
		}
	},

	/** Optional restart notice for the Flutter host. */
	sendRestartGame(previousGameSessionId: string): boolean {
		if (
			typeof previousGameSessionId !== "string" ||
			previousGameSessionId.length === 0
		) {
			return false;
		}
		const payload: RestartGameBridgePayload = {
			type: "RESTART_GAME",
			version: 1,
			previousGameSessionId,
		};
		try {
			deliver(payload);
			return true;
		} catch {
			return false;
		}
	},

	/** Ask Flutter to open the real (account-backed) leaderboard. */
	sendOpenLeaderboard(): boolean {
		const payload: OpenLeaderboardBridgePayload = {
			type: "OPEN_LEADERBOARD",
			version: 1,
		};
		try {
			deliver(payload);
			return true;
		} catch {
			return false;
		}
	},

	/** Ask Flutter to close / leave the WebView game. */
	sendExitGame(): boolean {
		const payload: ExitGameBridgePayload = {
			type: "EXIT_GAME",
			version: 1,
		};
		try {
			deliver(payload);
			return true;
		} catch {
			return false;
		}
	},

	hasSentGameFinished(gameSessionId: string): boolean {
		return sentFinishedSessionIds.has(gameSessionId);
	},

	hasSentGameStarted(gameSessionId: string): boolean {
		return sentStartedSessionIds.has(gameSessionId);
	},
} as const;
