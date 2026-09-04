import Phaser from "phaser";
import {
	assertCreatureWeight,
	type CreatureCategory,
	type CreatureWeight,
} from "./CreatureCatalog";

export type HookState = "SWINGING" | "CASTING" | "RETRACTING";
export type RetractReason = "empty" | "caught";

export const HOOK_STATE_CHANGED_EVENT = "hook-state-changed";

export interface HookStateChangedPayload {
	state: HookState;
	previousState: HookState;
	retractReason?: RetractReason;
	creatureId?: string;
	itemId?: string;
	category?: CreatureCategory;
}

/** Dev-only: log once when a retraction begins. */
const LOG_RETRACTION = false;

/** Dev-only: log once per state change with jaw target deltas. */
const LOG_JAW_TARGETS = false;

export const EMPTY_RETRACT_SPEED_PX_PER_SEC = 850;

export const CAUGHT_RETRACT_SPEED_PX_PER_SEC: Record<CreatureWeight, number> = {
	Light: 500,
	Medium: 280,
	Heavy: 120,
};

/**
 * Exhaustive caught-retract speed lookup.
 * Never returns the empty-hook speed (850).
 */
export function getRetractSpeed(weight: CreatureWeight): number {
	assertCreatureWeight(weight);
	switch (weight) {
		case "Light":
			return CAUGHT_RETRACT_SPEED_PX_PER_SEC.Light;
		case "Medium":
			return CAUGHT_RETRACT_SPEED_PX_PER_SEC.Medium;
		case "Heavy":
			return CAUGHT_RETRACT_SPEED_PX_PER_SEC.Heavy;
		default: {
			const invalid: never = weight;
			throw new Error(`Invalid creature weight: ${String(invalid)}`);
		}
	}
}

/** @deprecated Use `getRetractSpeed`. */
export const retractSpeedForWeight = getRetractSpeed;

{
	const extension = 600;
	const empty = extension / EMPTY_RETRACT_SPEED_PX_PER_SEC;
	const light = extension / getRetractSpeed("Light");
	const medium = extension / getRetractSpeed("Medium");
	const heavy = extension / getRetractSpeed("Heavy");

	if (!(heavy > medium && medium > light && light > empty)) {
		throw new Error(
			`Retract duration order invalid for ${extension}px: ` +
				`empty=${empty}, light=${light}, medium=${medium}, heavy=${heavy}`,
		);
	}
	if (getRetractSpeed("Heavy") !== 120) {
		throw new Error("Heavy retract speed must be exactly 120 px/s");
	}
	if (getRetractSpeed("Light") !== 500) {
		throw new Error("Light retract speed must be exactly 500 px/s");
	}
	if (getRetractSpeed("Medium") !== 280) {
		throw new Error("Medium retract speed must be exactly 280 px/s");
	}
	// Category → weight → speed contracts.
	if (getRetractSpeed("Heavy") !== 120) {
		throw new Error("Big Fish (Heavy) must select 120 px/s");
	}
	if (Math.abs(empty - 600 / 850) > 1e-9) {
		throw new Error("Empty 600px duration must be 600/850");
	}
	if (Math.abs(light - 1.2) > 1e-9) {
		throw new Error("Light 600px duration must be exactly 1.2s");
	}
	if (Math.abs(heavy - 5) > 1e-9) {
		throw new Error("Heavy 600px duration must be exactly 5s");
	}
}

interface CapturedImageTransform {
	worldX: number;
	worldY: number;
	angle: number;
	scaleX: number;
	scaleY: number;
	originX: number;
	originY: number;
	visible: boolean;
}

export interface RetractionStartInfo {
	creatureId?: string;
	itemId?: string;
	category?: CreatureCategory;
	/** Creature or item weight label (for debug logs only). */
	weight?: string;
}

