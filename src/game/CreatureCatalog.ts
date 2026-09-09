/**
 * Creature definitions: visual/identity metadata + gameplay numbers from
 * `config/CreatureBalance` (the editable per-creature balance file).
 *
 * Speed labels remain qualitative sheet metadata (Fast / Medium / Slow).
 * Construct Bullet speeds were ~30–140 px/s at 1920×1080; balance stores the
 * Phaser-resolution movement speeds directly.
 */

import {
	BIG_FISH_CAUGHT_OFFSET,
	CREATURE_BALANCE,
	getCreatureBalance,
	PULL_SPEED_BY_WEIGHT,
	type CreatureBalanceEntry,
	type CreatureWeight,
	type MovementDirection,
	type NativeFacing,
	type SpawnZoneLabel,
} from "./config/CreatureBalance";

export type { CreatureWeight, MovementDirection, NativeFacing, SpawnZoneLabel };
/** @deprecated Use `CreatureWeight`. */
export type WeightLabel = CreatureWeight;

export type CreatureCategory =
	| "Small Fish"
	| "Toxic Jelly"
	| "Big Fish"
	| "Normal crab"
	| "Rare crab";

export type SpeedLabel = "Fast" | "Medium" | "Slow";
export type FrequencyLabel = "Often" | "Normal" | "Medium" | "Seldom";
/** @deprecated Use `NativeFacing` ("Left" | "Right"). */
export type Facing = "right" | "left";

/** Construct layout resolution → Phaser Level resolution. */
export const SCENE_SPEED_SCALE = 1280 / 1920;

/**
 * Spreadsheet speed labels → px/s at Construct 1920×1080 (reference only;
 * live movement speeds come from CreatureBalance).
 */
export const SPEED_LABEL_TO_PX_PER_SEC_AT_1920: Record<SpeedLabel, number> = {
	Fast: 120,
	Medium: 80,
	Slow: 45,
};

/** Frequency labels → relative spawn weights (reference; live weights in balance). */
export const FREQUENCY_WEIGHT: Record<FrequencyLabel, number> = {
	Often: 5,
	Normal: 3,
	Medium: 3,
	Seldom: 1,
};

/**
 * Category reference scales (legacy sheet). Live per-creature scales come from
 * CreatureBalance.scale — edit that file, not this map.
 */
export const CATEGORY_DISPLAY_SCALE: Record<CreatureCategory, number> = {
	"Small Fish": 0.3936,
	"Toxic Jelly": 0.688,
	"Big Fish": 0.4597,
	"Normal crab": 0.435,
	"Rare crab": 0.435,
};

export interface CreatureValueSpec {
	/** Original spreadsheet cell text (legacy; scoring uses CreatureBalance). */
	raw: string;
	min: number;
	max: number;
}

export interface CategorySheetConfig {
	category: CreatureCategory;
	value: CreatureValueSpec;
	speedLabel: SpeedLabel;
	weightLabel: CreatureWeight;
	frequencyLabel: FrequencyLabel;
	spawnZones: readonly SpawnZoneLabel[];
	isCrab: boolean;
	isToxic: boolean;
}

export interface CreatureDefinition {
	id: string;
	category: CreatureCategory;
	textureKey: string;
	animationKey: string;
	value: CreatureValueSpec;
	/** Pixels per second at the Phaser scene resolution (from CreatureBalance). */
	movementSpeed: number;
	/** Raw spreadsheet speed label. */
	speedLabel: SpeedLabel;
	weight: CreatureWeight;
	/** Explicit retract speed from CreatureBalance (px/s). */
	retractSpeed: number;
	frequencyWeight: number;
	frequencyLabel: FrequencyLabel;
	spawnZone: readonly SpawnZoneLabel[];
	/** Artwork faces this way; spawner flips when it differs from movement. */
	nativeFacing: NativeFacing;
	isCrab: boolean;
	isToxic: boolean;
	scale: number;
	/** Optional underwater-height ratios (0=top … 1=bottom). */
	spawnYMinRatio?: number;
	spawnYMaxRatio?: number;
	/**
	 * Display-only while carried on the hook (RETRACTING). Phaser Y+ is down.
	 * Defaults for Big Fish come from BIG_FISH_CAUGHT_OFFSET.
	 */
	caughtOffsetX: number;
	caughtOffsetY: number;
}

