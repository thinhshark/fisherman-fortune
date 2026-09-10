import Phaser from "phaser";
import { type CreatureCategory } from "./CreatureCatalog";
import { DEBUG_PULL_SPEED } from "./config/CreatureBalance";
import {
	HOOK_CAST,
	HOOK_JAWS,
	HOOK_JAW_TRANSITION_MS,
	HOOK_SWING,
} from "./config/HookConfig";

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

/** Dev-only: log once per state change with jaw target deltas. */
const LOG_JAW_TARGETS = false;

/**
 * The only speed constant this controller owns. Every caught-object speed
 * comes from the caught definition's CreatureBalance/ItemBalance retractSpeed.
 */
export const EMPTY_RETRACT_SPEED_PX_PER_SEC = 600;

/** Dev-only: distinguishes controller instances if one ever leaks a restart. */
let nextHookInstanceId = 1;

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
	/** Creature or item weight label (diagnostics only). */
	weight?: string;
	/** Sprite texture key at catch time (diagnostics only). */
	textureKey?: string;
	/** Sprite animation key at catch time (diagnostics only). */
	animationKey?: string;
}

interface PullMeasureSession {
	creatureId?: string;
	itemId?: string;
	weight?: string;
	textureKey?: string;
	animationKey?: string;
	configuredRetractSpeed: number;
	effectiveRetractSpeed: number;
	startExtension: number;
	expectedDurationMs: number;
	startedAt: number;
	frameCount: number;
}

/**
 * Hook assembly controller: idle swing, cast, and retract.
 * Rope stem + both jaw pivots live in one Container pivoted at the boat anchor hole.
 * Only the Container rotates while swinging; casting extends along frozen local +Y.
 * Jaw open/close is applied to nested hinge pivots, not the PNG bounding-box centers.
 */
export class HookController {
	private static readonly HOOK_COLLISION_RADIUS = 32;
	private static readonly ATTACH_OFFSET_PX = 24;
	private static readonly BOUNDARY_MARGIN_PX = 35;
	private static readonly CAST_ROPE_OUTER_COLOR = 0x4b2a18;
	private static readonly CAST_ROPE_INNER_COLOR = 0xc98a32;
	private static readonly CAST_ROPE_OUTER_WIDTH = 8;
	private static readonly CAST_ROPE_INNER_WIDTH = 4;

	private readonly scene: Phaser.Scene;
	private readonly player?: Phaser.GameObjects.Image;
	private readonly hookContainer: Phaser.GameObjects.Container;
	private readonly castRope: Phaser.GameObjects.Graphics;
	private readonly hookStem: Phaser.GameObjects.Image;
	private readonly hookLeft: Phaser.GameObjects.Image;
	private readonly hookRight: Phaser.GameObjects.Image;
	private readonly hookLeftPivot: Phaser.GameObjects.Container;
	private readonly hookRightPivot: Phaser.GameObjects.Container;

	private anchorX: number;
	private anchorY: number;
	private readonly anchorLocalX: number;
	private readonly anchorLocalY: number;
	/** Swing angle relative to the boat, independent of boat rock. */
	private swingRotation = 0;

	private readonly ropeLocalX: number;
	private readonly ropeLocalY: number;
	private readonly hookCenterRestLocalX: number;
	private readonly hookCenterRestLocalY: number;
	private readonly restingHookDistance: number;
	private readonly worldMatrix = new Phaser.GameObjects.Components.TransformMatrix();
	private readonly invertMatrix = new Phaser.GameObjects.Components.TransformMatrix();
	private readonly hookWorld = new Phaser.Math.Vector2();
	private readonly localPoint = new Phaser.Math.Vector2();
	/** Creature currently sandwiched between jaw pivots (display list only). */
	private caughtDisplay?: Phaser.GameObjects.Sprite;

