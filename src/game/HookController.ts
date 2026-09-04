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
 * Idle swinging of the rope + dual-hook assembly around the boat anchor hole.
 * The three images are reparented into one Container; only the Container rotates.
 * CASTING / RETRACTING are reserved for later gameplay states.
 */
export class HookController {
	private static readonly MAX_ANGLE_DEG = 55;
	private static readonly CYCLE_MS = 3200;

	private readonly hookContainer: Phaser.GameObjects.Container;

	private readonly anchorX: number;
	private readonly anchorY: number;

	/** Local child positions captured after setup; never rewritten in update(). */
	private readonly ropeLocalX: number;
	private readonly ropeLocalY: number;
	private readonly hookLeftLocalX: number;
	private readonly hookLeftLocalY: number;
	private readonly hookRightLocalX: number;
	private readonly hookRightLocalY: number;

	private state: HookState = "SWINGING";
	private elapsedMs = 0;

	constructor(
		scene: Phaser.Scene,
		rope: Phaser.GameObjects.Image,
		hookLeft: Phaser.GameObjects.Image,
		hookRight: Phaser.GameObjects.Image,
	) {
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

		this.hookContainer.rotation = 0;
	}

	/** Pivot of the swing Container (scene / world space). */
	get pivot(): Readonly<{ x: number; y: number }> {
		return { x: this.anchorX, y: this.anchorY };
	}

	/** Child local positions after reparenting (constant during update). */
	get childLocals(): Readonly<{
		rope: { x: number; y: number };
		hookLeft: { x: number; y: number };
		hookRight: { x: number; y: number };
	}> {
		return {
			rope: { x: this.ropeLocalX, y: this.ropeLocalY },
			hookLeft: { x: this.hookLeftLocalX, y: this.hookLeftLocalY },
			hookRight: { x: this.hookRightLocalX, y: this.hookRightLocalY },
		};
	}

	update(_time: number, delta: number): void {
		switch (this.state) {
			case "SWINGING":
				this.updateSwinging(delta);
				break;
			case "CASTING":
			case "RETRACTING":
				// Reserved for later gameplay.
				break;
		}
	}

	private updateSwinging(delta: number): void {
		this.elapsedMs += delta;
		const phase =
			(this.elapsedMs / HookController.CYCLE_MS) * Math.PI * 2;
		const angleDeg =
			HookController.MAX_ANGLE_DEG * Math.sin(phase);

		// Only the Container rotates. Children and Container position stay fixed.
		this.hookContainer.rotation = Phaser.Math.DegToRad(angleDeg);
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

	/**
	 * Add the image to the swing Container and restore its previous on-screen pose
	 * as container-local coordinates (pixel-identical at rotation 0).
	 */
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
