/**
 * Item definitions: identity + gameplay numbers from `config/ItemBalance`.
 */

import {
	ITEM_BALANCE,
	getItemBalance,
	type ItemBalanceEntry,
	type ItemEffectType,
	type ItemRewardType,
	type ItemWeight,
	type RewardOperation,
	type SpawnZoneLabel,
} from "./config/ItemBalance";

export type {
	ItemEffectType,
	ItemRewardType,
	ItemWeight,
	RewardOperation,
	SpawnZoneLabel,
};

export interface ItemDefinition {
	id: string;
	enabled: boolean;
	textureKey: string;
	animationKey: string | null;
	scale: number;
	maxDisplaySize: number | null;
	rewardType: ItemRewardType;
	effectType: ItemEffectType;
	scoreValue: number;
	scoreMin: number;
	scoreMax: number;
	timeValue: number;
	timeMin: number;
	timeMax: number;
	spawnInterval: number;
	maxSpawnsPerSession: number;
	explosionRadius: number;
	weight: ItemWeight;
	spawnZones: readonly SpawnZoneLabel[];
	retractSpeed: number;
	spawnWeight: number;
	spawnAtStart: boolean;
	randomOnce: boolean;
	spawnDelayMin: number;
	spawnDelayMax: number;
	giftMoneyWeight: number;
	giftTimeWeight: number;
	giftVoucherEnabled: boolean;
	rewardOperation: RewardOperation;
	/** @deprecated Use scoreMin. */
	rewardMin: number;
	/** @deprecated Use scoreMax. */
	rewardMax: number;
	/** @deprecated Use timeValue. */
	timeBonusSeconds: number;
}

function fromBalance(balance: ItemBalanceEntry): ItemDefinition {
	return {
		id: balance.id,
		enabled: balance.enabled,
		textureKey: balance.textureKey,
		animationKey: balance.animationKey,
		scale: balance.scale,
		maxDisplaySize:
			typeof balance.maxDisplaySize === "number"
				? balance.maxDisplaySize
				: null,
		rewardType: balance.rewardType,
		effectType: balance.effectType,
		scoreValue: balance.scoreValue,
		scoreMin: balance.scoreMin,
		scoreMax: balance.scoreMax,
		timeValue: balance.timeValue,
		timeMin: balance.timeMin,
		timeMax: balance.timeMax,
		spawnInterval: balance.spawnInterval,
		maxSpawnsPerSession: balance.maxSpawnsPerSession,
		explosionRadius: balance.explosionRadius,
		weight: balance.weight,
		spawnZones: balance.spawnZones,
		retractSpeed: balance.retractSpeed,
		spawnWeight: balance.spawnWeight,
		spawnAtStart: balance.spawnAtStart,
		randomOnce: balance.randomOnce,
		spawnDelayMin: balance.spawnDelayMin,
		spawnDelayMax: balance.spawnDelayMax,
		giftMoneyWeight: balance.giftMoneyWeight,
		giftTimeWeight: balance.giftTimeWeight,
		giftVoucherEnabled: balance.giftVoucherEnabled,
		rewardOperation: balance.rewardOperation,
		rewardMin: balance.scoreMin,
		rewardMax: balance.scoreMax,
		timeBonusSeconds: balance.timeValue,
	};
}

/** All catalog rows, including disabled unused items. */
export const ITEM_CATALOG: readonly ItemDefinition[] = ITEM_BALANCE.map(
	(entry) => fromBalance(entry),
);

export const ENABLED_ITEM_CATALOG: readonly ItemDefinition[] =
	ITEM_CATALOG.filter((item) => item.enabled);

if (ITEM_CATALOG.length !== 12) {
	throw new Error(
		`ITEM_CATALOG must contain 12 entries, got ${ITEM_CATALOG.length}`,
	);
}

{
	const forbidden = [
		"bag-trace",
		"barrel-trace",
		"bone-trace",
		"skull-trace",
		"bomb-button",
	];
	for (const item of ITEM_CATALOG) {
		if (forbidden.includes(item.textureKey)) {
			throw new Error(
				`ItemCatalog must not use reserved texture: ${item.textureKey}`,
			);
		}
		if (!getItemBalance(item.id)) {
			throw new Error(`ItemCatalog missing balance for ${item.id}`);
		}
	}
}

export function getItemById(id: string): ItemDefinition | undefined {
	return ITEM_CATALOG.find((item) => item.id === id);
}
