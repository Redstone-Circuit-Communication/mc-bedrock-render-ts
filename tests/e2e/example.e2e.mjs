// Runs the (Java-identical) example app against the Bedrock engine in a real browser.
// The example is bundled with the library sources and the real three.js from node_modules.
// The example downloads Mojang's official resource pack at runtime, so this test needs network access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, 'tests/e2e/out/example');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'src'), { recursive: true });
const { build } = await import(process.env.ESBUILD_PATH ?? 'esbuild');
await build({
	entryPoints: { 'src/main': join(root, 'example/src/main.js'), 'src/minimal': join(root, 'example/src/minimal.js') },
	outdir: out, bundle: true, format: 'esm', target: 'es2022', logLevel: 'warning',
	alias: { '@rsw/mc-bedrock-render-ts': join(root, 'src/index.ts') },
	// what Vite gives the example as `import.meta.env.BASE_URL` with its default base
	define: { 'import.meta.env.BASE_URL': '"./"' },
});
await cp(join(root, 'example/index.html'), join(out, 'index.html'));
await cp(join(root, 'example/minimal.html'), join(out, 'minimal.html'));
await cp(join(root, 'example/src/style.css'), join(out, 'src/style.css'));
await cp(join(root, 'example/public'), out, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.zip': 'application/zip' };
const server = createServer(async (req, res) => {
	try {
		const f = join(out, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
		res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
		res.end(await readFile(f));
	} catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) problems.push('console: ' + m.text()); });
const text = (sel) => page.locator(sel).first().innerText();
const waitScene = (name) => page.waitForFunction((n) => document.getElementById('scene-name')?.textContent === n && document.getElementById('canvas')?.getAttribute('aria-busy') === 'false', name, { timeout: 120000 });
const shot = (n) => page.screenshot({ path: join(out, `${n}.png`) });

try {
	await page.goto(`${base}/index.html`);
	await waitScene('inspection-demo');
	assert.ok(Number((await text('#total-blocks')).replace(/[^\d]/g, '')) > 100, 'material totals are shown');
	assert.ok((await page.locator('#material-list .material-row').count()) > 5, 'material rows');
	assert.ok((await page.locator('#container-select option').count()) > 10, 'containers were indexed');
	assert.ok((await page.locator('#entity-select option').count()) >= 3, 'entities were indexed');
	await shot('1-inspection-demo');

	// view modes and shortcuts of the example
	await page.keyboard.press('Digit3'); await page.waitForTimeout(300);
	assert.match(await text('#view-label'), /Orthographic/);
	await shot('2-ortho');
	await page.keyboard.press('Digit1'); await page.keyboard.press('KeyG'); await page.keyboard.press('KeyF');
	await page.locator('#axis-buttons button').nth(2).click(); await page.waitForTimeout(300);   // look from +Y
	await shot('3-top');

	// pick the first chest by clicking the canvas centre after focusing it
	await page.evaluate(() => { const { views, renderer } = window.mcStudio; views.align([0.5, 0.8, 1]); views.focusBlock(renderer.schematicManager.getAllSchematics()[0], [1, 1, 2]); });
	await page.waitForTimeout(300);
	const box = await page.locator('#canvas').boundingBox();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(400);
	const inspect = await text('#inspect-content');
	assert.match(inspect, /Chest/); assert.match(inspect, /minecraft:chest/);
	await shot('4-picked-chest');

	// double chest through the container list
	await page.selectOption('#container-select', { index: 3 }); await page.waitForTimeout(400);
	assert.match(await text('#inspect-content'), /Large Chest|Chest|Trapped Chest|Barrel|Shulker Box|Hopper|Dispenser|Dropper/);

	// every entity of the pack
	await page.selectOption('#demo-select', './schematics/all-entities.mcstructure');
	await waitScene('all-entities');
	const ents = await page.locator('#entity-select option').count();
	// only entities the game can load from a structure (no player, projectile or client-only definition)
	assert.ok(ents > 100, `all-entities lists ${ents} entities`);
	const status = await page.evaluate(() => { const m = window.mcStudio.renderer.schematicManager.getAllSchematics()[0].mesh; return { drawn: m.stats.entities, undrawn: m.stats.undrawnEntities, missing: m.stats.missingEntityTextures.length }; });
	assert.ok(status.drawn >= 100 && status.undrawn.length === 0 && status.missing === 0, JSON.stringify(status));
	await page.evaluate(() => window.mcStudio.views.align([0, 1, 0]));
	await shot('5-all-entities');

	// every block id of the pack
	await page.selectOption('#demo-select', './schematics/all-blocks.mcstructure');
	await waitScene('all-blocks');
	const blocks = await page.evaluate(() => { const m = window.mcStudio.renderer.schematicManager.getAllSchematics()[0].mesh.stats; return { unknown: m.unknownBlocks, missing: m.missingTextures.length, faces: m.faces }; });
	console.log('all-blocks:', JSON.stringify(blocks));
	assert.ok(blocks.unknown.length <= 3, 'unknown blocks: ' + blocks.unknown.join(','));
	await page.evaluate(() => window.mcStudio.views.align([0.3, 1, 0.6]));
	await shot('6-all-blocks');

	// render settings + HUD panels exist and respond
	await page.evaluate(() => { const r = window.mcStudio.renderSettings; r.settings.targetFPS = 30; r.apply(false); });
	assert.equal(await page.evaluate(() => window.mcStudio.renderer.viewer.canvas.width > 0), true);

	// the minimal example
	await page.goto(`${base}/minimal.html`);
	await page.waitForFunction(() => document.getElementById('materials')?.children.length > 0, null, { timeout: 120000 });
	assert.match(await text('#status'), /inspection-demo/);
	await shot('7-minimal');
	assert.deepEqual(problems, []);
	console.log('example e2e ok — screenshots in', out);
} finally {
	await browser.close();
	server.close();
}
