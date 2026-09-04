/**
 * Creature definitions derived from the Fisherman Fortune Google Sheets
 * (Fishes + Fishes 2 + Crabs) and mapped onto Phaser animation keys.
 *
 * Speed labels are qualitative in the sheet (Fast / Medium / Slow).
 * Construct Bullet speeds were ~30–140 px/s at 1920×1080 and did not match
 * the sheet’s Fast>Medium>Slow intent (small fish were slower bullets there).
 * We convert sheet labels through SPEED_LABEL_TO_PX_PER_SEC_AT_1920, then
 * multiply by SCENE_SPEED_SCALE (1280/1920) for the Phaser scene.
 */

export type CreatureCategory =
	| "Small Fish"
	| "Jelly"
	| "Big Fish"
	| "Toxic Fish"
	| "Normal crab"
	| "Rare crab";

export type SpeedLabel = "Fast" | "Medium" | "Slow";
export type WeightLabel = "Light" | "Medium" | "Heavy";
export type FrequencyLabel = "Often" | "Normal" | "Medium" | "Seldom";
export type SpawnZoneLabel = "Upper" | "Middle" | "Lower";
export type Facing = "right" | "left";

/** Construct layout resolution → Phaser Level resolution. */
export const SCENE_SPEED_SCALE = 1280 / 1920;

/**
 * Spreadsheet speed labels → px/s at Construct 1920×1080, chosen so
 * Fast > Medium > Slow while staying in the same order of magnitude as
 * Construct Bullet speeds (~30–140).
 */
export const SPEED_LABEL_TO_PX_PER_SEC_AT_1920: Record<SpeedLabel, number> = {
	Fast: 120,
	Medium: 80,
	Slow: 45,
};

/** Frequency labels → relative spawn weights. */
export const FREQUENCY_WEIGHT: Record<FrequencyLabel, number> = {
	Often: 5,
	Normal: 3,
	Medium: 3,
	Seldom: 1,
};

/**
 * Uniform display scales (Construct layout avg × SCENE_SPEED_SCALE).
 * Toxic fish reuse Big Fish art sizes → big-fish scale.
 */
export const CATEGORY_DISPLAY_SCALE: Record<CreatureCategory, number> = {
	"Small Fish": 0.3936,
	Jelly: 0.688,
	"Big Fish": 0.4597,
	"Toxic Fish": 0.4597,
	"Normal crab": 0.435,
	"Rare crab": 0.435,
};

export interface CreatureValueSpec {
	/** Original spreadsheet cell text. */
	raw: string;
	min: number;
	max: number;
}

export interface CategorySheetConfig {
	category: CreatureCategory;
	value: CreatureValueSpec;
	speedLabel: SpeedLabel;
	weightLabel: WeightLabel;
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
	/** Pixels per second at the Phaser scene resolution. */
	movementSpeed: number;
	/** Raw spreadsheet speed label. */
	speedLabel: SpeedLabel;
	weight: WeightLabel;
	frequencyWeight: number;
	frequencyLabel: FrequencyLabel;
	spawnZone: readonly SpawnZoneLabel[];
	defaultFacing: Facing;
	isCrab: boolean;
	isToxic: boolean;
	displayScale: number;
}

function pxSpeed(label: SpeedLabel): number {
	return SPEED_LABEL_TO_PX_PER_SEC_AT_1920[label] * SCENE_SPEED_SCALE;
}

function valueSpec(raw: string, min: number, max: number): CreatureValueSpec {
	return { raw, min, max };
}

