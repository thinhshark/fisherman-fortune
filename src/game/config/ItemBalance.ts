/**
 * Per-item gameplay balance — chỉnh từng vật phẩm tại đây.
 *
 * SIZE GUIDE:
 * scale: 1.0 = original image size
 * scale: 0.5 = half size
 * scale: 1.2 = 20% larger
 * Keep scale greater than 0.
 * maxDisplaySize: when set, spawn scale = maxDisplaySize / max(texW, texH)
 *   so different PNG resolutions can share the same on-screen footprint.
 *
 * - enabled: false = never spawn (asset files stay in the pack)
 * - rewardType: score | time | gift | bomb | none
 * - scoreValue: fixed money for score items (scrap / gems / pearl)
 * - scoreMin/scoreMax: gift money range (inclusive)
 * - timeValue: fixed seconds for time items (star)
 * - timeMin/timeMax: gift time range (inclusive)
 * - spawnInterval: seconds between spawn attempts (0 = no repeating timer)
 * - maxSpawnsPerSession: lifetime cap for this session (0 = unlimited)
 * - allowMultipleActive: true = many of this type may exist on the map at once
 * - explosionRadius: barrel blast radius in logical pixels
 * - spawnWeight: relative chance when several due items compete for one slot
 * - giftMoneyWeight / giftTimeWeight: legacy odds; Gift uses GIFT_CONFIG
 * - giftVoucherEnabled: must stay false (voucher path is disabled)
 * - retractSpeed: tốc độ kéo lên; số càng nhỏ càng nặng/chậm
 * - scale: kích thước hiển thị (mỗi vật phẩm chỉnh riêng)
 *
 * Texture mapping notes:
 * - bag.png = Gift (question-mark sack), NOT scrap
 * - bonus-power.png = real Star time-bonus (cute starfish)
 * - star.png = white four-point glow / "light" — disabled from gameplay
 * - Scrap textures: bone, skull
 */

import type Phaser from "phaser";

export type ItemWeight = "Very Light" | "Light" | "Medium" | "Heavy";
export type SpawnZoneLabel = "Upper" | "Middle" | "Lower";
export type RewardOperation = "add" | "subtract";
export type ItemRewardType = "score" | "time" | "gift" | "bomb" | "none";
/** @deprecated Use `ItemRewardType`. Kept for existing catch/audio call sites. */
export type ItemEffectType =
	| "scrap"
	| "gem"
	| "time"
	| "bomb"
	| "power"
	| "gift";

/**
 * Bag/Gift outcome — exactly one of money or time per delivery.
 * moneyChance + timeChance must equal 1. No voucher path.
 */
export const GIFT_CONFIG = {
	moneyChance: 0.5,
	moneyMin: 100,
	moneyMax: 500,
	timeChance: 0.5,
	timeMinSeconds: 15,
	timeMaxSeconds: 45,
} as const;