/**
 * Hook assembly controller: idle swing, cast, and retract.
 * Rope stem + both jaw pivots live in one Container pivoted at the boat anchor hole.
 * Only the Container rotates while swinging; casting extends along frozen local +Y.
 * Jaw open/close is applied to nested hinge pivots, not the PNG bounding-box centers.
 */
export class HookController {
	private static readonly MAX_ANGLE_DEG = 55;
	private static readonly CYCLE_MS = 3200;
	private static readonly CAST_SPEED_PX_PER_SEC = 650;
	private static readonly HOOK_COLLISION_RADIUS = 32;
	private static readonly ATTACH_OFFSET_PX = 24;
	private static readonly BOUNDARY_MARGIN_PX = 35;
	private static readonly CAST_ROPE_OUTER_COLOR = 0x4b2a18;
	private static readonly CAST_ROPE_INNER_COLOR = 0xc98a32;
	private static readonly CAST_ROPE_OUTER_WIDTH = 8;
	private static readonly CAST_ROPE_INNER_WIDTH = 4;

	/**
	 * Nested-pivot deltas relative to rest (pivot angle 0).
	 * Runtime observation: the previous "OPEN" (-35/+35) assignment visually
	 * closed the claws, and the previous "CLOSED" (+22/-22) visually opened them.
	 * Names below match the observed visual effect after correcting state mapping.
	 */
	private static readonly JAW_OPEN_LEFT_DEG = 22;
	private static readonly JAW_OPEN_RIGHT_DEG = -22;
	private static readonly JAW_CLOSED_LEFT_DEG = -35;
	private static readonly JAW_CLOSED_RIGHT_DEG = 35;
	private static readonly JAW_TRANSITION_MS = 120;

	private readonly scene: Phaser.Scene;
	private readonly hookContainer: Phaser.GameObjects.Container;
	private readonly castRope: Phaser.GameObjects.Graphics;
	private readonly hookStem: Phaser.GameObjects.Image;
	private readonly hookLeft: Phaser.GameObjects.Image;
	private readonly hookRight: Phaser.GameObjects.Image;
	private readonly hookLeftPivot: Phaser.GameObjects.Container;
	private readonly hookRightPivot: Phaser.GameObjects.Container;

	private readonly anchorX: number;
	private readonly anchorY: number;

	private readonly ropeLocalX: number;
	private readonly ropeLocalY: number;
	private readonly hookCenterRestLocalX: number;
	private readonly hookCenterRestLocalY: number;
	private readonly restingHookDistance: number;
	private readonly worldMatrix = new Phaser.GameObjects.Components.TransformMatrix();
	private readonly hookWorld = new Phaser.Math.Vector2();

	private _state: HookState = "SWINGING";
	private elapsedMs = 0;
	private extension = 0;
	private maxExtension = 0;
	/** Active retract speed; only rewritten when a retract begins or delivery finishes. */
	private currentRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
	private retractReason: RetractReason = "empty";
	private readonly retractCompleteListeners = new Set<() => void>();
	private readonly spaceKey: Phaser.Input.Keyboard.Key | undefined;
	private inputEnabled = true;
	private paused = false;
	/** Metadata attached to the next RETRACTING state-changed emit. */
	private pendingRetractInfo?: {
		retractReason: RetractReason;
		creatureId?: string;
		itemId?: string;
		category?: CreatureCategory;
	};

	private jawLeftFromDeg = 0;
	private jawLeftToDeg = 0;
	private jawRightFromDeg = 0;
	private jawRightToDeg = 0;
	private jawTweenElapsedMs = 0;
	private jawTweening = false;

