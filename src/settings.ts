import type { RenderSettingsValue } from './types.js';
import type { McStructureRenderer } from './renderer/renderer.js';

export const STORAGE_KEY = 'mc-studio.render-settings.v1';
export const RENDER_PRESETS: Record<'performance' | 'balanced' | 'quality', RenderSettingsValue> = {
  performance: { maxChunks: 128, renderDistance: 256, maxPixelRatio: 0.75, targetFPS: 60, ssao: false, frustumCulling: true },
  balanced: { maxChunks: 512, renderDistance: 0, maxPixelRatio: 1, targetFPS: 60, ssao: false, frustumCulling: true },
  quality: { maxChunks: 0, renderDistance: 0, maxPixelRatio: 2, targetFPS: 60, ssao: true, frustumCulling: true },
};

export function normalizeRenderSettings(input: Record<string, unknown> = {}): RenderSettingsValue {
  input = input && typeof input === 'object' ? input : {};
  const defaults = RENDER_PRESETS.balanced;
  const number = (key: 'maxChunks' | 'renderDistance' | 'maxPixelRatio' | 'targetFPS', min: number, max: number, round = true) => {
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return defaults[key];
    const clamped = Math.min(max, Math.max(min, n));
    return round ? Math.floor(clamped) : clamped;
  };
  return {
    maxChunks: number('maxChunks', 0, 32768),
    renderDistance: number('renderDistance', 0, 8192),
    maxPixelRatio: number('maxPixelRatio', 0.5, 2, false),
    targetFPS: number('targetFPS', 0, 240),
    ssao: typeof input.ssao === 'boolean' ? input.ssao : defaults.ssao,
    frustumCulling: typeof input.frustumCulling === 'boolean' ? input.frustumCulling : defaults.frustumCulling,
  };
}

export function readRenderSettings() {
  try { return normalizeRenderSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {}); } catch { return normalizeRenderSettings(); }
}

/**
 * Apply rendering settings. The Bedrock viewer has no chunking, culling or post-processing, so `maxPixelRatio` and
 * `targetFPS` take effect and the other fields are accepted, normalised and returned unchanged.
 */
export function applyRenderSettings(renderer: McStructureRenderer, input: Partial<RenderSettingsValue>): RenderSettingsValue {
  const settings = normalizeRenderSettings(input);
  renderer.options.chunkRenderOptions = { maxChunks: settings.maxChunks, renderDistance: settings.renderDistance, frustumCulling: settings.frustumCulling };
  renderer.renderManager.setMaxPixelRatio(settings.maxPixelRatio);
  // SSAO and the lightweight shading live on the three.js viewer (the WebGL2 fallback has neither)
  const v = renderer.viewer as unknown as { ssaoEnabled?: boolean; setShading?(on: boolean, quality?: 'normal' | 'high'): void };
  if (typeof settings.ssao === 'boolean' && 'ssaoEnabled' in v) v.ssaoEnabled = settings.ssao;
  if (typeof input.shading === 'boolean') v.setShading?.(input.shading, input.shadingQuality === 'high' ? 'high' : 'normal');
  renderer.setTargetFPS(settings.targetFPS);
  renderer.invalidate();
  return settings;
}
