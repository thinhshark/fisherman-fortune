/**
 * Per-item gameplay balance — chỉnh từng vật phẩm tại đây.
 *
 * SIZE GUIDE:
 * scale: 1.0 = original image size
 * scale: 0.5 = half size
 * scale: 1.2 = 20% larger
 * Keep scale greater than 0.
 *
 * - rewardMin/rewardMax: khoảng điểm
 * - rewardOperation: add | subtract
 * - effectType: scrap | gem | valuable | time | bomb | power
 * - timeBonusSeconds: cộng giây (0 nếu không phải time item)
 * - retractSpeed: tốc độ kéo lên; số càng nhỏ càng nặng/chậm
 * - spawnWeight: xác suất xuất hiện tương đối
 * - scale: kích thước hiển thị (mỗi vật phẩm chỉnh riêng)
 *
 * Mỗi entry được viết tường minh (không generate runtime).
 *
 * Nguồn:
 * - Google Sheet tab "Others"
 * - Construct layouts/objectTypes (Reward instance vars, world sizes)
 *
 * Pending effects (emit bonus-collected only): bomb, power.
 */

export type ItemWeight = "Very Light" | "Light" | "Medium" | "Heavy";
export type SpawnZoneLabel = "Upper" | "Middle" | "Lower";
export type RewardOperation = "add" | "subtract";
export type ItemEffectType =
	| "scrap"
	| "gem"
	| "valuable"
	| "time"
	| "bomb"
	| "power";

export interface ItemBalanceEntry {
	id: string;
	textureKey: string;
	/** Animation key, or null for static images. */
	animationKey: string | null;
	rewardMin: number;
	rewardMax: number;
	rewardOperation: RewardOperation;
	effectType: ItemEffectType;
	/** Seconds added on delivery; 0 when unused. */
	timeBonusSeconds: number;
	weight: ItemWeight;
	retractSpeed: number;
	spawnWeight: number;
	spawnZones: readonly SpawnZoneLabel[];
	scale: number;
}

/** Construct 1920 → Phaser 1280 uniform scale for 1:1 source art. */
const SCALE_NATIVE = 1280 / 1920;
/** Construct Level skulls use width 116 on 130px art. */
const SCALE_SKULL = (116 / 130) * SCALE_NATIVE;

/**
 * TEMP: Very Light has no creature retract mapping yet.
 * Faster than Light (500) so scrap feels lighter on the hook.
 */
const RETRACT_VERY_LIGHT = 650;
const RETRACT_LIGHT = 500;