{
	const { moneyChance, timeChance } = GIFT_CONFIG;
	if (
		typeof moneyChance !== "number" ||
		typeof timeChance !== "number" ||
		Math.abs(moneyChance + timeChance - 1) > 1e-9
	) {
		throw new Error("GIFT_CONFIG moneyChance + timeChance must equal 1");
	}
	if (GIFT_CONFIG.timeMaxSeconds > 45) {
		throw new Error("Gift time must never exceed 45 seconds");
	}
}
export interface ItemBalanceEntry {
	id: string;
	enabled: boolean;
	textureKey: string;
	/** Animation key, or null for static images. */
	animationKey: string | null;
	scale: number;
	rewardType: ItemRewardType;
	/** Legacy catch/audio grouping. */
	effectType: ItemEffectType;
	scoreValue: number;
	scoreMin: number;
	scoreMax: number;
	timeValue: number;
	timeMin: number;
	timeMax: number;
	/** Seconds between spawn attempts. 0 = no repeating schedule. */
	spawnInterval: number;
	/** 0 = unlimited lifetime spawns this session. */
	maxSpawnsPerSession: number;
	/**
	 * When true, more than one instance may be active at once (barrels).
	 * Default / omitted = only one of this type on the map.
	 */
	allowMultipleActive?: boolean;
	explosionRadius: number;
	weight: ItemWeight;
	spawnZones: readonly SpawnZoneLabel[];
	retractSpeed: number;
	spawnWeight: number;
	/** Spawn once when gameplay starts (the two scrap types). */
	spawnAtStart: boolean;
	/** One delayed spawn at a random time this session (pearl). */
	randomOnce: boolean;
	/** Inclusive random delay window in seconds (randomOnce items). */
	spawnDelayMin: number;
	spawnDelayMax: number;
	giftMoneyWeight: number;
	giftTimeWeight: number;
	giftVoucherEnabled: boolean;
	/** Always "add" for live items — scrap must never subtract. */
	rewardOperation: RewardOperation;
	/**
	 * If set, display scale is derived at spawn from texture size so the
	 * longest side equals this many logical pixels (aspect preserved).
	 * Prefer this over raw `scale` when source PNGs differ in resolution.
	 */
	maxDisplaySize?: number | null;
}

/** Construct 1920 → Phaser 1280 uniform scale for 1:1 source art. */
const SCALE_NATIVE = 1280 / 1920;
/** Construct Level skulls use width 116 on 130px art. */
const SCALE_SKULL = (116 / 130) * SCALE_NATIVE;

/**
 * Pearl source PNG is much larger than diamond/ruby (~80px). Match their
 * on-screen footprint via max longest side, not the same raw scale number.
 */
export const PEARL_MAX_DISPLAY_SIZE = 52;
/** Catch hit box as a fraction of displayed width/height (centered). */
export const PEARL_HIT_SIZE_FRAC = 0.8;

/**
 * Resolve final display scale. When `maxDisplaySize` is set, scale from the
 * loaded texture so longest side ≈ that size; otherwise use `scale`.
 */
export function resolveItemDisplayScale(
	entry: Pick<ItemBalanceEntry, "scale" | "maxDisplaySize" | "textureKey">,
	textures: Phaser.Textures.TextureManager,
): number {
	const maxSize = entry.maxDisplaySize;
	if (typeof maxSize === "number" && maxSize > 0) {
		const frame = textures.get(entry.textureKey).get();
		const longest = Math.max(frame.width, frame.height);
		if (longest > 0) {
			return maxSize / longest;
		}
	}
	return entry.scale;
}

/**
 * TEMP: Very Light has no creature retract mapping yet.
 * Faster than Light (500) so scrap feels lighter on the hook.
 */
const RETRACT_VERY_LIGHT = 450;
const RETRACT_LIGHT = 350;

const ALL_UNDERWATER: readonly SpawnZoneLabel[] = ["Upper", "Middle", "Lower"];

function unusedDefaults(
	partial: Pick<
		ItemBalanceEntry,
		| "id"
		| "textureKey"
		| "animationKey"
		| "scale"
		| "weight"
		| "spawnZones"
		| "effectType"
	>,
): ItemBalanceEntry {
	return {
		enabled: false,
		rewardType: "none",
		scoreValue: 0,
		scoreMin: 0,
		scoreMax: 0,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 0,
		maxSpawnsPerSession: 0,
		explosionRadius: 0,
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 0,
		spawnAtStart: false,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
		...partial,
	};
}

