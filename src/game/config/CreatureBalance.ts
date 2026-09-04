/**
 * Per-creature gameplay balance — chỉnh từng cá thể tại đây.
 *
 * SIZE GUIDE:
 * scale: 1.0 = original image size
 * scale: 0.5 = half size
 * scale: 1.2 = 20% larger
 * Keep scale greater than 0.
 *
 * - movementSpeed: tốc độ di chuyển
 * - retractSpeed: tốc độ kéo lên; số càng nhỏ càng nặng/chậm
 * - spawnWeight: xác suất xuất hiện tương đối
 * - rewardMin/rewardMax: khoảng điểm
 * - scale: kích thước hiển thị (mỗi cá thể chỉnh riêng)
 *
 * Mỗi entry được viết tường minh (không generate runtime) để dễ chỉnh tay.
 */

export type CreatureWeight = "Light" | "Medium" | "Heavy";
export type SpawnZoneLabel = "Upper" | "Middle" | "Lower";
export type RewardOperation = "add" | "subtract";

export interface CreatureBalanceEntry {
	id: string;
	movementSpeed: number;
	weight: CreatureWeight;
	retractSpeed: number;
	spawnWeight: number;
	spawnZones: readonly SpawnZoneLabel[];
	rewardMin: number;
	rewardMax: number;
	rewardOperation: RewardOperation;
	scale: number;
}

/** Fast / Medium / Slow sheet speeds at Phaser 1280×720 (1920 sheet × 1280/1920). */
const SPEED_FAST = 80;
const SPEED_MEDIUM = (80 * 1280) / 1920;
const SPEED_SLOW = 30;

const SCALE_SMALL_FISH = 0.3936;
const SCALE_JELLY = 0.688;
const SCALE_BIG_FISH = 0.4597;
const SCALE_TOXIC_FISH = 0.4597;
const SCALE_CRAB = 0.435;

export const CREATURE_BALANCE: readonly CreatureBalanceEntry[] = [
	// --- Small Fish (Light, +1–49, Upper/Middle, retract 500) ---
	{
		id: "small-fish-01",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-02",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-03",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-04",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-05",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-06",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-07",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-08",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-09",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-10",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},

	// --- Jelly (Medium, +50–100, Middle/Lower, retract 280) ---
	{
		id: "jelly-01",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-02",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-03",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-04",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-05",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-06",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-07",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-08",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-09",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: 280,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},

	// --- Big Fish (Heavy, +150–200, Lower, retract 120) ---
	{
		id: "big-fish-01",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},
	{
		id: "big-fish-02",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},
	{
		id: "big-fish-03",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},
	{
		id: "big-fish-04",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},
	{
		id: "big-fish-05",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},
	{
		id: "big-fish-06",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: 120,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 150,
		rewardMax: 200,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
	},

	// --- Toxic Fish (Light, −1–50, Upper/Middle, retract 500) ---
	{
		id: "toxic-fish-01",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 50,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-02",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 50,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-03",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 50,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-04",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 50,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},

	// --- Normal crab (Light, +1–49, retract 500) ---
	{
		id: "normal-crab-01",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
	{
		id: "normal-crab-02",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},

	// --- Rare crab (Light, +50–100, retract 500) ---
	{
		id: "rare-crab-01",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 1,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
	{
		id: "rare-crab-02",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: 500,
		spawnWeight: 1,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
];

if (CREATURE_BALANCE.length !== 33) {
	throw new Error(
		`CREATURE_BALANCE must contain 33 entries, got ${CREATURE_BALANCE.length}`,
	);
}

{
	const ids = new Set<string>();
	for (const entry of CREATURE_BALANCE) {
		if (ids.has(entry.id)) {
			throw new Error(`Duplicate CreatureBalance id: ${entry.id}`);
		}
		ids.add(entry.id);
		if (
			typeof entry.retractSpeed !== "number" ||
			!Number.isFinite(entry.retractSpeed) ||
			entry.retractSpeed <= 0
		) {
			throw new Error(
				`${entry.id} must have a positive editable retractSpeed`,
			);
		}
		if (entry.rewardMin > entry.rewardMax) {
			throw new Error(
				`${entry.id} rewardMin (${entry.rewardMin}) > rewardMax (${entry.rewardMax})`,
			);
		}
		if (
			typeof entry.scale !== "number" ||
			!Number.isFinite(entry.scale) ||
			entry.scale <= 0
		) {
			console.error(
				`[CreatureBalance] ${entry.id}: scale must be a finite number > 0 (got ${String(entry.scale)}). Using fallback 1.`,
			);
			(entry as { scale: number }).scale = 1;
		}
	}
}

export const CREATURE_BALANCE_BY_ID: Readonly<
	Record<string, CreatureBalanceEntry>
> = Object.fromEntries(CREATURE_BALANCE.map((e) => [e.id, e]));

export function getCreatureBalance(
	id: string,
): CreatureBalanceEntry | undefined {
	return CREATURE_BALANCE_BY_ID[id];
}
