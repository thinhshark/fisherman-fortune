import Phaser from "phaser";

export const WATER_DISTORT_RENDER_NODE = "FilterWaterDistort";

/**
 * Controller for continuous underwater refraction on a single background image.
 * Amplitude is driven in the fragment shader by UV depth (top ≈ still, bottom stronger).
 */
export class WaterDistortController extends Phaser.Filters.Controller {
	/** Elapsed seconds fed to the fragment shader (frozen while paused). */
	time = 0;

	constructor(camera: Phaser.Cameras.Scene2D.Camera) {
		super(camera, WATER_DISTORT_RENDER_NODE);
		// Extra room so UV clamps / waves do not sample empty edge pixels.
		this.setPaddingOverride(-10, -10, 10, 10);
	}
}

const WATER_DISTORT_FS = `
precision mediump float;

uniform sampler2D uMainSampler;
uniform float time;

varying vec2 outTexCoord;

void main ()
{
    vec2 uv = outTexCoord;
    float depth = smoothstep(0.0, 1.0, uv.y);

    uv.x += sin(uv.y * 32.0 + time * 1.2) * mix(0.001, 0.008, depth);
    uv.x += sin(uv.y * 57.0 - time * 0.75) * mix(0.0005, 0.004, depth);
    uv.y += sin(uv.x * 38.0 + time * 0.9) * mix(0.0003, 0.0025, depth);

    uv = clamp(uv, vec2(0.001), vec2(0.999));
    gl_FragColor = texture2D(uMainSampler, uv);
}
`;

/**
 * Continuous water wrinkle / refraction filter (one image, no strips).
 */
export class FilterWaterDistort extends Phaser.Renderer.WebGL.RenderNodes
	.BaseFilterShader {
	constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
		super(WATER_DISTORT_RENDER_NODE, manager, undefined, WATER_DISTORT_FS);
	}

	setupUniforms(
		controller: Phaser.Filters.Controller,
		_drawingContext: Phaser.Renderer.WebGL.DrawingContext,
	): void {
		const water = controller as WaterDistortController;
		this.programManager.setUniform("time", water.time);
	}
}

/**
 * Register the render node once per WebGL renderer (safe across scene restarts).
 */
export function ensureWaterDistortFilterRegistered(
	renderer: Phaser.Renderer.WebGL.WebGLRenderer,
): boolean {
	const nodes = renderer.renderNodes;
	if (!nodes) {
		return false;
	}
	if (!nodes.hasNode(WATER_DISTORT_RENDER_NODE)) {
		nodes.addNodeConstructor(WATER_DISTORT_RENDER_NODE, FilterWaterDistort);
	}
	return true;
}
