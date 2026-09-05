/**
 * Session-scoped uniqueness + lifetime spawn counters.
 *
 * - activeTypeIds: which stable type IDs are currently in play
 * - spawnCounts: how many times each type has spawned this session
 *
 * Ownership uses a token so an old destroy callback cannot unlock a newer
 * object of the same type. Release is always idempotent.
 */
export class ActiveTypeRegistry {
	private readonly activeTypeIds = new Map<string, number>();
	private readonly spawnCounts = new Map<string, number>();
	private nextToken = 1;
	private destroyed = false;

	isActive(typeId: string): boolean {
		return this.activeTypeIds.has(typeId);
	}

	getSpawnCount(typeId: string): number {
		return this.spawnCounts.get(typeId) ?? 0;
	}

	/**
	 * `maxSpawnsPerSession` of 0 / undefined means unlimited lifetime spawns.
	 */
	canSpawn(typeId: string, maxSpawnsPerSession?: number): boolean {
		if (this.destroyed || this.activeTypeIds.has(typeId)) {
			return false;
		}
		if (
			typeof maxSpawnsPerSession === "number" &&
			maxSpawnsPerSession > 0 &&
			this.getSpawnCount(typeId) >= maxSpawnsPerSession
		) {
			return false;
		}
		return true;
	}

	/**
	 * Register a successful spawn. Increments the lifetime counter and locks
	 * the type until `release` is called with this token.
	 */
	acquire(typeId: string): number | undefined {
		if (this.destroyed || this.activeTypeIds.has(typeId)) {
			return undefined;
		}
		const token = this.nextToken;
		this.nextToken += 1;
		this.activeTypeIds.set(typeId, token);
		this.spawnCounts.set(typeId, this.getSpawnCount(typeId) + 1);
		return token;
	}

	/**
	 * Unlock a type only if `token` still owns it. Safe to call twice.
	 */
	release(typeId: string, token: number): void {
		if (this.destroyed) {
			return;
		}
		if (this.activeTypeIds.get(typeId) === token) {
			this.activeTypeIds.delete(typeId);
		}
	}

	/** New session / Play Again / Home → Play. Not used on Pause. */
	resetSession(): void {
		if (this.destroyed) {
			return;
		}
		this.activeTypeIds.clear();
		this.spawnCounts.clear();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.activeTypeIds.clear();
		this.spawnCounts.clear();
	}
}
