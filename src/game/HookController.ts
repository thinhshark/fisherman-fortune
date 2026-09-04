import Phaser from "phaser";

export type HookState = "SWINGING" | "CASTING" | "RETRACTING";

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

/**
 * Hook assembly controller: idle swing, cast, and retract.
 * Rope stem + both hook halves live in one Container pivoted at the boat anchor hole.
 * Only the Container rotates while swinging; casting extends along frozen local +Y.
 */
export class HookController {
	private static readonly MAX_ANGLE_DEG = 55;
	private static readonly CYCLE_MS = 3200;
	private static readonly CAST_SPEED_PX_PER_SEC = 650;
	private static readonly RETRACT_SPEED_PX_PER_SEC = 850;
	private static readonly CAUGHT_RETRACT_MIN_PX_PER_SEC = 180;
	private static readonly CAUGHT_RETRACT_MAX_PX_PER_SEC = 750;
	/**
	 * Construct CalculateDuration: (distance / 64) * ObjectWeight
	 * ⇒ speed = 64 / ObjectWeight. Empty-hook HookWeight was 0.1 ⇒ 640 px/s.
	 */
	private static readonly CONSTRUCT_BASE_RETRACT_PX_PER_SEC = 64 / 0.1;
	private static readonly HOOK_COLLISION_RADIUS = 32;
	private static readonly BOUNDARY_MARGIN_PX = 35;
	private static readonly CAST_ROPE_OUTER_COLOR = 0x4b2a18;
	private static readonly CAST_ROPE_INNER_COLOR = 0xc98a32;
	private static readonly CAST_ROPE_OUTER_WIDTH = 8;
	private static readonly CAST_ROPE_INNER_WIDTH = 4;

	private readonly scene: Phaser.Scene;
	private readonly hookContainer: Phaser.GameObjects.Container;
	private readonly castRope: Phaser.GameObjects.Graphics;
	private readonly hookStem: Phaser.GameObjects.Image;
	private readonly hookLeft: Phaser.GameObjects.Image;
	private readonly hookRight: Phaser.GameObjects.Image;

	private readonly anchorX: number;
	private readonly anchorY: number;

	private readonly ropeLocalX: number;
	private readonly ropeLocalY: number;
	private readonly hookLeftLocalX: number;
	private readonly hookLeftLocalY: number;
	private readonly hookRightLocalX: number;
	private readonly hookRightLocalY: number;
	private readonly hookCenterRestLocalX: number;
	private readonly hookCenterRestLocalY: number;
	private readonly restingHookDistance: number;
	private readonly worldMatrix = new Phaser.GameObjects.Components.TransformMatrix();
	private readonly hookWorld = new Phaser.Math.Vector2();

	private _state: HookState = "SWINGING";
	private elapsedMs = 0;
	private extension = 0;
	private maxExtension = 0;
	private retractSpeed = HookController.RETRACT_SPEED_PX_PER_SEC;
	private readonly retractCompleteListeners = new Set<() => void>();
	private readonly spaceKey: Phaser.Input.Keyboard.Key | undefined;

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
		this.hookLeftLocalX = hookLeft.x;
		this.hookLeftLocalY = hookLeft.y;
		this.hookRightLocalX = hookRight.x;
		this.hookRightLocalY = hookRight.y;

		this.hookCenterRestLocalX =
			(this.hookLeftLocalX + this.hookRightLocalX) * 0.5;
		this.hookCenterRestLocalY =
			(this.hookLeftLocalY + this.hookRightLocalY) * 0.5;
		this.restingHookDistance = Math.hypot(
			this.hookCenterRestLocalX,
			this.hookCenterRestLocalY,
		);

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

	/**
	 * World-space center of the joined hook (not the boat-anchor pivot).
	 * Derived from the Container world matrix and the current hook-half local center.
	 */
	get hookWorldPosition(): Readonly<{ x: number; y: number }> {
		this.updateHookWorldPosition();
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
	 * `weight` is the spreadsheet Weight ordinal: Light=1, Medium=2, Heavy=3.
	 */
	beginRetractingWithCatch(weight: number): boolean {
		if (this._state !== "CASTING") {
			return false;
		}
		this.retractSpeed = HookController.caughtRetractSpeed(weight);
		this._state = "RETRACTING";
		return true;
	}

	/** Max safe cast length for a given container angle (degrees). */
	getMaxSafeExtensionForAngleDeg(angleDeg: number): number {
		return this.computeMaxSafeExtension(Phaser.Math.DegToRad(angleDeg));
	}

	update(_time: number, delta: number): void {
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

	private handleCastInput(): void {
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
		this.retractSpeed = HookController.RETRACT_SPEED_PX_PER_SEC;
		this._state = "CASTING";
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
			this.retractSpeed = HookController.RETRACT_SPEED_PX_PER_SEC;
			this._state = "RETRACTING";
			return;
		}

		this.applyExtension();
	}

	private updateRetracting(delta: number): void {
		const deltaSec = delta / 1000;
		this.extension -= this.retractSpeed * deltaSec;

		if (this.extension <= 0) {
			this.extension = 0;
			this.applyExtension();
			this.restoreRestingLocalPositions();
			this.retractSpeed = HookController.RETRACT_SPEED_PX_PER_SEC;
			this._state = "SWINGING";
			this.notifyRetractComplete();
			return;
		}

		this.applyExtension();
	}

	private applyExtension(): void {
		const height = Math.max(this.extension, 0);
		this.redrawCastRope(height);

		// Move the existing aligned assembly together in local Y only.
		this.hookStem.setPosition(this.ropeLocalX, this.ropeLocalY + height);
		this.hookLeft.setPosition(
			this.hookLeftLocalX,
			this.hookLeftLocalY + height,
		);
		this.hookRight.setPosition(
			this.hookRightLocalX,
			this.hookRightLocalY + height,
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
		this.hookLeft.setPosition(this.hookLeftLocalX, this.hookLeftLocalY);
		this.hookRight.setPosition(this.hookRightLocalX, this.hookRightLocalY);
		this.redrawCastRope(0);
	}

	private updateHookWorldPosition(): void {
		const localX = (this.hookLeft.x + this.hookRight.x) * 0.5;
		const localY = (this.hookLeft.y + this.hookRight.y) * 0.5;
		this.hookContainer
			.getWorldTransformMatrix(this.worldMatrix)
			.transformPoint(localX, localY, this.hookWorld);
	}

	/**
	 * Spreadsheet Weight is Light/Medium/Heavy (ordinal 1/2/3). Construct's
	 * live fish-catch tween used `fishes.Width / back_speed` (duration, not a
	 * constant px/s), so it cannot be reused here. Map ordinals onto the
	 * Construct empty-hook HookWeight scale (0.1) and invert CalculateDuration:
	 * speed = 64 / (0.1 * ordinal) = 640 / ordinal, then clamp to 180–750.
	 * Heavier Weight ⇒ lower speed. Empty retract stays 850.
	 */
	private static caughtRetractSpeed(weight: number): number {
		const ordinal = Math.max(weight, 1);
		const speed =
			HookController.CONSTRUCT_BASE_RETRACT_PX_PER_SEC / ordinal;
		return Phaser.Math.Clamp(
			speed,
			HookController.CAUGHT_RETRACT_MIN_PX_PER_SEC,
			HookController.CAUGHT_RETRACT_MAX_PX_PER_SEC,
		);
	}

	private notifyRetractComplete(): void {
		for (const listener of Array.from(this.retractCompleteListeners)) {
			listener();
		}
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
}