export const ITEM_BALANCE: readonly ItemBalanceEntry[] = [
	// --- Scrap (bone + skull only; bag is Gift) ---
	{
		id: "bone",
		enabled: true,
		textureKey: "bone",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "score",
		effectType: "scrap",
		scoreValue: 1,
		scoreMin: 1,
		scoreMax: 1,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 0,
		maxSpawnsPerSession: 1,
		explosionRadius: 0,
		weight: "Very Light",
		spawnZones: ["Upper", "Middle"],
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},
	{
		id: "skull",
		enabled: true,
		textureKey: "skull",
		animationKey: null,
		scale: SCALE_SKULL,
		rewardType: "score",
		effectType: "scrap",
		scoreValue: 1,
		scoreMin: 1,
		scoreMax: 1,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 0,
		maxSpawnsPerSession: 1,
		explosionRadius: 0,
		weight: "Very Light",
		spawnZones: ["Upper", "Middle"],
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},

	// --- Star time bonus: cute starfish art lives under texture key bonus-power ---
	{
		id: "star",
		enabled: true,
		textureKey: "bonus-power",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "time",
		effectType: "time",
		scoreValue: 0,
		scoreMin: 0,
		scoreMax: 0,
		timeValue: 15,
		timeMin: 15,
		timeMax: 15,
		spawnInterval: 45,
		maxSpawnsPerSession: 0,
		explosionRadius: 0,
		weight: "Very Light",
		spawnZones: ["Middle", "Lower"],
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 3,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},

	// --- Gems ---
	{
		id: "diamond",
		enabled: true,
		textureKey: "diamond",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "score",
		effectType: "gem",
		scoreValue: 300,
		scoreMin: 300,
		scoreMax: 300,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 30,
		maxSpawnsPerSession: 0,
		explosionRadius: 0,
		weight: "Light",
		spawnZones: ["Middle", "Lower"],
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 3,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},
	{
		id: "emerald",
		enabled: true,
		textureKey: "emerald",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "score",
		effectType: "gem",
		scoreValue: 400,
		scoreMin: 400,
		scoreMax: 400,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 40,
		maxSpawnsPerSession: 2,
		explosionRadius: 0,
		weight: "Light",
		spawnZones: ["Middle", "Lower"],
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 2,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},
	{
		id: "ruby",
		enabled: true,
		textureKey: "ruby",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "score",
		effectType: "gem",
		scoreValue: 500,
		scoreMin: 500,
		scoreMax: 500,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 40,
		maxSpawnsPerSession: 2,
		explosionRadius: 0,
		weight: "Light",
		spawnZones: ["Middle", "Lower"],
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 2,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},
	{
		id: "pearl",
		enabled: true,
		textureKey: "pearl",
		animationKey: null,
		scale: 1,
		maxDisplaySize: PEARL_MAX_DISPLAY_SIZE,
		rewardType: "score",
		effectType: "gem",
		scoreValue: 1000,
		scoreMin: 1000,
		scoreMax: 1000,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 0,
		maxSpawnsPerSession: 1,
		explosionRadius: 0,
		weight: "Light",
		spawnZones: ["Lower"],
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 1,
		spawnAtStart: true,
		randomOnce: true,
		spawnDelayMin: 10,
		spawnDelayMax: 80,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},

	// --- Gift = bag texture (question-mark sack) ---
	{
		id: "bag",
		enabled: true,
		textureKey: "bag",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "gift",
		effectType: "gift",
		scoreValue: 0,
		scoreMin: 100,
		scoreMax: 500,
		timeValue: 0,
		timeMin: 15,
		timeMax: 45,
		spawnInterval: 30,
		maxSpawnsPerSession: 0,
		explosionRadius: 0,
		weight: "Light",
		spawnZones: ["Lower"],
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 1,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 1,
		giftTimeWeight: 1,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},

	{
		id: "barrel",
		enabled: true,
		textureKey: "barrel",
		animationKey: null,
		scale: SCALE_NATIVE,
		rewardType: "bomb",
		effectType: "bomb",
		scoreValue: -500,
		scoreMin: 0,
		scoreMax: 0,
		timeValue: 0,
		timeMin: 0,
		timeMax: 0,
		spawnInterval: 30,
		maxSpawnsPerSession: 0,
		allowMultipleActive: true,
		explosionRadius: 200,
		weight: "Light",
		spawnZones: ALL_UNDERWATER,
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 2,
		spawnAtStart: true,
		randomOnce: false,
		spawnDelayMin: 0,
		spawnDelayMax: 0,
		giftMoneyWeight: 0,
		giftTimeWeight: 0,
		giftVoucherEnabled: false,
		rewardOperation: "add",
	},

	// --- Disabled: white glow light (texture "star"), legacy / unused ---
	unusedDefaults({
		id: "light",
		textureKey: "star",
		animationKey: null,
		scale: SCALE_NATIVE,
		weight: "Very Light",
		spawnZones: ["Middle", "Lower"],
		effectType: "time",
	}),
	unusedDefaults({
		id: "bonus-bomb",
		textureKey: "bonus-bomb",
		animationKey: null,
		scale: SCALE_NATIVE,
		weight: "Light",
		spawnZones: ["Middle", "Lower"],
		effectType: "bomb",
	}),
	unusedDefaults({
		id: "gift",
		textureKey: "bag",
		animationKey: null,
		scale: SCALE_NATIVE,
		weight: "Light",
		spawnZones: ["Lower"],
		effectType: "gift",
	}),
];

