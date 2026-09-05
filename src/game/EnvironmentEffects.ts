import Phaser from "phaser";
import { EnvironmentEffectsConfig } from "./config/EnvironmentEffectsConfig";
import {
	ensureWaterDistortFilterRegistered,
	WaterDistortController,
} from "./filters/WaterDistortFilter";

/**
 * Gentle boat bob/rock + optional continuous underwater refraction filter.
 * Always derived from stored base poses — never accumulated.
 * Single owner of underwater distortion (no strip copies, no second effect).
 */
export class EnvironmentEffects {
	private readonly scene: Phaser.Scene;
	private readonly boat: Phaser.GameObjects.Image;
	private readonly water: Phaser.GameObjects.Image;

	private readonly boatBaseX: number;
	private readonly boatBaseY: number;
	private readonly boatBaseRotation: number;
	private readonly waterBaseScaleX: number;
	private readonly waterBaseScaleY: number;

	private waterDistort?: WaterDistortController;

	private boatElapsedMs = 0;
	private waterElapsedMs = 0;
	private paused = true;
	private destroyed = false;

	constructor(
		scene: Phaser.Scene,
		boat: Phaser.GameObjects.Image,
		water: Phaser.GameObjects.Image,
	) {
		this.scene = scene;
		this.boat = boat;
		this.water = water;

		this.boatBaseX = boat.x;
		this.boatBaseY = boat.y;
		this.boatBaseRotation = boat.rotation;
		this.waterBaseScaleX = water.scaleX;
		this.waterBaseScaleY = water.scaleY;

		// One continuous underwater image — never hide or replace with strips.
		this.water.setVisible(true);
		this.water.setCrop();

		this.applyBoatPose(0);
		this.attachWaterDistortIfSupported();

		scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
	}

	/**
	 * Freeze the sine / shader phase in place. Resume continues from the same elapsed time.
	 */
	setPaused(paused: boolean): void {
		if (this.destroyed || this.paused === paused) {
			return;
		}
		this.paused = paused;
		if (this.waterDistort) {
			this.waterDistort.active = !paused;
		}
	}

	beginGameplay(): void {
		if (this.destroyed) {
			return;
		}
		this.paused = false;
		if (this.waterDistort) {
			this.waterDistort.active = true;
		}
	}

	update(_time: number, delta: number): void {
		if (this.destroyed || this.paused) {
			return;
		}

		const safeDelta =
			typeof delta === "number" && Number.isFinite(delta) && delta > 0
				? delta
				: 0;
		this.boatElapsedMs += safeDelta;
		this.waterElapsedMs += safeDelta;
		this.applyBoatPose(this.boatElapsedMs);
		if (this.waterDistort) {
			this.waterDistort.time = this.waterElapsedMs * 0.001;
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.paused = true;
		this.applyBoatPose(0);
		this.detachWaterDistort();
		this.water.setScale(this.waterBaseScaleX, this.waterBaseScaleY);
		this.water.setVisible(true);
		this.scene.events.off(
			Phaser.Scenes.Events.SHUTDOWN,
			this.destroy,
			this,
		);
	}

	private attachWaterDistortIfSupported(): void {
		const renderer = this.scene.game.renderer;
		if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
			return;
		}
		if (!ensureWaterDistortFilterRegistered(renderer)) {
			return;
		}

		try {
			this.water.enableFilters();
			const filters = this.water.filters;
			if (!filters) {
				return;
			}

			const overscan = EnvironmentEffectsConfig.waterOverscan;
			this.water.setScale(
				this.waterBaseScaleX * overscan,
				this.waterBaseScaleY * overscan,
			);

			const controller = new WaterDistortController(
				this.water.filterCamera,
			);
			controller.time = 0;
			controller.active = !this.paused;
			filters.internal.add(controller);
			this.waterDistort = controller;
		} catch (error) {
			console.warn(
				"[EnvironmentEffects] Water distort filter unavailable; using static water.",
				error,
			);
			this.detachWaterDistort();
			this.water.setScale(this.waterBaseScaleX, this.waterBaseScaleY);
		}
	}

	private detachWaterDistort(): void {
		const controller = this.waterDistort;
		this.waterDistort = undefined;
		if (!controller) {
			return;
		}
		const filters = this.water.filters;
		if (filters?.internal) {
			filters.internal.remove(controller, true);
		} else if (!controller.ignoreDestroy) {
			controller.destroy();
		}
	}

	private applyBoatPose(elapsedMs: number): void {
		const cycle = Math.max(1, EnvironmentEffectsConfig.boatCycleMs);
		const phase = (elapsedMs / cycle) * Math.PI * 2;
		const bob = Math.sin(phase) * EnvironmentEffectsConfig.boatBobAmplitudePx;
		const rockRad = Phaser.Math.DegToRad(
			EnvironmentEffectsConfig.boatRockAmplitudeDeg,
		);
		const rock = Math.sin(phase + 0.7) * rockRad;

		this.boat.setPosition(this.boatBaseX, this.boatBaseY + bob);
		this.boat.setRotation(this.boatBaseRotation + rock);
	}
}
