# Player Bomb Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HUD bomb inventory that launches a straight projectile from the hook pivot while swinging; barrel hits detonate with full AoE but no −500; Bag grants money/time/bomb at 1/3 each.

**Architecture:** Inventory + events live on `GameSession`. A dedicated `PlayerBombController` owns HUD button, projectile motion, and barrel hit tests. Reuse `ItemSpawner.detonateBarrel` with an `applyScorePenalty` flag on `BarrelExplodedPayload`. Bag gift outcome gains a third `bomb` kind.

**Tech Stack:** Phaser 4, TypeScript, existing Level scene controllers (no new scene).

## Global Constraints

- Launch only when hook `state === "SWINGING"`, session `playing`, not paused, count &gt; 0
- Start with **1** bomb on Play / Play Again
- Bag: money / time / bomb each **1/3**; no inventory cap
- Projectile: no gravity; passes through non-barrels; despawn on water exit / max range
- Barrel from player bomb: same AoE as hook catch; **no −500**
- HUD texture `bomb-button`; projectile texture `bonus-bomb`
- Do **not** commit unless the user explicitly asks
- Prefer matching existing controller patterns (`HudController`, `CatchFeedbackController`)

---

## File map

| File | Responsibility |
|------|----------------|
| Create `src/game/config/BombBalance.ts` | Speeds, start count, gift chances, projectile scale |
| Modify `src/game/config/ItemBalance.ts` | `GIFT_CONFIG` + `pickGiftOutcome` bomb branch; sync bag docs/asserts |
| Modify `src/game/ItemSpawner.ts` | `BarrelExplodedPayload.applyScorePenalty`; emit flag |
| Modify `src/game/GameSession.ts` | Bomb inventory API + events; gift bomb; honor penalty flag |
| Modify `src/game/CatchFeedbackController.ts` | Optional `+1` bomb feedback on Bag |
| Create `src/game/PlayerBombController.ts` | HUD + fire + projectile + hit barrels |
| Modify `src/game/HookController.ts` | Expose `swingAngleRad` (world-facing) for launch direction |
| Modify `src/scenes/Level.ts` | Construct / update / pause / destroy bomb controller |
| Modify `src/game/AudioController.ts` | Play existing bomb SFX on player-bomb detonation if needed |

---

### Task 1: Gift config — money / time / bomb (1/3)

**Files:**
- Create: `src/game/config/BombBalance.ts`
- Modify: `src/game/config/ItemBalance.ts`

**Interfaces:**
- Produces: `BombBalance.START_COUNT`, `GIFT_CONFIG` with three chances summing to 1; `GiftOutcome` includes `{ kind: "bomb" }`
- Consumes: none

- [ ] **Step 1: Add `BombBalance.ts`**

```typescript
/** Tunables for player bomb inventory + projectile. */
export const BombBalance = {
	START_COUNT: 1,
	SPEED_PX_PER_SEC: 520,
	MAX_RANGE_PX: 900,
	PROJECTILE_SCALE: 0.55,
	PROJECTILE_HIT_RADIUS_PX: 28,
	HUD_SCALE: 0.55,
	/** Design-space position: under pause, slightly left of time panel. */
	HUD_OFFSET_X_FROM_CENTER: 0,
	HUD_Y: 110,
} as const;

export const PLAYER_BOMB_GIFT = {
	moneyChance: 1 / 3,
	timeChance: 1 / 3,
	bombChance: 1 / 3,
} as const;
```

- [ ] **Step 2: Update `GIFT_CONFIG` and `pickGiftOutcome`**

Replace money/time-only config so chances come from `PLAYER_BOMB_GIFT` (or inline 1/3). Extend:

```typescript
export type GiftOutcome =
	| { kind: "money"; amount: number }
	| { kind: "time"; seconds: number }
	| { kind: "bomb" };
```

```typescript
const roll = random01();
if (roll < GIFT_CONFIG.moneyChance) {
	return { kind: "money", amount: randomInt(GIFT_CONFIG.moneyMin, GIFT_CONFIG.moneyMax) };
}
if (roll < GIFT_CONFIG.moneyChance + GIFT_CONFIG.timeChance) {
	return {
		kind: "time",
		seconds: randomInt(GIFT_CONFIG.timeMinSeconds, GIFT_CONFIG.timeMaxSeconds),
	};
}
return { kind: "bomb" };
```

