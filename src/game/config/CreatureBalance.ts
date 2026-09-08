/**
 * Per-creature gameplay balance — chỉnh từng cá thể tại đây.
 *
 * SIZE GUIDE:
 * scale: 1.0 = original image size
 * scale: 0.5 = half size
 * scale: 1.2 = 20% larger
 * Keep scale greater than 0.
 *
 * - movementSpeed: horizontal swim speed only (sheet "Speed")
 * - weight: sheet Weight — drives how slowly the hook pulls the catch up
 * - retractSpeed / pullSpeed: pixels per second while retracting (from PULL_SPEED_BY_WEIGHT)
 * - spawnWeight: xác suất xuất hiện tương đối
 * - rewardMin/rewardMax: khoảng điểm
 * - scale: kích thước hiển thị (mỗi cá thể chỉnh riêng)
 * - nativeFacing: artwork faces Left or Right (drives flipX at spawn)
 * - spawnYMinRatio / spawnYMaxRatio: optional vertical band inside the
 *   underwater gameplay area (0 = spawnTop, 1 = spawnBottom). Used by Big Fish
 *   so sharks stay in the deeper water.
 *
 * Mỗi entry được viết tường minh (không generate runtime) để dễ chỉnh tay.
 */

export type CreatureWeight = "Light" | "Medium" | "Heavy";
export type SpawnZoneLabel = "Upper" | "Middle" | "Lower";
export type RewardOperation = "add" | "subtract";

/**
 * Hook pull speed by sheet Weight (pixels per second).
 * Lower = slower pull toward the boat. Edit these to rebalance all creatures
 * of that weight (and keep each creature's `retractSpeed` in sync).
 *
 * Sheet (Fishes): Small/Toxic = Light, Jelly = Medium, Big Fish = Heavy.
 */
export const PULL_SPEED_BY_WEIGHT = {
	Light: 700,
	/** Jelly hook retract speed (px/s). Slower than Light, faster than Heavy. */
	Medium: 280,
	/** Big Fish — must be clearly slowest (px/s). */
	Heavy: 100,
} as const;

/**
 * Temporary pull-timing logs: [PULL START] once when caught retract begins,
 * [PULL END] once when it reaches the boat. Keep false unless re-checking timing.
 */
export const DEBUG_PULL_SPEED = false;

export type NativeFacing = "Left" | "Right";
export type MovementDirection = "Left" | "Right";

export interface CreatureBalanceEntry {
	id: string;
	movementSpeed: number;
	weight: CreatureWeight;
	/**
	 * Hook pull speed in px/s while this creature is attached.
	 * Must match PULL_SPEED_BY_WEIGHT[weight]. Lower = slower.
	 */
	retractSpeed: number;
	spawnWeight: number;
	spawnZones: readonly SpawnZoneLabel[];
	rewardMin: number;
	rewardMax: number;
	rewardOperation: RewardOperation;
	scale: number;
	/**
	 * Horizontal direction the loaded artwork faces (from sheet/source art).
	 * Spawner sets flipX when this differs from movementDirection.
	 */
	nativeFacing: NativeFacing;
	/**
	 * Optional: fraction of underwater height (0 = top, 1 = bottom).
	 * When set, overrides zone-band Y for this creature.
	 */
	spawnYMinRatio?: number;
	spawnYMaxRatio?: number;
	/**
	 * Display-only offset while this creature rides the hook (RETRACTING).
	 * Applied in CatchController.attachCaught; does not affect catch collision.
	 * Phaser Y+ is down — positive caughtOffsetY places the sprite below the hook.
	 */
	caughtOffsetX?: number;
	caughtOffsetY?: number;
}

/**
 * Shared Big Fish carry pose: hook reads ~15px higher on the body while retracting.
 * Wired via CreatureCatalog for all big-fish-* (override per entry with caughtOffset*).
 */
export const BIG_FISH_CAUGHT_OFFSET = {
	caughtOffsetX: 0,
	caughtOffsetY: 15,
} as const;

/**
 * How many creatures to place across the water immediately on Play / Play Again.
 * Easy to tweak; must stay below MAX_ACTIVE in CreatureSpawner.
 */
export const INITIAL_CREATURE_COUNT = 10;

/**
 * Big Fish / sharks: lower ~45% of the underwater band, with seabed margin
 * applied at spawn time via half display-height clamping.
 */
const BIG_FISH_Y_MIN = 0.55;
const BIG_FISH_Y_MAX = 0.95;

/** Fast / Medium / Slow sheet speeds at Phaser 1280×720 (1920 sheet × 1280/1920). */
const SPEED_FAST = 80;
const SPEED_MEDIUM = (80 * 1280) / 1920;
const SPEED_SLOW = 30;

