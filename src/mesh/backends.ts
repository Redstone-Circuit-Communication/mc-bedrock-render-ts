import { MeshBuilder as TsCore } from './core/index.js';
import type { BuildResult, PaletteItem } from './core/types.js';

export interface MeshBuildRequest { blocks: Int32Array; apron?: Int32Array; origin: [number, number, number]; ao?: boolean }

/** A palette compiler: takes a palette and `[x, y, z, paletteIndex]` block lists. */
export interface MeshBackend {
	readonly name: 'ts';
	updatePalette(items: readonly PaletteItem[]): void;
	build(request: MeshBuildRequest): BuildResult;
	dispose(): void;
}

/** The shared TypeScript mesh core. */
export class TsMeshBackend implements MeshBackend {
	readonly name = 'ts' as const;
	private core = new TsCore();
	updatePalette(items: readonly PaletteItem[]): void { this.core.updatePalette(items); }
	build(request: MeshBuildRequest): BuildResult { return this.core.build({ blocks: request.blocks, apron: request.apron, origin: request.origin, positions: 'float32', ao: request.ao }); }
	dispose(): void { this.core.dispose(); }
}

/** `wasm` is still accepted so one options object serves both renderers, but this package no longer ships a wasm builder (1.6.0, see NOTICE.md). */
export type MeshBackendName = 'wasm' | 'ts';

/**
 * Every request gets the TypeScript core. Up to 1.5 `wasm` meant the Java package's wasm mesh builder embedded in this package;
 * its Rust source is schematic-renderer's (AGPL-3.0), which cannot ship inside a CC BY-NC-SA package, so it was taken out.
 */
export async function createMeshBackend(_preferred: MeshBackendName): Promise<MeshBackend> {
	return new TsMeshBackend();
}
