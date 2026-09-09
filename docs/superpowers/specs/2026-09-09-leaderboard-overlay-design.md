# Leaderboard overlay (Phaser)

## Goal

Home + Result Leaderboard buttons open an in-game overlay showing `bxh.webp` (“Bảng Xếp Hạng”), with `back-btn.webp` top-left to dismiss. No Flutter `OPEN_LEADERBOARD` on this path.

## Scope

- Shared `LeaderboardOverlay` controller
- Wire Home + Result only
- Register `back-btn` in asset-pack (`bxh` already keyed)
- Keep existing `leaderboard.webp` button art

## Out of scope

- Real score rows / Flutter account leaderboard
- Pause menu leaderboard

## Behavior

1. Click Leaderboard → SFX → show dim + centered `bxh` + back button
2. Click Back → SFX → hide overlay; parent screen unchanged
3. Overlay depth above Home (1500) and Result (2000)

## Approval

Approved verbally 2026-09-09 (option B + shared overlay design).
