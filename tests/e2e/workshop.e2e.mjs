// End-to-end check in a real browser (Playwright + WebGL2): the Java-shaped workshop API on a Bedrock structure.
//   npm run build && npm run test:e2e        (BEDROCK_PACK=<vanilla folder zip>, PLAYWRIGHT_MODULE=<path> if playwright is not installed locally)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, copyFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'tests/e2e/out');
const pack = process.env.BEDROCK_PACK ?? '/mnt/user-data/uploads/animation_controllers.zip';
await copyFile(pack, join(out, 'pack.zip'));
await copyFile(join(root, 'dist/mcstructure-renderer.browser.js'), join(out, 'lib.js'));
const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.zip': 'application/zip' };
const server = createServer(async (req, res) => {
	try {
		const f = join(out, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
		res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
		res.end(await readFile(f));
	} catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
await copyFile(join(root, 'tests/e2e/index.html'), join(out, 'index.html'));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/index.html`);
const run = (code) => page.evaluate(`(async()=>{ const M = window.McStructureRenderer; ${code} })()`);

try {
	const init = await run(`
		window.ws = await M.createWorkshop({ canvas: document.getElementById('c'), resourcePackUrl: ['pack.zip', 'fixture.zip'] });
		window.res = await ws.loadUrl('integ.mcstructure');
		await ws.camera.fit();
		return { keys: Object.keys(ws), dims: res.dimensions, total: res.totalBlocks, stats: res.schematic.mesh.stats };`);
	assert.deepEqual(init.keys, ['renderer', 'blueprints', 'camera', 'load', 'loadFile', 'loadUrl', 'screenshot', 'dispose'], 'same Workshop keys as the Java package');
	assert.deepEqual(init.dims, [16, 2, 16]);
	assert.equal(init.total, 289);
	assert.deepEqual(init.stats.unknownBlocks, []);
	assert.equal(init.stats.entities, 5);
	await page.screenshot({ path: join(out, '1-orbit.png') });

	const inv = await run(`return M.listContainers([res.schematic]).map(c => M.readBlockInventory(res.schematic, c.position).inventory.name);`);
	assert.deepEqual(inv, ['箱子', '大型箱子', '大型箱子', '熔炉']);

	const cam = await run(`const c = ws.camera; c.setMode('ortho'); c.align([0, 1, 0]); const o = [c.mode, c.camera.isOrthographicCamera, +ws.renderer.viewer.pitch.toFixed(2)];
		c.setMode('orbit'); await c.fit(); return { o, grid: c.toggleGrid() };`);
	assert.deepEqual(cam, { o: ['ortho', true, 1.57], grid: false });
	await page.screenshot({ path: join(out, '2-after-camera.png') });

	const pick = await run(`
		const v = ws.renderer.viewer; v.target = [2.5, 1.5, 2.5]; v.distance = 6; v.yaw = 0.6; v.pitch = 0.7; v.render();
		const h = M.pickScene(ws.renderer, null, { x: 0, y: 0 });
		return h && (h.kind === 'block' ? [h.kind, h.id, h.position] : [h.kind, h.entity.id]);`);
	assert.deepEqual(pick, ['block', 'minecraft:chest', [2, 1, 2]]);

	const fly = await run(`
		ws.camera.setMode('first'); const v = ws.renderer.viewer; const a = [...v.fly.pos];
		window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); await new Promise(r => setTimeout(r, 300)); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
		const moved = Math.hypot(...v.fly.pos.map((p, i) => p - a[i])); ws.camera.setMode('orbit'); return moved;`);
	assert.ok(fly > 1, `fly mode moved ${fly}`);

	const shot = await run(`const b = await ws.screenshot('image/png'); await ws.dispose(); return { type: b.type, size: b.size, left: ws.renderer.schematicManager.getAllSchematics().length };`);
	assert.equal(shot.type, 'image/png'); assert.ok(shot.size > 10000); assert.equal(shot.left, 0);
	assert.deepEqual(errors, []);
	console.log('e2e ok — screenshots in', out);
} finally {
	await browser.close();
	server.close();
}