export const ITEM_BALANCE: readonly ItemBalanceEntry[] = [
	// --- Scrap (sheet: Scrap $1–2, Very Light, Upper/Middle; Construct Rewards) ---
	{
		id: "bag",
		textureKey: "bag",
		animationKey: null,
		// Construct Level instances: Reward = 6 (sheet Scrap rows only list 1–2).
		rewardMin: 6,
		rewardMax: 6,
		rewardOperation: "add",
		effectType: "scrap",
		timeBonusSeconds: 0,
		weight: "Very Light",
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5, // sheet Frequency: each 30s
		spawnZones: ["Upper", "Middle"],
		scale: SCALE_NATIVE,
	},
	{
		id: "barrel",
		textureKey: "barrel",
		animationKey: null,
		// TEMP: Construct Barrel has no Reward var; sheet Scrap row 2 value = 2.
		rewardMin: 2,
		rewardMax: 2,
		rewardOperation: "add",
		effectType: "scrap",
		timeBonusSeconds: 0,
		weight: "Very Light",
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		scale: SCALE_NATIVE,
	},
	{
		id: "bone",
		textureKey: "bone",
		animationKey: null,
		// Construct Level instances: Reward = 1
		rewardMin: 1,
		rewardMax: 1,
		rewardOperation: "add",
		effectType: "scrap",
		timeBonusSeconds: 0,
		weight: "Very Light",
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		scale: SCALE_NATIVE,
	},
	{
		id: "skull",
		textureKey: "skull",
		animationKey: null,
		// Construct Level instances: Reward = 3
		rewardMin: 3,
		rewardMax: 3,
		rewardOperation: "add",
		effectType: "scrap",
		timeBonusSeconds: 0,
		weight: "Very Light",
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 5,
		spawnZones: ["Upper", "Middle"],
		scale: SCALE_SKULL,
	},

	// --- Gems (sheet Others values + zones; Construct Reward noted where different) ---
	{
		id: "diamond",
		textureKey: "diamond",
		animationKey: null,
		// Sheet Others: 300. Construct layouts use Reward 500 — prefer sheet.
		rewardMin: 300,
		rewardMax: 300,
		rewardOperation: "add",
		effectType: "gem",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 3, // sheet: spawn 1 item each 30s
		spawnZones: ["Middle", "Lower"],
		scale: SCALE_NATIVE,
	},
	{
		id: "emerald",
		textureKey: "emerald",
		animationKey: null,
		// Sheet + Construct: 400
		rewardMin: 400,
		rewardMax: 400,
		rewardOperation: "add",
		effectType: "gem",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 2, // TEMP relative: sheet Frequency blank (same gem group as diamond)
		spawnZones: ["Middle", "Lower"],
		scale: SCALE_NATIVE,
	},
	{
		id: "ruby",
		textureKey: "ruby",
		animationKey: null,
		// Sheet Others: 500. Construct layouts use Reward 300 — prefer sheet.
		rewardMin: 500,
		rewardMax: 500,
		rewardOperation: "add",
		effectType: "gem",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 2, // TEMP relative: sheet Frequency blank
		spawnZones: ["Middle", "Lower"],
		scale: SCALE_NATIVE,
	},
	{
		id: "star",
		textureKey: "star",
		animationKey: null,
		// TEMP: sheet Value ($) blank — treated as time bonus item (+10s).
		rewardMin: 0,
		rewardMax: 0,
		rewardOperation: "add",
		effectType: "time",
		timeBonusSeconds: 10,
		weight: "Very Light",
		retractSpeed: RETRACT_VERY_LIGHT,
		spawnWeight: 3, // sheet: each 45s
		spawnZones: ["Middle", "Lower"],
		scale: SCALE_NATIVE,
	},
	{
		id: "valuable",
		textureKey: "valuable-001",
		animationKey: "valuable",
		// Sheet Pearl row: 1000, rare, Lower (Gift row has blank value — Pearl used).
		rewardMin: 1000,
		rewardMax: 1000,
		rewardOperation: "add",
		effectType: "valuable",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 1, // sheet: rare
		spawnZones: ["Lower"],
		// TEMP: source frames are 7–18px; scale up so the sparkle is visible underwater.
		scale: 3,
	},

	// --- Bonuses (PENDING gameplay; emit bonus-collected only) ---
	{
		id: "bonus-bomb",
		textureKey: "bonus-bomb",
		animationKey: null,
		// TEMP / PENDING: bomb effect not implemented yet.
		rewardMin: 0,
		rewardMax: 0,
		rewardOperation: "add",
		effectType: "bomb",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 1, // TEMP rare
		spawnZones: ["Middle", "Lower"], // TEMP: not on sheet
		scale: SCALE_NATIVE,
	},
	{
		id: "bonus-power",
		textureKey: "bonus-power",
		animationKey: null,
		// TEMP / PENDING: power effect not implemented yet.
		rewardMin: 0,
		rewardMax: 0,
		rewardOperation: "add",
		effectType: "power",
		timeBonusSeconds: 0,
		weight: "Light",
		retractSpeed: RETRACT_LIGHT,
		spawnWeight: 1, // TEMP rare
		spawnZones: ["Middle", "Lower"], // TEMP: not on sheet
		scale: SCALE_NATIVE,
	},
];

if (ITEM_BALANCE.length !== 11) {
	throw new Error(
		`ITEM_BALANCE must contain 11 world-item entries, got ${ITEM_BALANCE.length}`,
	);
}

{
	const ids = new Set<string>();
	for (const entry of ITEM_BALANCE) {
		if (ids.has(entry.id)) {
			throw new Error(`Duplicate ItemBalance id: ${entry.id}`);
		}
		ids.add(entry.id);
		if (
			typeof entry.timeBonusSeconds !== "number" ||
			!Number.isFinite(entry.timeBonusSeconds) ||
			entry.timeBonusSeconds < 0
		) {
			throw new Error(
				`${entry.id} timeBonusSeconds must be a finite number >= 0`,
			);
		}
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
	}
}

export const ITEM_BALANCE_BY_ID: Readonly<Record<string, ItemBalanceEntry>> =
	Object.fromEntries(ITEM_BALANCE.map((e) => [e.id, e]));

export function getItemBalance(id: string): ItemBalanceEntry | undefined {
	return ITEM_BALANCE_BY_ID[id];
}
