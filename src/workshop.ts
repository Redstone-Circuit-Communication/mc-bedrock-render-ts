import { BlueprintLoader } from './blueprint-loader.js';
import { CameraControls } from './camera-controls.js';
import { captureScreenshot } from './capture.js';
import { solidsOf } from './solids.js';
import { McStructureRenderer, type RendererOptions } from './renderer/renderer.js';

export interface WorkshopOptions {
  canvas: HTMLCanvasElement;
  /**
   * Resource pack(s) to load before the workshop is returned: a URL, or several URLs in override order
   * (e.g. the base `vanilla` pack first, then the packs holding newer blocks and mobs, then a texture pack).
   * Each URL may point to a zip, `.mcpack`, `.brarchive` or a zip that contains several packs.
   */
  resourcePackUrl: string | string[];
  resourcePackName?: string;
  rendererOptions?: RendererOptions;
  /** Initialization timeout, milliseconds. */
  timeoutMs?: number;
}

/** Initialize the renderer and its resource pack(s) before returning an SDK instance. */
export function createWorkshopRenderer(options: WorkshopOptions): Promise<McStructureRenderer> {
  return new Promise<McStructureRenderer>((resolve, reject) => {
    let instance: McStructureRenderer | undefined;
    let settled = false;
    const finish = (error?: unknown, ready?: McStructureRenderer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.canvas.removeEventListener('rendererError', onError);
      if (ready) resolve(ready);
      else {
        try {
          instance?.dispose();
        } finally {
          reject(error);
        }
      }
    };
    const onError = (event: Event) => finish((event as CustomEvent).detail);
    const timer = setTimeout(() => finish(new Error('渲染器初始化超时')), options.timeoutMs ?? 120000);
    options.canvas.addEventListener('rendererError', onError);
    try {
      const name = options.resourcePackName ?? 'workshop';
      const urls = Array.isArray(options.resourcePackUrl) ? options.resourcePackUrl : [options.resourcePackUrl];
      // several packs are loaded in the given order (later ones override earlier ones)
      const packs: Record<string, () => Promise<Blob>> = {};
      urls.forEach((url, i) => {
        packs[i === 0 ? name : `${name}-${i + 1}`] = async () => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`资源包请求失败（HTTP ${response.status}）`);
          return response.blob();
        };
      });
      instance = new McStructureRenderer(options.canvas, {}, packs, {
        showGrid: true,
        showAxes: false,
        enableDragAndDrop: false,
        enableInteraction: false,
        singleSchematicMode: false,
        enableProgressBar: false,
        sidebarOptions: { enabled: false },
        resourcePackOptions: { showMissingPackNotice: false },
        ...options.rendererOptions,
        callbacks: {
          ...options.rendererOptions?.callbacks,
          onRendererInitialized: (ready) => {
            if (settled) {
              ready.dispose();
              return;
            }
            try {
              options.rendererOptions?.callbacks?.onRendererInitialized?.(ready);
              finish(undefined, ready);
            } catch (error) {
              finish(error);
            }
          },
        },
      });
    } catch (error) {
      finish(error);
    }
  });
}

export async function createWorkshop(options: WorkshopOptions) {
  const renderer = await createWorkshopRenderer(options);
  const blueprints = new BlueprintLoader(renderer);
  const camera = new CameraControls(renderer);
  let closing: Promise<void> | undefined;
  return {
    renderer,
    blueprints,
    camera,
    load: blueprints.load.bind(blueprints),
    loadFile: blueprints.loadFile.bind(blueprints),
    loadUrl: blueprints.loadUrl.bind(blueprints),
    screenshot: (type?: string, quality?: number) => captureScreenshot(renderer, type, quality),
    /** The loaded structure as a collision grid for a host-driven first-person camera (null before anything loads). */
    solids: () => solidsOf(renderer),
    dispose: () => (closing ??= (async () => {
      await blueprints.dispose();
      renderer.dispose();
    })()),
  };
}
export type Workshop = Awaited<ReturnType<typeof createWorkshop>>;
