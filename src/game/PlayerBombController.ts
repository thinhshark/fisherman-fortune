import Phaser from "phaser";
import type { AudioController } from "./AudioController";
import type { CreatureSpawner } from "./CreatureSpawner";
import { BombBalance } from "./config/BombBalance";
import type { HookController } from "./HookController";
import type { ItemSpawner } from "./ItemSpawner";
import {
	BOMB_COUNT_CHANGED_EVENT,
	type BombCountChangedPayload,
	type GameSession,
} from "./GameSession";

const HUD_DEPTH = 1005;
const MIN_HIT = 72;
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const DISABLED_ALPHA = 0.45;
/** Match HudController time panel (gui-time 329×227 @ 0.48, no extra ui scale). */
const TIME_PANEL_SCALE = 0.48;
const TIME_PANEL_SRC_W = 329;
const TIME_PANEL_SRC_H = 227;
const HUD_MARGIN_PX = 20;
/** Same nudge as HudController TEXT_Y_OFFSET_PX — align with the time digits. */
const TIME_TEXT_Y_OFFSET_PX = 8;
/** Diagonal step between stacked bomb icons (design px). */
const ICON_STEP_X = 38;
const ICON_STEP_Y = 12;

/**
 * HUD bomb inventory + straight projectile launched from the hook pivot
 * while swinging. Hits barrels with AoE and no −500 penalty.
 *
 * Inventory UI: one `bomb-button` image per bomb (no "xN" text), stacked
 * diagonally left of the timer like the mock.
 */
export class PlayerBombController {
	private readonly scene: Phaser.Scene;
	private readonly session: GameSession;
	private readonly hook: HookController;
	private readonly items: ItemSpawner;
	private readonly creatures: CreatureSpawner;
	private readonly water: Phaser.GameObjects.Image;
	private readonly audio?: AudioController;

	private readonly boundCountChanged = this.handleCountChanged.bind(this);
	private readonly boundFire = this.tryFire.bind(this);
	private readonly boundResize = this.layout.bind(this);

	private readonly icons: Phaser.GameObjects.Image[] = [];
	private projectile?: Phaser.GameObjects.Image;
	private velX = 0;
	private velY = 0;
	private traveled = 0;

	private destroyed = false;
	private paused = false;
	private gameplayVisible = false;
	private displayedCount = 0;

	constructor(
		scene: Phaser.Scene,
		session: GameSession,
		hook: HookController,
		items: ItemSpawner,
		creatures: CreatureSpawner,
		water: Phaser.GameObjects.Image,
		audio?: AudioController,
	) {
		this.scene = scene;
		this.session = session;
		this.hook = hook;
		this.items = items;
		this.creatures = creatures;
		this.water = water;
		this.audio = audio;

		this.requireTextures();
		this.displayedCount = session.bombCount;
		this.syncIcons();
		this.setGameplayVisible(false);

		scene.events.on(BOMB_COUNT_CHANGED_EVENT, this.boundCountChanged);
		scene.scale.on("resize", this.boundResize);
		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	setGameplayVisible(visible: boolean): void {
		if (this.destroyed) {
			return;
		}
		this.gameplayVisible = visible;
		for (const icon of this.icons) {
			icon.setVisible(visible);
		}
		if (!visible) {
			this.destroyProjectile();
			this.clearIconInteractive();
		} else {
			this.layout();
			this.refreshButtonInteractive();
		}
	}

	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
		this.refreshButtonInteractive();
	}

	/** Drop in-flight bomb without refund (timer end / abort). */
	clearProjectile(): void {
		this.destroyProjectile();
	}

	update(_time: number, delta: number): void {
		if (this.destroyed || this.paused || !this.gameplayVisible) {
			return;
		}
		this.refreshButtonInteractive();
		this.updateProjectile(delta);
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.scene.events.off(BOMB_COUNT_CHANGED_EVENT, this.boundCountChanged);
		this.scene.scale.off("resize", this.boundResize);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
		this.destroyProjectile();
		this.clearIcons();
	}

	private requireTextures(): void {
		for (const key of ["bomb-button", "bonus-bomb"] as const) {
			if (!this.scene.textures.exists(key)) {
				throw new Error(`PlayerBombController requires texture "${key}"`);
			}
		}
	}

	private handleCountChanged(payload: BombCountChangedPayload): void {
		if (this.destroyed) {
			return;
		}
		this.displayedCount = Math.max(0, payload.count);
		this.syncIcons();
		this.layout();
		this.refreshButtonInteractive();
	}

	/** Ensure `icons.length === displayedCount` (one image per bomb). */
	private syncIcons(): void {
		while (this.icons.length > this.displayedCount) {
			const icon = this.icons.pop();
			if (!icon) {
				break;
			}
			icon.off("pointerup", this.boundFire);
			icon.destroy();
		}
		while (this.icons.length < this.displayedCount) {
			const icon = this.scene.add
				.image(0, 0, "bomb-button")
				.setOrigin(0.5, 0.5)
				.setScale(BombBalance.HUD_SCALE)
				.setScrollFactor(0)
				.setDepth(HUD_DEPTH + this.icons.length)
				.setName(`hudBombIcon-${this.icons.length}`)
				.setVisible(this.gameplayVisible);
			icon.on("pointerup", this.boundFire);
			this.icons.push(icon);
		}
	}

	private clearIcons(): void {
		for (const icon of this.icons) {
			icon.off("pointerup", this.boundFire);
			icon.destroy();
		}
		this.icons.length = 0;
	}