const SCALE_SMALL_FISH = 0.3936;
const SCALE_JELLY = 0.55;
const SCALE_BIG_FISH = 0.6;
const SCALE_TOXIC_FISH = 0.4597;
const SCALE_CRAB = 0.435;

const PULL_LIGHT = PULL_SPEED_BY_WEIGHT.Light;
const PULL_MEDIUM = PULL_SPEED_BY_WEIGHT.Medium;
const PULL_HEAVY = PULL_SPEED_BY_WEIGHT.Heavy;

export const CREATURE_BALANCE: readonly CreatureBalanceEntry[] = [
	// --- Small Fish (Light, sheet Value ranges, Upper/Middle, pull 700) ---
	{
		id: "small-fish-01",
		nativeFacing: "Right",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 20,
		rewardMax: 25,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-02",
		nativeFacing: "Right",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 15,
		rewardMax: 20,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-03",
		nativeFacing: "Right",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 10,
		rewardMax: 15,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-04",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 10,
		rewardMax: 15,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-05",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 10,
		rewardMax: 15,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-06",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 20,
		rewardMax: 25,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-07",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 15,
		rewardMax: 20,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-08",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 15,
		rewardMax: 20,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-09",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 20,
		rewardMax: 25,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},
	{
		id: "small-fish-10",
		nativeFacing: "Left",
		movementSpeed: SPEED_FAST,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 10,
		rewardMax: 15,
		rewardOperation: "add",
		scale: SCALE_SMALL_FISH,
	},

	// --- Jelly (Medium, sheet Value ranges, Middle/Lower, pull 280) ---
	{
		id: "jelly-01",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-02",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-03",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-04",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},
	{
		id: "jelly-05",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_JELLY,
	},

	// --- Toxic Jelly (Medium, trừ 50–100, Middle/Lower, pull 280) ---
	{
		id: "toxic-jelly-01",
		nativeFacing: "Left",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_JELLY,
	},
	{
		id: "toxic-jelly-02",
		nativeFacing: "Left",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_JELLY,
	},
	{
		id: "toxic-jelly-03",
		nativeFacing: "Left",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_JELLY,
	},
	{
		id: "toxic-jelly-04",
		nativeFacing: "Left",
		movementSpeed: SPEED_MEDIUM,
		weight: "Medium",
		retractSpeed: PULL_MEDIUM,
		spawnWeight: 3,
		spawnZones: ["Middle", "Lower"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_JELLY,
	},

	// --- Big Fish (Heavy, sheet Value ranges, Lower, pull 100) ---
	{
		id: "big-fish-01",
		nativeFacing: "Right",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 250,
		rewardMax: 350,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},
	{
		id: "big-fish-02",
		nativeFacing: "Right",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 350,
		rewardMax: 450,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},
	{
		id: "big-fish-03",
		nativeFacing: "Right",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 250,
		rewardMax: 350,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},
	{
		id: "big-fish-04",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 250,
		rewardMax: 350,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},
	{
		id: "big-fish-05",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 250,
		rewardMax: 350,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},
	{
		id: "big-fish-06",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Heavy",
		retractSpeed: PULL_HEAVY,
		spawnWeight: 1,
		spawnZones: ["Lower"],
		rewardMin: 350,
		rewardMax: 450,
		rewardOperation: "add",
		scale: SCALE_BIG_FISH,
		spawnYMinRatio: BIG_FISH_Y_MIN,
		spawnYMaxRatio: BIG_FISH_Y_MAX,
	},

	// --- Toxic Fish (Light, sheet trừ ranges, Upper/Middle, pull 700) ---
	{
		id: "toxic-fish-01",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-02",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-03",
		nativeFacing: "Right",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},
	{
		id: "toxic-fish-04",
		nativeFacing: "Left",
		movementSpeed: SPEED_MEDIUM,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 100,
		rewardMax: 200,
		rewardOperation: "subtract",
		scale: SCALE_TOXIC_FISH,
	},

	// --- Normal crab (Light, +1–49, pull 700) ---
	{
		id: "normal-crab-01",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
	{
		id: "normal-crab-02",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 3,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 1,
		rewardMax: 49,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},

	// --- Rare crab (Light, +50–100, pull 700) ---
	{
		id: "rare-crab-01",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 1,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
	{
		id: "rare-crab-02",
		nativeFacing: "Left",
		movementSpeed: SPEED_SLOW,
		weight: "Light",
		retractSpeed: PULL_LIGHT,
		spawnWeight: 1,
		spawnZones: ["Upper", "Middle"],
		rewardMin: 50,
		rewardMax: 100,
		rewardOperation: "add",
		scale: SCALE_CRAB,
	},
];

const CREATURE_BALANCE_BY_ID_INTERNAL: Record<string, CreatureBalanceEntry> =
	Object.fromEntries(CREATURE_BALANCE.map((e) => [e.id, e]));

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
		const expectedPull = PULL_SPEED_BY_WEIGHT[entry.weight];
		if (entry.retractSpeed !== expectedPull) {
			throw new Error(
				`${entry.id} retractSpeed (${entry.retractSpeed}) must match PULL_SPEED_BY_WEIGHT.${entry.weight} (${expectedPull})`,
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
		if (entry.nativeFacing !== "Left" && entry.nativeFacing !== "Right") {
			throw new Error(
				`${entry.id} nativeFacing must be "Left" or "Right", got ${String(entry.nativeFacing)}`,
			);
		}
		if (entry.id.startsWith("big-fish-")) {
			const minR = entry.spawnYMinRatio;
			const maxR = entry.spawnYMaxRatio;
			if (
				typeof minR !== "number" ||
				typeof maxR !== "number" ||
				!Number.isFinite(minR) ||
				!Number.isFinite(maxR) ||
				minR < 0 ||
				maxR > 1 ||
				minR > maxR
			) {
				throw new Error(
					`${entry.id} must define valid spawnYMinRatio/spawnYMaxRatio in [0,1]`,
				);
			}
			if (entry.retractSpeed !== PULL_HEAVY) {
				throw new Error(
					`${entry.id} retractSpeed must be ${PULL_HEAVY} px/s`,
				);
			}
			if (entry.weight !== "Heavy") {
				throw new Error(`${entry.id} must remain Heavy`);
			}
		}
	}

	const heavyRetract = PULL_HEAVY;
	for (const entry of CREATURE_BALANCE) {
		if (entry.id.startsWith("big-fish-")) {
			continue;
		}
		if (entry.retractSpeed <= heavyRetract) {
			throw new Error(
				`${entry.id} retractSpeed (${entry.retractSpeed}) must be > heavy Big Fish ${heavyRetract}`,
			);
		}
	}
}

/**
 * Per-family contract straight from the Fishes sheet. Each prefix must exist
 * with the exact count, weight and pull speed — a renamed or missing entry
 * fails the build instead of silently falling back at runtime.
 */
{
	const families: readonly {
		prefix: string;
		count: number;
		weight: CreatureWeight;
		pullSpeed: number;
	}[] = [
		{ prefix: "small-fish-", count: 10, weight: "Light", pullSpeed: PULL_LIGHT },
		{ prefix: "jelly-", count: 5, weight: "Medium", pullSpeed: PULL_MEDIUM },
		{ prefix: "toxic-jelly-", count: 4, weight: "Medium", pullSpeed: PULL_MEDIUM },
		{ prefix: "big-fish-", count: 6, weight: "Heavy", pullSpeed: PULL_HEAVY },
		{ prefix: "toxic-fish-", count: 4, weight: "Light", pullSpeed: PULL_LIGHT },
	];

	for (const family of families) {
		const members = CREATURE_BALANCE.filter((e) =>
			e.id.startsWith(family.prefix),
		);
		if (members.length !== family.count) {
			throw new Error(
				`Expected ${family.count} ${family.prefix}* entries, got ${members.length}`,
			);
		}
		for (let i = 1; i <= family.count; i += 1) {
			const id = `${family.prefix}${String(i).padStart(2, "0")}`;
			const entry = CREATURE_BALANCE_BY_ID_INTERNAL[id];
			if (!entry) {
				throw new Error(`Missing CreatureBalance entry: ${id}`);
			}
			if (entry.weight !== family.weight) {
				throw new Error(
					`${id} must be ${family.weight}, got ${entry.weight}`,
				);
			}
			if (entry.retractSpeed !== family.pullSpeed) {
				throw new Error(
					`${id} must pull at ${family.pullSpeed} px/s, got ${entry.retractSpeed}`,
				);
			}
		}
	}

	// Higher px/s must always mean a shorter pull over the same distance.
	const distance = 350;
	const light = distance / PULL_LIGHT;
	const medium = distance / PULL_MEDIUM;
	const heavy = distance / PULL_HEAVY;
	if (!(heavy > medium && medium > light)) {
		throw new Error(
			`Pull duration order inverted at ${distance}px: ` +
				`light=${light}s medium=${medium}s heavy=${heavy}s`,
		);
	}
}

export const CREATURE_BALANCE_BY_ID: Readonly<
	Record<string, CreatureBalanceEntry>
> = CREATURE_BALANCE_BY_ID_INTERNAL;

export function getCreatureBalance(
	id: string,
): CreatureBalanceEntry | undefined {
	return CREATURE_BALANCE_BY_ID[id];
}
