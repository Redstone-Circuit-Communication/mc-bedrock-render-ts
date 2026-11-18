// The final gamma pass of the viewer: every pixel's colour goes through c^(1/γ), so this renderer ends on the same curve as the
// Java one (which runs a gamma of 0.5 after its tone mapping). Written for this package on the `postprocessing` Effect API;
// nothing here is copied from the Java package or from schematic-renderer (see NOTICE.md, "Code shared with the Java package").
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform } from 'three';

const GAMMA_FRAGMENT = /* glsl */ `
uniform float uGamma;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	// γ ≤ 0 means "off": pass the colour through unchanged instead of dividing by zero
	float exponent = uGamma > 0.0 ? 1.0 / uGamma : 1.0;
	outputColor = vec4(pow(max(inputColor.rgb, vec3(0.0)), vec3(exponent)), inputColor.a);
}
`;

/** Raises the image to the power 1/γ. γ = 1 leaves it as is; γ ≤ 0 turns the pass off. */
export class GammaCorrectionEffect extends Effect {
	/** The uniform object the shader reads (typed structurally: the tsconfig does not pull in three's declarations as types). */
	private readonly gamma: { value: number };

	constructor(gamma = 2.2) {
		const uniform = new Uniform(gamma);
		super('GammaCorrectionEffect', GAMMA_FRAGMENT, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uGamma', uniform]]) });
		this.gamma = uniform;
	}

	/** Current γ. */
	get value(): number {
		return this.gamma.value;
	}

	setGamma(value: number): void {
		this.gamma.value = value;
	}
}
