/**
 * Subtle floating for stationary underwater collectibles.
 * Not applied to creatures, boat, hook, HUD, or FX.
 */
export const ITEM_IDLE_MOTION = {
	bobMinPixels: 3,
	bobMaxPixels: 6,
	rotationMinDegrees: 1.5,
	rotationMaxDegrees: 3.5,
	durationMinMs: 1500,
	durationMaxMs: 2300,
	initialDelayMaxMs: 1000,
} as const;

export type ItemIdleMotionConfig = typeof ITEM_IDLE_MOTION;