	private _state: HookState = "SWINGING";
	private elapsedMs = 0;
	private extension = 0;
	private maxExtension = 0;
	/**
	 * Runtime source of truth for RETRACTING movement (px/s).
	 * Set once when retract begins; never re-derived from cast/empty speed mid-pull.
	 */
	private activeRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
	/** True while a caught object owns the retract speed (blocks empty-speed overwrite). */
	private caughtPullActive = false;
	private pullMeasure?: PullMeasureSession;
	/** Dev-only identity so duplicate controllers are visible in pull logs. */
	private readonly instanceId = nextHookInstanceId++;
	private readonly retractCompleteListeners = new Set<() => void>();
	private readonly spaceKey: Phaser.Input.Keyboard.Key | undefined;
	/** Cast input starts disabled until Home → Play. */
	private inputEnabled = false;
	/** Frozen at rest until gameplay begins (also used by Pause). */
	private paused = true;
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
		player?: Phaser.GameObjects.Image,
	) {
		this.scene = scene;
		this.player = player;
		this.hookStem = rope;
		this.hookLeft = hookLeft;
		this.hookRight = hookRight;

		// Rope top-center is already at the boat's circular anchor hole.
		this.anchorX = rope.x;
		this.anchorY = rope.y;
		this.anchorLocalX = player ? rope.x - player.x : 0;
		this.anchorLocalY = player ? rope.y - player.y : 0;

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
		this.swingRotation = 0;
		this.applyBoatAnchor();

		this.spaceKey = scene.input.keyboard?.addKey(
			Phaser.Input.Keyboard.KeyCodes.SPACE,
		);
		this.registerInput();
	}

	get pivot(): Readonly<{ x: number; y: number }> {
		return { x: this.anchorX, y: this.anchorY };
	}

	/** Boat-relative swing angle (radians). */
	get swingAngleRad(): number {
		return this.swingRotation;
	}

	/**
	 * World aim rotation for cast / bomb (radians).
	 * Matches cast extension: local +Y along the rope.
	 */
	get worldAimAngleRad(): number {
		return this.player
			? this.player.rotation + this.swingRotation
			: this.swingRotation;
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
	 * Home → Play: unfreeze idle swing and enable cast input.
	 */
	beginGameplay(): void {
		this.paused = false;
		this.inputEnabled = true;
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

	/**
	 * Parent a caught creature for jaw/rope sandwich once (container child order):
	 * hookLeftPivot < creature < hookStem (rope) < hookRightPivot.
	 * Only hook-left stays behind the fish; rope and hook-right draw in front.
	 * Preserves world position, scale, flipX, and world rotation.
	 */
	insertCaughtCreatureDisplay(sprite: Phaser.GameObjects.Sprite): void {
		if (this.caughtDisplay === sprite) {
			return;
		}
		if (this.caughtDisplay) {
			this.releaseCaughtCreatureDisplay(this.caughtDisplay);
		}

		const worldX = sprite.x;
		const worldY = sprite.y;
		const worldRotation = sprite.rotation;

		if (sprite.parentContainer !== this.hookContainer) {
			this.hookContainer.add(sprite);
		}
		this.applyCaughtHookDisplayOrder(sprite);
		// Counter container swing so the fish stays world-upright like before.
		sprite.setRotation(worldRotation - this.hookContainer.rotation);
		this.setCaughtCreatureWorldPosition(sprite, worldX, worldY);
		this.caughtDisplay = sprite;
	}

	/**
	 * Remove caught creature from the hook container without destroying it.
	 * Restores idle child order so the next catch can re-sandwich cleanly.
	 */
	releaseCaughtCreatureDisplay(sprite: Phaser.GameObjects.Sprite): void {
		if (sprite.parentContainer === this.hookContainer) {
			this.hookContainer.remove(sprite, false);
		}
		if (this.caughtDisplay === sprite) {
			this.caughtDisplay = undefined;
		}
		this.restoreIdleHookDisplayOrder();
	}

	/**
	 * Caught order (back → front): castRope, left jaw, creature, rope stem, right jaw.
	 * Uses bringToTop only — avoids Container.moveTo out-of-bounds throws.
	 */
	private applyCaughtHookDisplayOrder(
		sprite: Phaser.GameObjects.Sprite,
	): void {
		this.hookContainer.sendToBack(this.castRope);
		this.hookContainer.bringToTop(this.hookLeftPivot);
		this.hookContainer.bringToTop(sprite);
		this.hookContainer.bringToTop(this.hookStem);
		this.hookContainer.bringToTop(this.hookRightPivot);
	}

	/**
	 * Idle order (back → front): castRope, stem, left jaw, right jaw.
	 */
	private restoreIdleHookDisplayOrder(): void {
		this.hookContainer.sendToBack(this.castRope);
		this.hookContainer.bringToTop(this.hookStem);
		this.hookContainer.bringToTop(this.hookLeftPivot);
		this.hookContainer.bringToTop(this.hookRightPivot);
	}

	/** True when this sprite is currently sandwiched in the hook display list. */
	isCaughtCreatureDisplay(sprite: Phaser.GameObjects.Sprite): boolean {
		return (
			this.caughtDisplay === sprite ||
			sprite.parentContainer === this.hookContainer
		);
	}

	/**
	 * Place a sandwiched creature so its world origin matches (worldX, worldY).
	 * Call each retract frame; offsets (e.g. Big Fish +15 Y) stay in world space.
	 */
	setCaughtCreatureWorldPosition(
		sprite: Phaser.GameObjects.Sprite,
		worldX: number,
		worldY: number,
	): void {
		this.hookContainer.getWorldTransformMatrix(this.worldMatrix);
		this.invertMatrix.copyFrom(this.worldMatrix);
		this.invertMatrix.invert();
		this.invertMatrix.transformPoint(worldX, worldY, this.localPoint);
		sprite.setPosition(this.localPoint.x, this.localPoint.y);
	}

	/** World-space origin of a sprite (works inside or outside the hook container). */
	getDisplayWorldPosition(
		sprite: Phaser.GameObjects.Sprite,
	): Readonly<{ x: number; y: number }> {
		if (sprite.parentContainer !== this.hookContainer) {
			return { x: sprite.x, y: sprite.y };
		}
		this.hookContainer
			.getWorldTransformMatrix(this.worldMatrix)
			.transformPoint(sprite.x, sprite.y, this.hookWorld);
		return { x: this.hookWorld.x, y: this.hookWorld.y };
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
	 * Locks `activeRetractSpeed` to the caller's explicit per-object pullSpeed
	 * for the entire caught retraction (never falls back to empty-hook 850).
	 */
	beginRetractingWithCatch(
		pullSpeed: number,
		info?: RetractionStartInfo,
	): boolean {
		if (this._state !== "CASTING") {
			return false;
		}

		if (
			typeof pullSpeed !== "number" ||
			!Number.isFinite(pullSpeed) ||
			pullSpeed <= 0
		) {
			throw new Error(
				`beginRetractingWithCatch requires a positive pullSpeed, got ${String(pullSpeed)}`,
			);
		}

		// Lock before setState so no empty-retract path can overwrite mid-transition.
		this.activeRetractSpeed = pullSpeed;
		this.caughtPullActive = true;
		this.pendingRetractInfo = {
			retractReason: "caught",
			creatureId: info?.creatureId,
			itemId: info?.itemId,
			category: info?.category,
		};
		this.setState("RETRACTING");
		this.beginPullMeasure(pullSpeed, info);
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
		this.applyBoatAnchor();
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

	private applyBoatAnchor(): void {
		const player = this.player;
		if (!player) {
			this.hookContainer.setPosition(this.anchorX, this.anchorY);
			this.hookContainer.rotation = this.swingRotation;
			return;
		}
		const cos = Math.cos(player.rotation);
		const sin = Math.sin(player.rotation);
		this.anchorX =
			player.x + this.anchorLocalX * cos - this.anchorLocalY * sin;
		this.anchorY =
			player.y + this.anchorLocalX * sin + this.anchorLocalY * cos;
		this.hookContainer.setPosition(this.anchorX, this.anchorY);
		this.hookContainer.rotation = player.rotation + this.swingRotation;
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
		this.applyBoatAnchor();
		this.beginCasting();
	}

	private beginCasting(): void {
		// Freeze current swing angle; elapsedMs stays put so resume has no jump.
		this.maxExtension = this.computeMaxSafeExtension(
			this.player
				? this.player.rotation + this.swingRotation
				: this.swingRotation,
		);
		this.extension = 0;
		this.activeRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
		this.caughtPullActive = false;
		this.pullMeasure = undefined;
		this.setState("CASTING");
		this.applyExtension();
	}

	private updateSwinging(delta: number): void {
		this.elapsedMs += delta;
		const phase =
			(this.elapsedMs / HOOK_SWING.fullCycleMs) * Math.PI * 2;
		const angleDeg =
			HOOK_SWING.amplitudeDegrees * Math.sin(phase);
		this.swingRotation = Phaser.Math.DegToRad(angleDeg);
	}

	private updateCasting(delta: number): void {
		const deltaSec = delta / 1000;
		this.extension += HOOK_CAST.speedPxPerSec * deltaSec;

		if (this.extension >= this.maxExtension) {
			this.extension = this.maxExtension;
			this.applyExtension();
			this.beginEmptyRetracting();
			return;
		}

		this.applyExtension();
	}

	private beginEmptyRetracting(): void {
		// Empty-only path. Must never run after a successful catch lock.
		if (this.caughtPullActive) {
			return;
		}
		this.activeRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
		this.caughtPullActive = false;
		this.pullMeasure = undefined;
		this.pendingRetractInfo = { retractReason: "empty" };
		this.setState("RETRACTING");
	}

	private updateRetracting(delta: number): void {
		// Phaser scene delta is milliseconds — convert before px/s movement.
		const deltaSeconds = delta / 1000;
		const remainingDistance = this.extension;
		const movement = this.activeRetractSpeed * deltaSeconds;
		this.extension = Math.max(0, remainingDistance - movement);

		if (this.pullMeasure) {
			this.pullMeasure.frameCount += 1;
		}

		if (this.extension <= 0) {
			this.extension = 0;
			this.applyExtension();
			this.restoreRestingLocalPositions();
			this.endPullMeasure();
			this.activeRetractSpeed = EMPTY_RETRACT_SPEED_PX_PER_SEC;
			this.caughtPullActive = false;
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
		this.applyJawPoseForState(next);
	}

	/**
	 * Single owner of jaw-left / jaw-right local rotations per hook state.
	 * Independent of HOOK_SWING (container rotation about the boat anchor).
	 */
	private applyJawPoseForState(state: HookState): void {
		switch (state) {
			case "SWINGING":
				this.setJawTarget(
					HOOK_JAWS.swinging.left,
					HOOK_JAWS.swinging.right,
				);
				break;
			case "CASTING":
				this.setJawTarget(
					HOOK_JAWS.casting.left,
					HOOK_JAWS.casting.right,
				);
				break;
			case "RETRACTING":
				this.setJawTarget(
					HOOK_JAWS.retracting.left,
					HOOK_JAWS.retracting.right,
				);
				break;
			default: {
				const invalid: never = state;
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
			this.jawTweenElapsedMs / HOOK_JAW_TRANSITION_MS,
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

	private beginPullMeasure(
		pullSpeed: number,
		info?: RetractionStartInfo,
	): void {
		const startExtension = this.extension;
		const expectedDurationMs =
			pullSpeed > 0
				? (startExtension / pullSpeed) * 1000
				: Number.POSITIVE_INFINITY;
		this.pullMeasure = {
			creatureId: info?.creatureId,
			itemId: info?.itemId,
			weight: info?.weight,
			textureKey: info?.textureKey,
			animationKey: info?.animationKey,
			configuredRetractSpeed: pullSpeed,
			effectiveRetractSpeed: this.activeRetractSpeed,
			startExtension,
			expectedDurationMs,
			startedAt: this.scene.time.now,
			frameCount: 0,
		};

		if (!DEBUG_PULL_SPEED) {
			return;
		}

		console.info("[PULL START]", {
			creatureId: this.pullMeasure.creatureId ?? this.pullMeasure.itemId,
			textureKey: this.pullMeasure.textureKey,
			animationKey: this.pullMeasure.animationKey,
			weight: this.pullMeasure.weight,
			configuredRetractSpeed: this.pullMeasure.configuredRetractSpeed,
			activeRetractSpeed: this.pullMeasure.effectiveRetractSpeed,
			startExtension: this.pullMeasure.startExtension,
			expectedDurationMs: this.pullMeasure.expectedDurationMs,
			hookControllerInstanceId: this.instanceId,
		});
	}

	private endPullMeasure(): void {
		const session = this.pullMeasure;
		this.pullMeasure = undefined;
		if (!session || !DEBUG_PULL_SPEED) {
			return;
		}
		console.info("[PULL END]", {
			creatureId: session.creatureId ?? session.itemId,
			actualDurationMs: this.scene.time.now - session.startedAt,
			expectedDurationMs: session.expectedDurationMs,
			frameCount: session.frameCount,
			endExtension: this.extension,
			activeRetractSpeed: this.activeRetractSpeed,
			hookControllerInstanceId: this.instanceId,
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
