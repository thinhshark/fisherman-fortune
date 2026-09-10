/** Tunables for player bomb inventory + projectile. */
export const BombBalance = {
	START_COUNT: 1,
	SPEED_PX_PER_SEC: 520,
	MAX_RANGE_PX: 900,
	PROJECTILE_SCALE: 0.55,
	PROJECTILE_HIT_RADIUS_PX: 28,
	HUD_SCALE: 0.55,
} as const;

/** Bag gift chances — must sum to 1. */
export const PLAYER_BOMB_GIFT = {
	moneyChance: 1 / 3,
	timeChance: 1 / 3,
	bombChance: 1 / 3,
} as const;
