import type { McStructureRenderer } from './renderer/renderer.js';

/** Call from a user gesture when the caller wants to download the returned Blob. */
export function captureScreenshot(renderer: McStructureRenderer, type = 'image/png', quality?: number): Promise<Blob> {
  return renderer.viewer.screenshot(type, quality);
}