Update the startup assert: `moneyChance + timeChance + bombChance === 1` (remove old “time max ≤ 45 only” if still present — keep time max assert separately).

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`  
Expected: errors only where `GiftOutcome` exhaustiveness breaks (`GameSession.applyGiftReward`) — fixed in Task 2. If Task 1 alone, temporarily leave a `never` throw until Task 2.

---

### Task 2: Session inventory + Bag bomb + barrel penalty flag

**Files:**
- Modify: `src/game/ItemSpawner.ts` (`BarrelExplodedPayload`, emit in `detonateBarrel`)
- Modify: `src/game/GameSession.ts`
- Modify: `src/game/CatchFeedbackController.ts` (bomb feedback)
- Modify: `src/game/CatchController.ts` only if it must pass options into `detonateBarrel` (default penalty true)

**Interfaces:**
- Consumes: `GiftOutcome` with `bomb`; `BombBalance.START_COUNT`
- Produces:
  - `BOMB_COUNT_CHANGED_EVENT` / `BOMB_GAINED_EVENT`
  - `GameSession.get bombCount()`, `resetBombsForGameplay()`, `addBombs(n)`, `tryConsumeBomb(): boolean`
  - `BarrelExplodedPayload.applyScorePenalty: boolean`

- [ ] **Step 1: Extend barrel payload**

```typescript
export interface BarrelExplodedPayload {
	x: number;
	y: number;
	sourceId: string;
	/** When false, GameSession must not apply −500. Default true for hook catches. */
	applyScorePenalty: boolean;
}
```

In `detonateBarrel`, add optional last arg or options object:

```typescript
detonateBarrel(
	item: CatchableItem | ItemGameObject,
	creatureSpawner?: CreatureSpawner,
	options?: { applyScorePenalty?: boolean },
): boolean
```

Emit:

```typescript
this.scene.events.emit(BARREL_EXPLODED_EVENT, {
	x: originX,
	y: originY,
	sourceId: entry.definition.id,
	applyScorePenalty: options?.applyScorePenalty !== false,
} satisfies BarrelExplodedPayload);
```

Hook catch path (`CatchController`) keeps default → penalty **true**.

- [ ] **Step 2: Inventory on `GameSession`**

```typescript
export const BOMB_COUNT_CHANGED_EVENT = "bomb-count-changed";
export const BOMB_GAINED_EVENT = "bomb-gained";

export interface BombCountChangedPayload {
	count: number;
}
export interface BombGainedPayload {
	delta: number;
	count: number;
	deliveryX: number;
	deliveryY: number;
}
```

```typescript
private _bombCount = 0;

get bombCount(): number {
	return this._bombCount;
}

/** Call from Level when ready → playing. */
resetBombsForGameplay(): void {
	this._bombCount = BombBalance.START_COUNT;
	this.emitBombCount();
}

addBombs(delta: number, deliveryX: number, deliveryY: number): void {
	if (this.destroyed || this._state !== "playing" || delta <= 0) return;
	this._bombCount += delta;
	this.emitBombCount();
	this.scene.events.emit(BOMB_GAINED_EVENT, {
		delta,
		count: this._bombCount,
		deliveryX,
		deliveryY,
	} satisfies BombGainedPayload);
}

tryConsumeBomb(): boolean {
	if (this.destroyed || this._state !== "playing" || this._bombCount <= 0) {
		return false;
	}
	this._bombCount -= 1;
	this.emitBombCount();
	return true;
}

private emitBombCount(): void {
	this.scene.events.emit(BOMB_COUNT_CHANGED_EVENT, {
		count: this._bombCount,
	} satisfies BombCountChangedPayload);
}
```

In `startGame()` (or Level right after `startGame`), call `resetBombsForGameplay()`.

- [ ] **Step 3: `applyGiftReward` bomb branch**

```typescript
if (outcome.kind === "bomb") {
	this.addBombs(1, payload.deliveryX, payload.deliveryY);
	return;
}
```

- [ ] **Step 4: Honor `applyScorePenalty`**

```typescript
private handleBarrelExploded(payload: BarrelExplodedPayload): void {
	if (this.destroyed || this._state !== "playing") return;
	if (payload.applyScorePenalty === false) return;
	// existing −500 logic...
}
```

- [ ] **Step 5: Feedback for bomb gain**

In `CatchFeedbackController`, listen to `BOMB_GAINED_EVENT` and spawn `+1` (reuse time color or a warm orange).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS (or only missing `PlayerBombController` refs if Level not wired yet).

---

### Task 3: Hook angle accessor

**Files:**
- Modify: `src/game/HookController.ts`

**Interfaces:**
- Produces: `get swingAngleRad(): number` — same radians used for cast direction (`swingRotation`, boat-relative; Level projectile should use **world** direction = `player.rotation + swingRotation` when boat rocks)

- [ ] **Step 1: Add getters**

```typescript
/** Boat-relative swing angle (radians). */
get swingAngleRad(): number {
	return this.swingRotation;
}

