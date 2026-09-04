/**
 * Local, anonymous score persistence for this browser/device.
 * Stores only last/best score metadata — never names, phones, or account data.
 */

export const SCORE_STORAGE_KEY = "fisherman-fortune-score-v1";

export interface ScoreStorageData {
	lastScore: number;
	bestScore: number;
	lastSessionId: string;
	updatedAt: string;
}

export interface SaveFinalScoreResult {
	saved: boolean;
	lastScore: number;
	bestScore: number;
	isNewBest: boolean;
}

function isNonNegativeInt(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		Number.isInteger(value) &&
		value >= 0
	);
}

function isValidStoredData(value: unknown): value is ScoreStorageData {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const data = value as Record<string, unknown>;
	return (
		isNonNegativeInt(data.lastScore) &&
		isNonNegativeInt(data.bestScore) &&
		typeof data.lastSessionId === "string" &&
		data.lastSessionId.length > 0 &&
		typeof data.updatedAt === "string" &&
		data.updatedAt.length > 0
	);
}

function readRaw(): ScoreStorageData | undefined {
	try {
		const storage = globalThis.localStorage;
		if (!storage) {
			return undefined;
		}
		const raw = storage.getItem(SCORE_STORAGE_KEY);
		if (raw === null || raw === undefined) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!isValidStoredData(parsed)) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function writeRaw(data: ScoreStorageData): boolean {
	try {
		const storage = globalThis.localStorage;
		if (!storage) {
			return false;
		}
		storage.setItem(SCORE_STORAGE_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

function normalizeScore(score: number): number | undefined {
	if (!isNonNegativeInt(score)) {
		return undefined;
	}
	return score;
}

/**
 * Anonymous local score store (no PII).
 */
export const ScoreStorage = {
	getLastScore(): number {
		return readRaw()?.lastScore ?? 0;
	},

	getBestScore(): number {
		return readRaw()?.bestScore ?? 0;
	},

	hasSavedSession(gameSessionId: string): boolean {
		if (typeof gameSessionId !== "string" || gameSessionId.length === 0) {
			return false;
		}
		return readRaw()?.lastSessionId === gameSessionId;
	},

	/**
	 * Persist a completed round. Same `gameSessionId` is ignored (no reprocess).
	 */
	saveFinalScore(
		score: number,
		gameSessionId: string,
	): SaveFinalScoreResult {
		const normalized = normalizeScore(score);
		if (
			normalized === undefined ||
			typeof gameSessionId !== "string" ||
			gameSessionId.length === 0
		) {
			const existing = readRaw();
			return {
				saved: false,
				lastScore: existing?.lastScore ?? 0,
				bestScore: existing?.bestScore ?? 0,
				isNewBest: false,
			};
		}

		const existing = readRaw();
		if (existing?.lastSessionId === gameSessionId) {
			return {
				saved: false,
				lastScore: existing.lastScore,
				bestScore: existing.bestScore,
				isNewBest: false,
			};
		}

		const previousBest = existing?.bestScore ?? 0;
		const bestScore = Math.max(previousBest, normalized);
		const isNewBest = normalized > previousBest;
		const next: ScoreStorageData = {
			lastScore: normalized,
			bestScore,
			lastSessionId: gameSessionId,
			updatedAt: new Date().toISOString(),
		};

		const written = writeRaw(next);
		return {
			saved: written,
			lastScore: next.lastScore,
			bestScore: next.bestScore,
			isNewBest,
		};
	},
} as const;
