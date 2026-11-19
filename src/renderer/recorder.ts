import type { StructureViewer } from './viewer';

export interface RecordingOptions {
  width?: number;
  height?: number;
  frameRate?: number;
  /** 0–1, maps to the video bitrate. */
  quality?: number;
  /**
   * Output format. The Java renderer encodes with ffmpeg.wasm (`h264`, `dnxhr_444`, `prores_4444`, `vp9_alpha`, `png_zip`); here the
   * browser's MediaRecorder does it, so `h264` gives MP4 where the browser can and WebM otherwise, and `vp9_alpha` gives WebM.
   * The other codecs throw.
   */
  codec?: 'h264' | 'vp9_alpha' | 'dnxhr_444' | 'prores_4444' | 'png_zip';
  /** Transparent background (needs `vp9_alpha`). */
  transparent?: boolean;
  onStart?: () => void;
  onProgress?: (progress: number) => void;
  onComplete?: (blob: Blob) => void;
  /** Drive the camera yourself: called before each frame with the progress 0–1. Without it the camera makes one turn around the structure. */
  onFrame?: (progress: number) => void;
}

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  transparent?: boolean;
}

const pickMime = (codec: RecordingOptions['codec'], transparent: boolean): string => {
  const prefer = codec === 'vp9_alpha' || transparent
    ? ['video/webm;codecs=vp9', 'video/webm']
    : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const found = prefer.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
  if (!found) throw new Error('this browser cannot record video');
  return found;
};

/** Screenshots and orbit recordings of a viewer: the Java renderer's `cameraManager.recordingManager`, on MediaRecorder. */
export class RecordingManager {
  private active = false;
  private stopRequested = false;
  constructor(private viewer: StructureViewer) {}

  get isRecording(): boolean { return this.active; }

  takeScreenshot(o: ScreenshotOptions = {}): Promise<Blob> {
    return this.viewer.screenshot(o.format ?? 'image/png', o.quality ?? (o.format === 'image/png' || !o.format ? undefined : 0.95), { width: o.width, height: o.height, transparent: o.transparent });
  }

  /** Record `duration` seconds; resolves when the file is complete (the Blob goes to `onComplete`). */
  async startRecording(duration: number, o: RecordingOptions = {}): Promise<void> {
    if (this.active) throw new Error('already recording');
    if (o.codec && !['h264', 'vp9_alpha'].includes(o.codec)) throw new Error(`recording format ${o.codec} is not available in this renderer; use h264 or vp9_alpha`);
    const v = this.viewer, canvas = v.canvas;
    const mime = pickMime(o.codec, !!o.transparent);
    const fps = o.frameRate ?? 30;
    const quality = Math.max(0.05, Math.min(1, o.quality ?? 0.8));
    const bits = Math.round((canvas.width * canvas.height * fps * 0.1) * quality * 2);
    const startYaw = v.yaw, wasRotating = v.autoRotate;
    const bg = v.backgroundColor;
    this.active = true; this.stopRequested = false;
    if (o.width || o.height) v.setCaptureSize({ width: o.width ?? (o.height as number) * (canvas.clientWidth / Math.max(1, canvas.clientHeight)), height: o.height ?? (o.width as number) / (canvas.clientWidth / Math.max(1, canvas.clientHeight)) });
    if (o.transparent) v.setBackgroundAlpha(0);
    v.autoRotate = false;
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: bits });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] })); });
    try {
      rec.start(250);
      o.onStart?.();
      const t0 = performance.now(), total = Math.max(0.1, duration) * 1000;
      await new Promise<void>((resolve) => {
        const step = () => {
          const p = Math.min(1, (performance.now() - t0) / total);
          if (o.onFrame) o.onFrame(p); else v.yaw = startYaw + p * Math.PI * 2;
          v.invalidate();
          o.onProgress?.(p);
          if (p >= 1 || this.stopRequested) resolve(); else requestAnimationFrame(step);
        };
        step();
      });
      rec.stop();
      const blob = await done;
      o.onComplete?.(blob);
    } finally {
      if (rec.state !== 'inactive') rec.stop();
      this.active = false;
      v.autoRotate = wasRotating;
      v.setCaptureSize(null);
      if (o.transparent) v.setBackgroundAlpha(bg[3]);
      v.invalidate();
    }
  }

  stopRecording(): void { if (this.active) this.stopRequested = true; }
  dispose(): void { this.stopRecording(); }
}
