/**
 * Item definitions: identity + gameplay numbers from `config/ItemBalance`.
 */

import {
	ITEM_BALANCE,
	getItemBalance,
	type ItemBalanceEntry,
	type ItemEffectType,
	type ItemWeight,
	type RewardOperation,
	type SpawnZoneLabel,
} from "./config/ItemBalance";

export type {
	ItemEffectType,
	ItemWeight,
	RewardOperation,
	SpawnZoneLabel,
};

export interface ItemDefinition {
	id: string;
	textureKey: string;
	animationKey: string | null;
	rewardMin: number;
	rewardMax: number;
	rewardOperation: RewardOperation;
	effectType: ItemEffectType;
	timeBonusSeconds: number;
	weight: ItemWeight;
	retractSpeed: number;
	spawnWeight: number;
	spawnZones: readonly SpawnZoneLabel[];
	displayScale: number;
}

function fromBalance(balance: ItemBalanceEntry): ItemDefinition {
	return {
		id: balance.id,
		textureKey: balance.textureKey,
		animationKey: balance.animationKey,
		rewardMin: balance.rewardMin,
		rewardMax: balance.rewardMax,
		rewardOperation: balance.rewardOperation,
		effectType: balance.effectType,
		timeBonusSeconds: balance.timeBonusSeconds,
		weight: balance.weight,
		retractSpeed: balance.retractSpeed,
		spawnWeight: balance.spawnWeight,
		spawnZones: balance.spawnZones,
		displayScale: balance.displayScale,
	};
}

/** World-spawnable items (no traces / UI textures). */
export const ITEM_CATALOG: readonly ItemDefinition[] = ITEM_BALANCE.map(
	(entry) => fromBalance(entry),
);

if (ITEM_CATALOG.length !== 11) {
	throw new Error(
		`ITEM_CATALOG must contain 11 entries, got ${ITEM_CATALOG.length}`,
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
