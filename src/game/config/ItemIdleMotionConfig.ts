/**
 * Subtle floating for stationary underwater collectibles.
 * Not applied to creatures, boat, hook, HUD, or FX.
 */
export const ITEM_IDLE_MOTION = {
	bobMinPixels: 5,
	bobMaxPixels: 10,
	rotationMinDegrees: 3,
	rotationMaxDegrees: 6.5,
	durationMinMs: 1300,
	durationMaxMs: 2000,
	initialDelayMaxMs: 800,
} as const;

export type ItemIdleMotionConfig = typeof ITEM_IDLE_MOTION;
