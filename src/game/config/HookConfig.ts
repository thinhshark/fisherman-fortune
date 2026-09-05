/**
 * Hook assembly motion — swing arc vs jaw opening are independent.
 *
 * SWING: rotates the whole rope+hook Container about the boat anchor hole.
 * JAWS: local rotations of hook-left / hook-right pivots only.
 */
export const HOOK_SWING = {
	/** Half-range of idle swing about vertical (degrees). Full arc = ±this. */
	amplitudeDegrees: 70,
	/** One full left→right→left cycle (ms). */
	fullCycleMs: 3200,
} as const;

/**
 * Nested-pivot jaw deltas relative to rest (pivot angle 0).
 * Positive left / negative right opens claws outward (observed mapping).
 * Swinging uses the art rest pose (0); casting is wider; retracting closes.
 */
export const HOOK_JAWS = {
	swinging: { left: 0, right: 0 },
	casting: { left: 37, right: -37 },
	retracting: { left: -35, right: 35 },
} as const;

export const HOOK_JAW_TRANSITION_MS = 120;