/** Shared sheet rows (identical within each Type after combining tabs). */
export const CATEGORY_SHEET_CONFIG: Record<CreatureCategory, CategorySheetConfig> =
	{
		"Small Fish": {
			category: "Small Fish",
			value: valueSpec("<50", 1, 49),
			speedLabel: "Fast",
			weightLabel: "Light",
			frequencyLabel: "Often",
			spawnZones: ["Upper", "Middle"],
			isCrab: false,
			isToxic: false,
		},
		Jelly: {
			category: "Jelly",
			value: valueSpec("50-100", 50, 100),
			speedLabel: "Medium",
			weightLabel: "Medium",
			// Fishes tab: Medium; Fishes 2: Normal — same weight.
			frequencyLabel: "Normal",
			spawnZones: ["Middle", "Lower"],
			isCrab: false,
			isToxic: false,
		},
		"Big Fish": {
			category: "Big Fish",
			value: valueSpec("150-200", 150, 200),
			speedLabel: "Slow",
			weightLabel: "Heavy",
			frequencyLabel: "Seldom",
			spawnZones: ["Lower"],
			isCrab: false,
			isToxic: false,
		},
		"Toxic Fish": {
			category: "Toxic Fish",
			value: valueSpec("trừ 1-50$", -50, -1),
			speedLabel: "Medium",
			weightLabel: "Light",
			frequencyLabel: "Medium",
			spawnZones: ["Upper", "Middle"],
			isCrab: false,
			isToxic: true,
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
	defaultFacing: Facing,
): CreatureDefinition {
	const sheet = CATEGORY_SHEET_CONFIG[category];
	const animationKey = `${id}-${animSuffix}`;
	return {
		id,
		category,
		textureKey: `${animationKey}-001`,
		animationKey,
		value: sheet.value,
		movementSpeed: pxSpeed(sheet.speedLabel),
		speedLabel: sheet.speedLabel,
		weight: sheet.weightLabel,
		frequencyWeight: FREQUENCY_WEIGHT[sheet.frequencyLabel],
		frequencyLabel: sheet.frequencyLabel,
		spawnZone: sheet.spawnZones,
		defaultFacing,
		isCrab: sheet.isCrab,
		isToxic: sheet.isToxic,
		displayScale: CATEGORY_DISPLAY_SCALE[category],
	};
}

/**
 * Per-asset facing from first animation frame inspection.
 * Crabs are front-facing/symmetrical; Construct Bullet speed is -30 (left)
 * with no Mirrored flag, so source art is treated as facing left.
 */
const DEFAULT_FACING_BY_ID: Readonly<Record<string, Facing>> = {
	"small-fish-01": "left",
	"small-fish-02": "left",
	"small-fish-03": "right",
	"small-fish-04": "left",
	"small-fish-05": "left",
	"small-fish-06": "right",
	"small-fish-07": "left",
	"small-fish-08": "left",
	"small-fish-09": "right",
	"small-fish-10": "right",
	"jelly-01": "left",
	"jelly-02": "right",
	"jelly-03": "left",
	"jelly-04": "right",
	"jelly-05": "left",
	"jelly-06": "right",
	"jelly-07": "right",
	"jelly-08": "left",
	"jelly-09": "right",
	"big-fish-01": "left",
	"big-fish-02": "right",
	"big-fish-03": "left",
	"big-fish-04": "right",
	"big-fish-05": "left",
	"big-fish-06": "right",
	"toxic-fish-01": "left",
	"toxic-fish-02": "right",
	"toxic-fish-03": "left",
	"toxic-fish-04": "right",
	"normal-crab-01": "left",
	"normal-crab-02": "left",
	"rare-crab-01": "left",
	"rare-crab-02": "left",
};

function numbered(
	prefix: string,
	count: number,
	category: CreatureCategory,
	animSuffix: "swim" | "walk",
): CreatureDefinition[] {
	const list: CreatureDefinition[] = [];
	for (let i = 1; i <= count; i += 1) {
		const id = `${prefix}-${String(i).padStart(2, "0")}`;
		const facing = DEFAULT_FACING_BY_ID[id];
		if (!facing) {
			throw new Error(`Missing defaultFacing for creature id: ${id}`);
		}
		list.push(buildCreature(id, category, animSuffix, facing));
	}
	return list;
}

/**
 * Combined Fishes + Fishes 2 row counts (source order) + crab tab:
 * Small 10, Jelly 9, Big 6, Toxic 4, Normal crab 2, Rare crab 2 = 33.
 */
export const CREATURE_CATALOG: readonly CreatureDefinition[] = [
	...numbered("small-fish", 10, "Small Fish", "swim"),
	...numbered("jelly", 9, "Jelly", "swim"),
	...numbered("big-fish", 6, "Big Fish", "swim"),
	...numbered("toxic-fish", 4, "Toxic Fish", "swim"),
	...numbered("normal-crab", 2, "Normal crab", "walk"),
	...numbered("rare-crab", 2, "Rare crab", "walk"),
];

if (CREATURE_CATALOG.length !== 33) {
	throw new Error(
		`CREATURE_CATALOG must contain 33 entries, got ${CREATURE_CATALOG.length}`,
	);
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