function valueSpec(raw: string, min: number, max: number): CreatureValueSpec {
	return { raw, min, max };
}

function valueFromBalance(balance: CreatureBalanceEntry): CreatureValueSpec {
	if (balance.rewardOperation === "subtract") {
		return valueSpec(
			`trừ ${balance.rewardMin}-${balance.rewardMax}$`,
			-balance.rewardMax,
			-balance.rewardMin,
		);
	}
	return valueSpec(
		`${balance.rewardMin}-${balance.rewardMax}`,
		balance.rewardMin,
		balance.rewardMax,
	);
}

/** Shared sheet rows (category metadata; gameplay numbers live in CreatureBalance). */
export const CATEGORY_SHEET_CONFIG: Record<CreatureCategory, CategorySheetConfig> =
	{
		"Small Fish": {
			category: "Small Fish",
			value: valueSpec("10-25", 10, 25),
			speedLabel: "Fast",
			weightLabel: "Light",
			frequencyLabel: "Often",
			spawnZones: ["Upper", "Middle"],
			isCrab: false,
			isToxic: false,
		},
		"Toxic Jelly": {
			category: "Toxic Jelly",
			value: valueSpec("trừ 50-100$", -100, -50),
			speedLabel: "Medium",
			weightLabel: "Medium",
			frequencyLabel: "Normal",
			spawnZones: ["Middle", "Lower"],
			isCrab: false,
			isToxic: true,
		},
		"Big Fish": {
			category: "Big Fish",
			value: valueSpec("250-450", 250, 450),
			speedLabel: "Slow",
			weightLabel: "Heavy",
			frequencyLabel: "Seldom",
			spawnZones: ["Lower"],
			isCrab: false,
			isToxic: false,
		},
		"Normal crab": {
			category: "Normal crab",
			value: valueSpec("<50", 1, 49),
			speedLabel: "Slow",
			weightLabel: "Light",
			frequencyLabel: "Normal",
			// Sheet lists Upper/Middle; gameplay places crabs on the seabed.
			spawnZones: ["Upper", "Middle"],
			isCrab: true,
			isToxic: false,
		},
		"Rare crab": {
			category: "Rare crab",
			value: valueSpec("50-100", 50, 100),
			speedLabel: "Slow",
			weightLabel: "Light",
			frequencyLabel: "Seldom",
			spawnZones: ["Upper", "Middle"],
			isCrab: true,
			isToxic: false,
		},
	};

function buildCreature(
	id: string,
	category: CreatureCategory,
	animSuffix: "swim" | "walk",
): CreatureDefinition {
	const balance = getCreatureBalance(id);
	if (!balance) {
		throw new Error(`Missing CreatureBalance entry for id: ${id}`);
	}
	const sheet = CATEGORY_SHEET_CONFIG[category];
	const animationKey = `${id}-${animSuffix}`;
	const bigFishDefaults =
		category === "Big Fish" ? BIG_FISH_CAUGHT_OFFSET : undefined;
	return {
		id,
		category,
		textureKey: `${animationKey}-001`,
		animationKey,
		value: valueFromBalance(balance),
		movementSpeed: balance.movementSpeed,
		speedLabel: sheet.speedLabel,
		weight: balance.weight,
		retractSpeed: balance.retractSpeed,
		frequencyWeight: balance.spawnWeight,
		frequencyLabel: sheet.frequencyLabel,
		spawnZone: balance.spawnZones,
		nativeFacing: balance.nativeFacing,
		isCrab: sheet.isCrab,
		isToxic: sheet.isToxic,
		scale: balance.scale,
		spawnYMinRatio: balance.spawnYMinRatio,
		spawnYMaxRatio: balance.spawnYMaxRatio,
		caughtOffsetX: balance.caughtOffsetX ?? bigFishDefaults?.caughtOffsetX ?? 0,
		caughtOffsetY: balance.caughtOffsetY ?? bigFishDefaults?.caughtOffsetY ?? 0,
	};
}