	constructor(
		scene: Phaser.Scene,
		rope: Phaser.GameObjects.Image,
		hookLeft: Phaser.GameObjects.Image,
		hookRight: Phaser.GameObjects.Image,
	) {
		this.scene = scene;
		this.hookStem = rope;
		this.hookLeft = hookLeft;
		this.hookRight = hookRight;

		// Rope top-center is already at the boat's circular anchor hole.
		this.anchorX = rope.x;
		this.anchorY = rope.y;

		const ropeTransform = this.captureTransform(rope);
		const hookLeftTransform = this.captureTransform(hookLeft);
		const hookRightTransform = this.captureTransform(hookRight);

		this.hookContainer = scene.add.container(this.anchorX, this.anchorY);

		this.addChildPreservingWorldPose(rope, ropeTransform);
		this.addChildPreservingWorldPose(hookLeft, hookLeftTransform);
		this.addChildPreservingWorldPose(hookRight, hookRightTransform);

		this.ropeLocalX = rope.x;
		this.ropeLocalY = rope.y;

		this.hookCenterRestLocalX =
			(this.hookLeft.x + this.hookRight.x) * 0.5;
		this.hookCenterRestLocalY =
			(this.hookLeft.y + this.hookRight.y) * 0.5;
		this.restingHookDistance = Math.hypot(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);

		this.hookLeftPivot = scene.add.container(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);
		this.hookRightPivot = scene.add.container(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);
		this.hookLeftPivot.setName("hookLeftPivot");
		this.hookRightPivot.setName("hookRightPivot");
		this.hookContainer.add(this.hookLeftPivot);
		this.hookContainer.add(this.hookRightPivot);
		this.reparentJawToPivot(this.hookLeft, this.hookLeftPivot);
		this.reparentJawToPivot(this.hookRight, this.hookRightPivot);

		// Continuous cast line in Container-local space (no separate rotation).
		this.castRope = scene.add.graphics();
		this.castRope.setName("castRope");
		this.castRope.setVisible(false);
		// Behind decorative stem and hook halves.
		this.hookContainer.addAt(this.castRope, 0);
		this.castRope.setPosition(0, 0);

		this.hookContainer.rotation = 0;

		this.spaceKey = scene.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.SPACE,
		);
		this.registerInput();
	}

	get pivot(): Readonly<{ x: number; y: number }> {
		return { x: this.anchorX, y: this.anchorY };
	}

	get state(): HookState {
		return this._state;
	}

	/** @deprecated Use `state`. Kept for existing call sites. */
	get currentState(): HookState {
		return this._state;
	}

	get isCasting(): boolean {
		return this._state === "CASTING";
	}

	get isRetracting(): boolean {
		return this._state === "RETRACTING";
	}

	get isAtRest(): boolean {
		return this._state === "SWINGING" && this.extension <= 0;
	}

	/**
	 * Enable/disable cast input. Does not interrupt an active cast or retract.
	 */
	setInputEnabled(enabled: boolean): void {
		this.inputEnabled = enabled;
	}

	/**
	 * Freeze swing/cast/retract and jaw motion exactly in place.
	 * Does not reset extension, angle, or state.
	 */
	setPaused(paused: boolean): void {
		if (this.paused === paused) {
			return;
		}
		this.paused = paused;
	}

	/**
	 * If currently CASTING with no catch claimed yet, begin empty retraction.
	 * No-op while already RETRACTING / SWINGING (caught retract stays intact).
	 */
	forceEmptyRetractIfCasting(): boolean {
		if (this._state !== "CASTING") {
			return false;
		}
		this.beginEmptyRetracting();
		return true;
	}

	/**
	 * World-space center of the joined hook hinge (not the boat-anchor pivot).
	 * Derived from the Container world matrix and the hinge local point + extension.
	 */
	get hookWorldPosition(): Readonly<{ x: number; y: number }> {
		this.updateHookWorldPosition();
		return { x: this.hookWorld.x, y: this.hookWorld.y };
	}

	/**
	 * Slightly down the hook from the hinge so closing jaws hold the catch
	 * without covering the central joint.
	 */
	get hookAttachWorldPosition(): Readonly<{ x: number; y: number }> {
		this.updateHookWorldPosition();
		const rot = this.hookContainer.rotation;
		const offset = HookController.ATTACH_OFFSET_PX;
		return {
			x: this.hookWorld.x - Math.sin(rot) * offset,
			y: this.hookWorld.y + Math.cos(rot) * offset,
		};
	}

	get hookCollisionRadius(): number {
		return HookController.HOOK_COLLISION_RADIUS;
	}

	get currentExtension(): number {
		return this.extension;
	}

	/**
	 * Subscribe to retraction finishing at the resting pose (empty or loaded).
	 * Fired once when RETRACTING reaches extension 0 and the hook returns to SWINGING.
	 */
	onRetractComplete(listener: () => void): void {
		this.retractCompleteListeners.add(listener);
	}

	offRetractComplete(listener: () => void): void {
		this.retractCompleteListeners.delete(listener);
	}

	/**
	 * Interrupt CASTING and start RETRACTING immediately, keeping the current
	 * extension and frozen swing angle. Only succeeds while CASTING.
	 *
	 * Uses the caller's explicit per-creature retractSpeed for the entire
	 * caught retraction (no weight fallback, no movementSpeed derivation).
	 * Sets speed before changing state so the empty-retract path cannot overwrite it.
	 */
	beginRetractingWithCatch(
		retractSpeed: number,
		info?: RetractionStartInfo,
	): boolean {
		if (this._state !== "CASTING") {
			return false;
		}

		if (
			typeof retractSpeed !== "number" ||
			!Number.isFinite(retractSpeed) ||
			retractSpeed <= 0
		) {
			throw new Error(
				`beginRetractingWithCatch requires a positive retractSpeed, got ${String(retractSpeed)}`,
			);
		}

		this.currentRetractSpeed = retractSpeed;
		this.retractReason = "caught";
		this.pendingRetractInfo = {
			retractReason: "caught",
			creatureId: info?.creatureId,
			itemId: info?.itemId,
			category: info?.category,
		};
		this.setState("RETRACTING");
		this.logRetractionStart({
			creatureId: info?.creatureId,
			itemId: info?.itemId,
			category: info?.category,
			weight: info?.weight,
		});
		return true;
	}

	/** Max safe cast length for a given container angle (degrees). */
	getMaxSafeExtensionForAngleDeg(angleDeg: number): number {
		return this.computeMaxSafeExtension(Phaser.Math.DegToRad(angleDeg));
	}

	update(_time: number, delta: number): void {
		if (this.paused) {
			return;
		}
		switch (this._state) {
			case "SWINGING":
				this.updateSwinging(delta);
				break;
			case "CASTING":
				this.updateCasting(delta);
				break;
			case "RETRACTING":
				this.updateRetracting(delta);
				break;
		}
		this.updateJawAngles(delta);
	}

	private registerInput(): void {
		this.scene.input.on("pointerdown", this.handleCastInput, this);
		this.spaceKey?.on("down", this.handleCastInput, this);
		this.scene.input.keyboard?.addCapture(
			Phaser.Input.Keyboard.KeyCodes.SPACE,
		);

		this.scene.events.once(
			Phaser.Scenes.Events.SHUTDOWN,
			this.unregisterInput,
			this,
		);
	}

	private unregisterInput(): void {
		this.scene.input.off("pointerdown", this.handleCastInput, this);
		this.spaceKey?.off("down", this.handleCastInput, this);
		this.scene.input.keyboard?.removeCapture(
			Phaser.Input.Keyboard.KeyCodes.SPACE,
		);
		this.retractCompleteListeners.clear();
	}

	private handleCastInput(
		_pointer?: Phaser.Input.Pointer,
		currentlyOver?: Phaser.GameObjects.GameObject[],
	): void {
		if (this.paused || !this.inputEnabled) {
			return;
		}
		// Do not cast through interactive HUD / pause UI.
		if (currentlyOver && currentlyOver.length > 0) {
			return;
		}
		if (this._state !== "SWINGING") {
			return;
		}
		this.beginCasting();
	}

	private beginCasting(): void {
		// Freeze current swing angle; elapsedMs stays put so resume has no jump.
		this.maxExtension = this.computeMaxSafeExtension(
			this.hookContainer.rotation,
		);
		this.extension = 0;
		this.currentRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
		this.retractReason = "empty";
		this.setState("CASTING");
		this.applyExtension();
	}

	private updateSwinging(delta: number): void {
		this.elapsedMs += delta;
		const phase =
			(this.elapsedMs / HookController.CYCLE_MS) * Math.PI * 2;
		const angleDeg =
			HookController.MAX_ANGLE_DEG * Math.sin(phase);
		this.hookContainer.rotation = Phaser.Math.DegToRad(angleDeg);
	}

	private updateCasting(delta: number): void {
		const deltaSec = delta / 1000;
		this.extension +=
			HookController.CAST_SPEED_PX_PER_SEC * deltaSec;

		if (this.extension >= this.maxExtension) {
			this.extension = this.maxExtension;
			this.applyExtension();
			this.beginEmptyRetracting();
			return;
		}

		this.applyExtension();
	}

	private beginEmptyRetracting(): void {
		// Empty-only path. Must never run after a successful catch.
		this.currentRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
		this.retractReason = "empty";
		this.pendingRetractInfo = { retractReason: "empty" };
		this.setState("RETRACTING");
		this.logRetractionStart({});
	}

	private updateRetracting(delta: number): void {
		const deltaSec = delta / 1000;
		// Use the speed stored when retraction began — never recompute per frame.
		this.extension -= this.currentRetractSpeed * deltaSec;

		if (this.extension <= 0) {
			this.extension = 0;
			this.applyExtension();
			this.restoreRestingLocalPositions();
			this.currentRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
			this.retractReason = "empty";
			this.setState("SWINGING");
			this.notifyRetractComplete();
			return;
		}

		this.applyExtension();
	}

	private setState(next: HookState): void {
		if (this._state === next) {
			return;
		}
		const previousState = this._state;
		this._state = next;

		const payload: HookStateChangedPayload = {
			state: next,
			previousState,
		};
		if (next === "RETRACTING" && this.pendingRetractInfo) {
			payload.retractReason = this.pendingRetractInfo.retractReason;
			payload.creatureId = this.pendingRetractInfo.creatureId;
			payload.itemId = this.pendingRetractInfo.itemId;
			payload.category = this.pendingRetractInfo.category;
			this.pendingRetractInfo = undefined;
		}
		this.scene.events.emit(HOOK_STATE_CHANGED_EVENT, payload);

		switch (next) {
			case "SWINGING":
				this.setJawTarget(0, 0);
				break;
			case "CASTING":
				// Visually wider than rest (claw tips farther apart).
				this.setJawTarget(
					HookController.JAW_OPEN_LEFT_DEG,
					HookController.JAW_OPEN_RIGHT_DEG,
				);
				break;
			case "RETRACTING":
				// Visually closed inward (claw tips closer together).
				this.setJawTarget(
					HookController.JAW_CLOSED_LEFT_DEG,
					HookController.JAW_CLOSED_RIGHT_DEG,
				);
				break;
			default: {
				const invalid: never = next;
				throw new Error(`Invalid hook state: ${String(invalid)}`);
			}
		}
	}

	private setJawTarget(leftDeg: number, rightDeg: number): void {
		this.jawLeftFromDeg = this.hookLeftPivot.angle;
		this.jawRightFromDeg = this.hookRightPivot.angle;
		this.jawLeftToDeg = leftDeg;
		this.jawRightToDeg = rightDeg;
		this.jawTweenElapsedMs = 0;
		this.jawTweening = true;

		if (LOG_JAW_TARGETS) {
			console.info("[jaw-target]", {
				state: this._state,
				leftTargetDelta: leftDeg,
				rightTargetDelta: rightDeg,
			});
		}
	}

	private updateJawAngles(delta: number): void {
		if (!this.jawTweening) {
			return;
		}

		this.jawTweenElapsedMs += delta;
		const t = Math.min(
			1,
			this.jawTweenElapsedMs / HookController.JAW_TRANSITION_MS,
		);
		const k = t * t * (3 - 2 * t);
		this.hookLeftPivot.setAngle(
			Phaser.Math.Linear(this.jawLeftFromDeg, this.jawLeftToDeg, k),
		);
		this.hookRightPivot.setAngle(
			Phaser.Math.Linear(this.jawRightFromDeg, this.jawRightToDeg, k),
		);

		if (t >= 1) {
			this.jawTweening = false;
			this.hookLeftPivot.setAngle(this.jawLeftToDeg);
			this.hookRightPivot.setAngle(this.jawRightToDeg);
		}
	}

	private applyExtension(): void {
		const height = Math.max(this.extension, 0);
		this.redrawCastRope(height);

		this.hookStem.setPosition(this.ropeLocalX, this.ropeLocalY + height);
		this.hookLeftPivot.setPosition(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY + height,
		);
		this.hookRightPivot.setPosition(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY + height,
		);
	}

	private redrawCastRope(extension: number): void {
		this.castRope.clear();
		this.castRope.setPosition(0, 0);

		if (extension <= 0) {
			this.castRope.setVisible(false);
			return;
		}

		this.castRope.setVisible(true);

		// Outer dark brown stroke.
		this.castRope.lineStyle(
			HookController.CAST_ROPE_OUTER_WIDTH,
			HookController.CAST_ROPE_OUTER_COLOR,
			1,
		);
		this.castRope.beginPath();
		this.castRope.moveTo(0, 0);
		this.castRope.lineTo(0, extension);
		this.castRope.strokePath();

		// Inner warm golden stroke.
		this.castRope.lineStyle(
			HookController.CAST_ROPE_INNER_WIDTH,
			HookController.CAST_ROPE_INNER_COLOR,
			1,
		);
		this.castRope.beginPath();
		this.castRope.moveTo(0, 0);
		this.castRope.lineTo(0, extension);
		this.castRope.strokePath();
	}

	private restoreRestingLocalPositions(): void {
		this.hookStem.setPosition(this.ropeLocalX, this.ropeLocalY);
		this.hookLeftPivot.setPosition(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);
		this.hookRightPivot.setPosition(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);
		this.redrawCastRope(0);
	}

	private updateHookWorldPosition(): void {
		this.hookContainer
			.getWorldTransformMatrix(this.worldMatrix)
			.transformPoint(
				this.hookCenterRestLocalX,
				this.hookCenterRestLocalY + this.extension,
				this.hookWorld,
			);
	}

	private notifyRetractComplete(): void {
		for (const listener of Array.from(this.retractCompleteListeners)) {
			listener();
		}
	}

	private logRetractionStart(info: RetractionStartInfo): void {
		if (!LOG_RETRACTION) {
			return;
		}
		const extensionAtStart = this.extension;
		const selectedRetractSpeed = this.currentRetractSpeed;
		console.info("[retraction]", {
			creatureId: info.creatureId,
			itemId: info.itemId,
			category: info.category,
			weight: info.weight,
			retractReason: this.retractReason,
			selectedRetractSpeed,
			extensionAtStart,
			expectedDurationSeconds:
				selectedRetractSpeed > 0
					? extensionAtStart / selectedRetractSpeed
					: Number.POSITIVE_INFINITY,
		});
	}

	/**
	 * Largest additional cast distance such that the complete-hook center
	 * stays inside the scene with a boundary margin, for the frozen angle.
	 */
	private computeMaxSafeExtension(angleRad: number): number {
		const margin = HookController.BOUNDARY_MARGIN_PX;
		const sceneWidth = this.scene.scale.width;
		const sceneHeight = this.scene.scale.height;
		const cos = Math.cos(angleRad);
		const sin = Math.sin(angleRad);
		const cx = this.hookCenterRestLocalX;
		const cy = this.hookCenterRestLocalY;
		const ax = this.anchorX;
		const ay = this.anchorY;

		// Resting center already sits restingHookDistance from the pivot;
		// extension is additional local +Y beyond that pose.
		if (this.restingHookDistance <= 0) {
			return 0;
		}

		let maxE = Number.POSITIVE_INFINITY;
		const eps = 1e-6;

		// World pose of hook center at extension E:
		// wx = ax + cx*cos - (cy+E)*sin
		// wy = ay + cx*sin + (cy+E)*cos

		// Bottom: wy <= sceneHeight - margin
		if (cos > eps) {
			maxE = Math.min(
				maxE,
				(sceneHeight - margin - ay - cx * sin - cy * cos) / cos,
			);
		} else {
			const wyAtZero = ay + cx * sin + cy * cos;
			if (wyAtZero > sceneHeight - margin) {
				maxE = 0;
			}
		}

		// Left: wx >= margin
		// E*sin <= ax + cx*cos - margin - cy*sin
		const leftBound = ax + cx * cos - margin - cy * sin;
		if (sin > eps) {
			maxE = Math.min(maxE, leftBound / sin);
		} else if (sin >= -eps) {
			const wxAtZero = ax + cx * cos - cy * sin;
			if (wxAtZero < margin) {
				maxE = 0;
			}
		}
		// sin < 0: increasing E moves wx right — left bound is not an upper limit.

		// Right: wx <= sceneWidth - margin
		// E*sin >= ax + cx*cos - (sceneWidth - margin) - cy*sin
		const rightBound =
			ax + cx * cos - (sceneWidth - margin) - cy * sin;
		if (sin < -eps) {
			maxE = Math.min(maxE, rightBound / sin);
		} else if (sin <= eps) {
			const wxAtZero = ax + cx * cos - cy * sin;
			if (wxAtZero > sceneWidth - margin) {
				maxE = 0;
			}
		}
		// sin > 0: increasing E moves wx left — right bound is not an upper limit.

		if (!Number.isFinite(maxE)) {
			maxE = 0;
		}

		return Math.max(0, maxE);
	}

	private captureTransform(
		child: Phaser.GameObjects.Image,
	): CapturedImageTransform {
		return {
			worldX: child.x,
			worldY: child.y,
			angle: child.angle,
			scaleX: child.scaleX,
			scaleY: child.scaleY,
			originX: child.originX,
			originY: child.originY,
			visible: child.visible,
		};
	}

	private addChildPreservingWorldPose(
		child: Phaser.GameObjects.Image,
		transform: CapturedImageTransform,
	): void {
		this.hookContainer.add(child);

		child.setPosition(
			transform.worldX - this.anchorX,
			transform.worldY - this.anchorY,
		);
		child.setAngle(transform.angle);
		child.setScale(transform.scaleX, transform.scaleY);
		child.setOrigin(transform.originX, transform.originY);
		child.setVisible(transform.visible);
	}

	private reparentJawToPivot(
		jaw: Phaser.GameObjects.Image,
		pivot: Phaser.GameObjects.Container,
	): void {
		const localX = jaw.x - pivot.x;
		const localY = jaw.y - pivot.y;
		const angle = jaw.angle;
		const scaleX = jaw.scaleX;
		const scaleY = jaw.scaleY;
		const originX = jaw.originX;
		const originY = jaw.originY;
		const visible = jaw.visible;

		this.hookContainer.remove(jaw);
		pivot.add(jaw);
		jaw.setPosition(localX, localY);
		jaw.setAngle(angle);
		jaw.setScale(scaleX, scaleY);
		jaw.setOrigin(originX, originY);
		jaw.setVisible(visible);
	}
}