	private layout(): void {
		if (this.destroyed || this.icons.length === 0) {
			return;
		}
		const w = this.scene.scale.width;
		const ui = Math.min(w / DESIGN_WIDTH, this.scene.scale.height / DESIGN_HEIGHT);
		const scale = Math.max(BombBalance.HUD_SCALE * ui, MIN_HIT / 140);
		const stepX = ICON_STEP_X * ui;
		const stepY = ICON_STEP_Y * ui;
		const n = this.icons.length;

		// HudController keeps panel scale fixed (not ui-scaled).
		const panelW = TIME_PANEL_SRC_W * TIME_PANEL_SCALE;
		const panelH = TIME_PANEL_SRC_H * TIME_PANEL_SCALE;
		const panelLeft = w - HUD_MARGIN_PX - panelW;
		const panelTop = HUD_MARGIN_PX;
		const timeDigitY =
			panelTop + panelH * 0.5 + TIME_TEXT_Y_OFFSET_PX;

		const rightX = panelLeft - 28 * ui;
		const startX = rightX - (n - 1) * stepX;
		const startY = timeDigitY - ((n - 1) * stepY) * 0.5;

		for (let i = 0; i < n; i++) {
			const icon = this.icons[i];
			icon
				.setScale(scale)
				.setDepth(HUD_DEPTH + i)
				.setPosition(startX + i * stepX, startY + i * stepY);
		}
	}

	private refreshButtonInteractive(): void {
		if (!this.gameplayVisible || this.icons.length === 0) {
			this.clearIconInteractive();
			return;
		}
		const canFire =
			!this.paused &&
			this.session.state === "playing" &&
			this.hook.state === "SWINGING" &&
			this.displayedCount > 0 &&
			!this.projectile;
		const alpha = canFire ? 1 : DISABLED_ALPHA;
		for (const icon of this.icons) {
			icon.setAlpha(alpha);
			if (canFire) {
				icon.setInteractive({ useHandCursor: true });
				this.ensureMinHitArea(icon);
			} else {
				icon.disableInteractive();
			}
		}
	}

	private clearIconInteractive(): void {
		for (const icon of this.icons) {
			icon.disableInteractive();
			icon.setAlpha(DISABLED_ALPHA);
		}
	}

	private tryFire(): void {
		if (this.destroyed || this.paused || !this.gameplayVisible) {
			return;
		}
		if (this.session.state !== "playing") {
			return;
		}
		if (this.hook.state !== "SWINGING") {
			return;
		}
		if (this.projectile) {
			return;
		}
		if (!this.session.tryConsumeBomb()) {
			return;
		}
		this.audio?.playButtonSfx();
		this.spawnProjectile();
		// Count event will sync icons; refresh in case consume already updated.
		this.refreshButtonInteractive();
	}

	private spawnProjectile(): void {
		const pivot = this.hook.pivot;
		const angle = this.hook.worldAimAngleRad;
		const speed = BombBalance.SPEED_PX_PER_SEC;
		// Match cast local +Y: wx uses -sin, wy uses +cos.
		this.velX = -Math.sin(angle) * speed;
		this.velY = Math.cos(angle) * speed;
		this.traveled = 0;

		this.projectile = this.scene.add
			.image(pivot.x, pivot.y, "bonus-bomb")
			.setOrigin(0.5, 0.5)
			.setScale(BombBalance.PROJECTILE_SCALE)
			.setRotation(angle)
			.setDepth(40)
			.setName("playerBombProjectile");
	}

	private updateProjectile(delta: number): void {
		const proj = this.projectile;
		if (!proj) {
			return;
		}
		const dt = delta / 1000;
		const dx = this.velX * dt;
		const dy = this.velY * dt;
		proj.x += dx;
		proj.y += dy;
		this.traveled += Math.hypot(dx, dy);

		if (this.traveled >= BombBalance.MAX_RANGE_PX || this.isOutOfBounds(proj)) {
			this.destroyProjectile();
			this.refreshButtonInteractive();
			return;
		}

		const circle = new Phaser.Geom.Circle(
			proj.x,
			proj.y,
			BombBalance.PROJECTILE_HIT_RADIUS_PX,
		);
		for (const item of this.items.getCatchableItems()) {
			if (item.definition.id !== "barrel") {
				continue;
			}
			const bounds = item.object.getBounds();
			if (!Phaser.Geom.Intersects.CircleToRectangle(circle, bounds)) {
				continue;
			}
			this.items.detonateBarrel(item, this.creatures, {
				applyScorePenalty: false,
			});
			this.destroyProjectile();
			this.refreshButtonInteractive();
			return;
		}
	}

	private isOutOfBounds(proj: Phaser.GameObjects.Image): boolean {
		const margin = 40;
		const w = this.scene.scale.width;
		const h = this.scene.scale.height;
		if (
			proj.x < -margin ||
			proj.x > w + margin ||
			proj.y < -margin ||
			proj.y > h + margin
		) {
			return true;
		}
		const waterBounds = this.water.getBounds();
		if (this.traveled > 40 && proj.y < waterBounds.top - 8) {
			return true;
		}
		if (proj.y > waterBounds.bottom + margin) {
			return true;
		}
		if (
			proj.x < waterBounds.left - margin ||
			proj.x > waterBounds.right + margin
		) {
			return true;
		}
		return false;
	}

	private destroyProjectile(): void {
		this.projectile?.destroy();
		this.projectile = undefined;
		this.traveled = 0;
	}

	private ensureMinHitArea(image: Phaser.GameObjects.Image): void {
		const w = Math.max(image.displayWidth, MIN_HIT);
		const h = Math.max(image.displayHeight, MIN_HIT);
		image.setInteractive(
			new Phaser.Geom.Rectangle(-w * 0.5, -h * 0.5, w, h),
			Phaser.Geom.Rectangle.Contains,
		);
		if (image.input) {
			image.input.cursor = "pointer";
		}
	}
}