/** World rotation of the rope/hook for projectiles (radians). */
get worldAimAngleRad(): number {
	return this.player
		? this.player.rotation + this.swingRotation
		: this.swingRotation;
}
```

Direction of travel must match cast: inspect cast movement — typically

```typescript
const angle = this.hook.worldAimAngleRad;
const vx = Math.sin(angle) * speed;
const vy = Math.cos(angle) * speed;
```

(Confirm against cast extension math in `HookController` update CASTING; copy the same sin/cos signs.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 4: `PlayerBombController` (HUD + projectile)

**Files:**
- Create: `src/game/PlayerBombController.ts`
- Modify: `src/scenes/Level.ts`
- Modify: `src/game/AudioController.ts` (optional: listen to barrel explode with no penalty still plays SFX via existing path)

**Interfaces:**
- Consumes: `GameSession.tryConsumeBomb`, `bombCount`, events; `HookController.state`, `pivot`, `worldAimAngleRad`; `ItemSpawner.getCatchableItems` / barrels; `CreatureSpawner` for detonate
- Produces: working fire + HUD

- [ ] **Step 1: Implement controller skeleton**

Responsibilities:
- Build HUD image `bomb-button` + text `xN` at depth ≥ HUD (e.g. 1005), below pause Y
- `setVisible` with gameplay HUD
- `setPaused` freezes projectile
- `update(delta)` moves projectile; hit-test barrels; water/range despawn
- `tryFire()` guards + consume + spawn

```typescript
export class PlayerBombController {
	constructor(
		scene: Phaser.Scene,
		private readonly session: GameSession,
		private readonly hook: HookController,
		private readonly items: ItemSpawner,
		private readonly creatures: CreatureSpawner,
		private readonly audio?: AudioController,
	) { /* require textures bomb-button, bonus-bomb; build HUD; listen BOMB_COUNT_CHANGED */ }

	setGameplayVisible(visible: boolean): void { /* ... */ }
	setPaused(paused: boolean): void { /* ... */ }
	update(_time: number, delta: number): void { /* move projectile */ }
	destroy(): void { /* ... */ }

	private tryFire(): void {
		if (this.paused || !this.gameplayVisible) return;
		if (this.session.state !== "playing") return;
		if (this.hook.state !== "SWINGING") return;
		if (this.projectile) return; // one in flight
		if (!this.session.tryConsumeBomb()) return;
		this.audio?.playButtonSfx();
		this.spawnProjectile();
	}
}
```

Projectile spawn at `hook.pivot`; velocity from `worldAimAngleRad` + `BombBalance.SPEED_PX_PER_SEC`.

Hit test each frame:

```typescript
for (const item of this.items.getCatchableItems()) {
	if (item.definition.id !== "barrel") continue;
	const bounds = item.object.getBounds();
	const circle = new Phaser.Geom.Circle(proj.x, proj.y, BombBalance.PROJECTILE_HIT_RADIUS_PX);
	if (Phaser.Geom.Intersects.CircleToRectangle(circle, bounds)) {
		this.items.detonateBarrel(item, this.creatures, { applyScorePenalty: false });
		this.destroyProjectile();
		return;
	}
}
```

Despawn if distance from origin &gt; `MAX_RANGE_PX` or outside water rect (use `water` object bounds / ItemSpawner water band if exposed — prefer checking `y` below water top and inside scene width; if leave underwater AABB → destroy).

- [ ] **Step 2: Wire Level**

In `create`, after spawners + session:

```typescript
this.playerBombController = new PlayerBombController(
	this,
	this.gameSession,
	this.hookController,
	this.itemSpawner,
	this.creatureSpawner,
	this.audioController,
);
this.playerBombController.setGameplayVisible(false);
```

`beginGameplaySession`: `this.gameSession.resetBombsForGameplay()` (if not inside `startGame`); `playerBombController.setGameplayVisible(true)`.

`update`: after hook update, `this.playerBombController.update(time, gameplayDelta)`.

`applyGameplayPaused`: `playerBombController.setPaused(paused)`.

`handleGameEnding`: pause/hide bomb UI; destroy in-flight projectile.

Shutdown: `playerBombController.destroy()`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

---

### Task 5: Manual verification checklist

**Files:** none (playtest)

- [ ] **Step 1: Run dev server**

Run: `npm start`  
Open local URL on desktop.

- [ ] **Step 2: Checklist from spec**

1. Play → HUD `x1`; Home hides bomb UI  
2. Swing only: fire works; casting/retracting: no fire  
3. Fire with `x0`: no-op  
4. Miss: count decreases, score unchanged  
5. Hit barrel: FX + AoE clear; score **not** −500  
6. Hook-catch barrel: still −500  
7. Bag can grant bomb (`+1` feedback)  
8. Pause / result: cannot fire  

- [ ] **Step 3: Commit only if user asks**

Do not commit unless explicitly requested.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Start 1 bomb | Task 2 |
| Bag 1/3 each | Task 1–2 |
| No inventory cap | Task 2 `addBombs` |
| Fire only SWINGING | Task 4 `tryFire` |
| Pivot + angle | Task 3–4 |
| Pass through non-barrels | Task 4 |
| Miss despawn | Task 4 |
| AoE no −500 | Task 2 + 4 |
| HUD bomb-button / projectile bonus-bomb | Task 4 |
| Pause / ending guards | Task 4 + Level |

**Placeholder scan:** none intentional.  
**Type consistency:** `applyScorePenalty`, `tryConsumeBomb`, `BOMB_GAINED_EVENT`, `worldAimAngleRad` used consistently across tasks.