function numbered(
	prefix: string,
	count: number,
	category: CreatureCategory,
	animSuffix: "swim" | "walk",
): CreatureDefinition[] {
	const list: CreatureDefinition[] = [];
	for (let i = 1; i <= count; i += 1) {
		const id = `${prefix}-${String(i).padStart(2, "0")}`;
		list.push(buildCreature(id, category, animSuffix));
	}
	return list;
}

/**
 * Combined Fishes + Fishes 2 row counts (source order) + crab tab:
 * Small 14, Toxic Jelly 9, Big 6, Normal crab 2, Rare crab 2 = 33.
 */
export const CREATURE_CATALOG: readonly CreatureDefinition[] = [
	...numbered("small-fish", 14, "Small Fish", "swim"),
	...numbered("toxic-jelly", 9, "Toxic Jelly", "swim"),
	...numbered("big-fish", 6, "Big Fish", "swim"),
	...numbered("normal-crab", 2, "Normal crab", "walk"),
	...numbered("rare-crab", 2, "Rare crab", "walk"),
];

if (CREATURE_CATALOG.length !== 33) {
	throw new Error(
		`CREATURE_CATALOG must contain 33 entries, got ${CREATURE_CATALOG.length}`,
	);
}

{
	const catalogIds = new Set(CREATURE_CATALOG.map((c) => c.id));
	const balanceIds = new Set(CREATURE_BALANCE.map((b) => b.id));
	for (const id of catalogIds) {
		if (!balanceIds.has(id)) {
			throw new Error(`Catalog id missing CreatureBalance entry: ${id}`);
		}
	}
	for (const id of balanceIds) {
		if (!catalogIds.has(id)) {
			throw new Error(`CreatureBalance id missing from catalog: ${id}`);
		}
	}
}

export function assertCreatureWeight(
	value: unknown,
): asserts value is CreatureWeight {
	if (value !== "Light" && value !== "Medium" && value !== "Heavy") {
		throw new Error(`Invalid creature weight: ${String(value)}`);
	}
}

for (const creature of CREATURE_CATALOG) {
	assertCreatureWeight(creature.weight);
}

{
	const bigFish = CREATURE_CATALOG.filter((c) =>
		c.id.startsWith("big-fish-"),
	);
	if (bigFish.length !== 6) {
		throw new Error(
			`Expected exactly 6 big-fish-* catalog entries, got ${bigFish.length}`,
		);
	}
	for (const creature of bigFish) {
		if (creature.category !== "Big Fish") {
			throw new Error(
				`${creature.id} must have category "Big Fish", got ${creature.category}`,
			);
		}
		if (creature.weight !== "Heavy") {
			throw new Error(
				`${creature.id} must have weight "Heavy", got ${creature.weight}`,
			);
		}
		if (creature.retractSpeed !== PULL_SPEED_BY_WEIGHT.Heavy) {
			throw new Error(
				`${creature.id} retractSpeed must be ${PULL_SPEED_BY_WEIGHT.Heavy}, got ${creature.retractSpeed}`,
			);
		}
	}

	const byCategory: Record<CreatureCategory, CreatureWeight> = {
		"Small Fish": "Light",
		"Toxic Jelly": "Medium",
		"Big Fish": "Heavy",
		"Normal crab": "Light",
		"Rare crab": "Light",
	};
	for (const creature of CREATURE_CATALOG) {
		const expected = byCategory[creature.category];
		if (creature.weight !== expected) {
			throw new Error(
				`${creature.id} (${creature.category}) must have weight "${expected}", got "${creature.weight}"`,
			);
		}
	}
}

export function getCreatureById(
	id: string,
): CreatureDefinition | undefined {
	return CREATURE_CATALOG.find((c) => c.id === id);
}

/** Midpoint (or representative) numeric value for Sprite data. */
export function representativeValue(value: CreatureValueSpec): number {
	return (value.min + value.max) / 2;
}