if (ITEM_BALANCE.length !== 12) {
	throw new Error(
		`ITEM_BALANCE must contain 12 world-item entries, got ${ITEM_BALANCE.length}`,
	);
}

export type GiftOutcome =
	| { kind: "money"; amount: number }
	| { kind: "time"; seconds: number };

/**
 * Exactly one gift outcome (money XOR time). Voucher is never selected.
 * Uses GIFT_CONFIG chances/ranges; balance gift* fields stay as documentation sync.
 */
export function pickGiftOutcome(
	balance: ItemBalanceEntry,
	random01: () => number = Math.random,
	randomInt: (min: number, max: number) => number = (min, max) => {
		const lo = Math.min(min, max);
		const hi = Math.max(min, max);
		return lo + Math.floor(random01() * (hi - lo + 1));
	},
): GiftOutcome {
	if (balance.giftVoucherEnabled) {
		throw new Error("Gift voucher outcome is disabled and must not run");
	}
	if (balance.rewardType !== "gift" || balance.effectType === "scrap") {
		throw new Error("pickGiftOutcome is only valid for Gift (bag), not Scrap");
	}

	const roll = random01();
	if (roll < GIFT_CONFIG.moneyChance) {
		return {
			kind: "money",
			amount: randomInt(GIFT_CONFIG.moneyMin, GIFT_CONFIG.moneyMax),
		};
	}
	return {
		kind: "time",
		seconds: randomInt(
			GIFT_CONFIG.timeMinSeconds,
			GIFT_CONFIG.timeMaxSeconds,
		),
	};
}

