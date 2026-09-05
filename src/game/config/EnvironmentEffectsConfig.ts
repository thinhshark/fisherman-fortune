/**
 * Subtle boat bob + continuous underwater refraction (single image, no strips).
 * Edit these numbers, not the controllers.
 *
 * Boat motion is always `base + sin(time) * amplitude`, never accumulated.
 * Water uses one WebGL filter on the underwater background only; amplitude
 * grows with UV depth inside the fragment shader.
 *
 * Pause freezes elapsed time (the sine / shader phase stops). Resume continues
 * from the same phase. Home / Play Again / scene shutdown destroy the owner
 * so listeners and filters are not stacked.
 */
export const EnvironmentEffectsConfig = {
	/** Vertical boat bob from the original Y, in logical pixels. */
	boatBobAmplitudePx: 2.5,
	/** Extra boat rotation from the original angle, in degrees. */
	boatRockAmplitudeDeg: 0.55,
	/** One boat bob+rock cycle, in milliseconds. */
	boatCycleMs: 3500,

	/**
	 * Slight visual overscan so refraction sampling does not show empty edges.
	 * Spawners keep the pre-overscan water bounds (they construct first).
	 */
	waterOverscan: 1.02,
} as const;

export type EnvironmentEffectsConfigType = typeof EnvironmentEffectsConfig;
