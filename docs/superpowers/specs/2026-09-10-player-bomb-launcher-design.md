# Player bomb launcher — design

**Date:** 2026-09-10  
**Status:** Approved verbally (approach + design); awaiting spec file review.

## Goal

Give the player a consumable bomb inventory used from HUD. Tapping the bomb icon while the hook is swinging launches a projectile along the hook angle. Hitting a barrel detonates it with full AoE but **without** the −500 score penalty. Missing consumes the bomb.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Launch origin | `HookController.pivot` (boat rope anchor) |
| Launch direction | Current hook swing angle |
| When allowed | Hook state `SWINGING` only; session `playing`; inventory &gt; 0; not paused |
| Start inventory | 1 on Play / Play Again |
| Bag outcomes | Money / Time / Bomb, equal **1/3** each |
| Inventory cap | None |
| Projectile vs non-barrels | Passes through; only barrels collide |
| Miss | Leaves water / exceeds max range → despawn, no reward |
| Barrel hit | Same AoE as hook-caught barrel (destroy nearby catchables, no rewards); **no −500** |
| Gravity | None — straight line along angle |
| HUD art | `bomb-button` + `xN` text (mock placement near pause / under top chrome) |
| Projectile art | `bonus-bomb` |
| Architecture | Dedicated launcher + inventory on session (not inside HookController) |

## Non-goals

- Bomb as a world spawn item the hook can catch for inventory (Bag grants inventory only)
- Targeting mode / tap-barrel-to-destroy
- Destroying all barrels with one tap
- Flutter / bridge changes for bomb count

## Systems

### Inventory (`GameSession` or small `BombInventory` owned by Level)

- `count` starts at `1` when gameplay starts
- `add(n)` from Bag gift outcome `bomb`
- `tryConsume(): boolean` on successful fire attempt
- Emit `bomb-count-changed` for HUD

### Bag / Gift (`GIFT_CONFIG` + `pickGiftOutcome`)

- Extend outcomes: `money` | `time` | `bomb`
- Chances: `moneyChance = timeChance = bombChance = 1/3` (sum = 1)
- Feedback text for bomb gain (e.g. `+1` bomb icon or `BOMB +1`) via existing catch feedback path if practical

### HUD

- Show bomb button + count while gameplay HUD visible (hide on Home)
- Disabled / dimmed when count = 0 or hook not swinging (optional UX: still visible, no-op with SFX deny or silent)
- Click → request fire (SFX button)

### Launcher (`BombLauncher` / `PlayerBombController`)

1. Guard: playing, not paused, swinging, count &gt; 0, no active projectile (or allow only one in flight — **recommend one in flight**)
2. Consume 1 bomb
3. Spawn `bonus-bomb` at pivot; velocity along hook angle at configurable `BOMB_SPEED_PX_PER_SEC`
4. Each frame: move; if outside water bounds (or beyond `BOMB_MAX_RANGE_PX`) → destroy
5. Overlap test vs active barrels only (circle∩bounds or point-in-bounds, match catch style)
6. On hit: call `ItemSpawner.detonateBarrel(..., { applyScorePenalty: false })` (or equivalent), destroy projectile, play bomb SFX/FX already used for barrels

### Score path

- Today: barrel catch → `BARREL_EXPLODED_EVENT` → `GameSession` applies `scoreValue` (−500)
- Change: payload includes `source: "hook" | "player-bomb"` (or `applyScorePenalty: boolean`)
- Session applies −500 only for hook path

## Config knobs (single place, e.g. `BombBalance.ts` or `ItemBalance`)

- `START_BOMBS = 1`
- `BOMB_SPEED_PX_PER_SEC` (tune in playtest; start ~400–600)
- `BOMB_MAX_RANGE_PX` or rely on water AABB exit
- Gift chances 1/3 each
- Projectile scale

## Edge cases

- Pause mid-flight: freeze projectile with other gameplay
- Timer zero / game ending: stop accepting fire; despawn or freeze projectile; no late score
- Multiple barrels: first overlap wins; no chain detonation of other barrels (existing rule)
- Bag bomb while at high count: still add (no cap)
- Input: bomb button must not steal pause / cast accidentally (depth + hit area)

## Test plan (manual)

1. Play → HUD shows `x1`; Home hides bomb UI  
2. Swing only: fire works; casting/retracting: no fire  
3. Fire with 0: no-op  
4. Miss off water: count decreases, no score change  
5. Hit barrel: explosion FX, nearby victims cleared, score **not** −500  
6. Hook-catch barrel: still −500  
7. Bag delivers money / time / bomb ~evenly over many picks  
8. Pause / result: cannot fire  

## Approval

- Approach + design: approved 2026-09-10  
- Spec file: pending user review