{
	const ids = new Set<string>();
	for (const entry of ITEM_BALANCE) {
		if (ids.has(entry.id)) {
			throw new Error(`Duplicate ItemBalance id: ${entry.id}`);
		}
		ids.add(entry.id);
		if (
			typeof entry.scale !== "number" ||
			!Number.isFinite(entry.scale) ||
			entry.scale <= 0
		) {
			console.error(
				`[ItemBalance] ${entry.id}: scale must be a finite number > 0 (got ${String(entry.scale)}). Using fallback ${SCALE_NATIVE}.`,
			);
			(entry as { scale: number }).scale = SCALE_NATIVE;
		}
		if (entry.rewardOperation === "subtract") {
			throw new Error(`${entry.id} must never subtract score`);
		}
	}

	const bone = ITEM_BALANCE_BY_ID_UNCHECKED("bone");
	const skull = ITEM_BALANCE_BY_ID_UNCHECKED("skull");
	const star = ITEM_BALANCE_BY_ID_UNCHECKED("star");
	const bag = ITEM_BALANCE_BY_ID_UNCHECKED("bag");
	const light = ITEM_BALANCE_BY_ID_UNCHECKED("light");
	const diamond = ITEM_BALANCE_BY_ID_UNCHECKED("diamond");
	const emerald = ITEM_BALANCE_BY_ID_UNCHECKED("emerald");
	const ruby = ITEM_BALANCE_BY_ID_UNCHECKED("ruby");
	const pearl = ITEM_BALANCE_BY_ID_UNCHECKED("pearl");
	const barrel = ITEM_BALANCE_BY_ID_UNCHECKED("barrel");

	if (bone.scoreValue !== 1 || skull.scoreValue !== 1) {
		throw new Error("Both scrap types must award exactly +1$");
	}
	if (bone.effectType !== "scrap" || skull.effectType !== "scrap") {
		throw new Error("bone and skull must remain scrap");
	}
	if (bag.rewardType !== "gift" || bag.textureKey !== "bag") {
		throw new Error("bag must be Gift with bag texture");
	}
	if (bag.giftVoucherEnabled || bag.scoreMin !== 100 || bag.scoreMax !== 500) {
		throw new Error("Gift bag money range / voucher flag invalid");
	}
	if (
		bag.timeMin !== GIFT_CONFIG.timeMinSeconds ||
		bag.timeMax !== GIFT_CONFIG.timeMaxSeconds
	) {
		throw new Error("Gift bag time range must match GIFT_CONFIG");
	}
	if (bag.effectType === "scrap" || bag.scoreValue === 1) {
		throw new Error("Bag must not use Scrap +1$ reward logic");
	}
	if (star.timeValue !== 15 || star.textureKey !== "bonus-power") {
		throw new Error("Star must use bonus-power texture and add +15s");
	}
	if (light.enabled || light.textureKey !== "star") {
		throw new Error('light must be disabled and keep textureKey "star"');
	}
	if (diamond.scoreValue !== 300) {
		throw new Error("Diamond must award exactly +300$");
	}
	if (emerald.scoreValue !== 400 || emerald.maxSpawnsPerSession !== 2) {
		throw new Error("Emerald must award +400$ with max 2 spawns");
	}
	if (ruby.scoreValue !== 500 || ruby.maxSpawnsPerSession !== 2) {
		throw new Error("Ruby must award +500$ with max 2 spawns");
	}
	if (
		pearl.textureKey !== "pearl" ||
		pearl.scoreValue !== 1000 ||
		pearl.scoreMin !== 1000 ||
		pearl.scoreMax !== 1000 ||
		pearl.maxSpawnsPerSession !== 1 ||
		!pearl.randomOnce ||
		!pearl.spawnAtStart ||
		pearl.animationKey !== null ||
		pearl.maxDisplaySize !== PEARL_MAX_DISPLAY_SIZE
	) {
		throw new Error(
			"Pearl must use texture pearl, award +1000$ once, spawnAtStart, randomOnce, maxDisplaySize 52",
		);
	}
	if (barrel.explosionRadius !== 200) {
		throw new Error("Barrel explosionRadius must be 200");
	}
	if (barrel.scoreValue !== -500) {
		throw new Error("Barrel must deduct exactly 500 score on explode");
	}
	if (barrel.spawnInterval !== 30) {
		throw new Error("Barrel spawnInterval must be 30 seconds");
	}
	if (barrel.allowMultipleActive !== true) {
		throw new Error("Barrel must allow multiple active instances");
	}
}

function ITEM_BALANCE_BY_ID_UNCHECKED(id: string): ItemBalanceEntry {
	const entry = ITEM_BALANCE.find((item) => item.id === id);
	if (!entry) {
		throw new Error(`Missing ItemBalance id: ${id}`);
	}
	return entry;
}

export const ITEM_BALANCE_BY_ID: Readonly<Record<string, ItemBalanceEntry>> =
	Object.fromEntries(ITEM_BALANCE.map((e) => [e.id, e]));

export function getItemBalance(id: string): ItemBalanceEntry | undefined {
	return ITEM_BALANCE_BY_ID[id];
}

export function isItemEnabled(id: string): boolean {
	return ITEM_BALANCE_BY_ID[id]?.enabled === true;
}
