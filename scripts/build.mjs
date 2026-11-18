// Bundles the library with esbuild (the tool the original dist/ was produced with).
//   node scripts/build.mjs --all                       → dist/ (ESM entries + browser bundle)
//   node scripts/build.mjs <entry> <out> <format> [globalName]   → one bundle (used by the tests)
const { build } = await import(process.env.ESBUILD_PATH ?? 'esbuild');

const args = process.argv.slice(2);
const common = { bundle: true, target: 'es2022', logLevel: 'warning' };
if (args[0] === '--sdk') {
	// The site's SDK directory (docs/SDK.md): one self-contained ES module per version, loaded at runtime with import().
	//   node scripts/build.mjs --sdk [out-root]   → <out-root>/mc-bedrock-render/<version>/index.js (default out-root: sdk/)
	const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	const sdkSrc = readFileSync('src/sdk.ts', 'utf8');
	const declared = /SDK_VERSION = '([^']+)'/.exec(sdkSrc)?.[1];
	if (declared !== pkg.version) throw new Error(`src/sdk.ts SDK_VERSION (${declared}) and package.json version (${pkg.version}) differ`);
	const api = Number(/SDK_API = (\d+)/.exec(sdkSrc)?.[1]);
	const dir = `${args[1] ?? 'sdk'}/mc-bedrock-render/${pkg.version}`;
	mkdirSync(dir, { recursive: true });
	// the site build is quiet: console.log / info / debug calls are dropped (warnings and errors stay); the npm build keeps them.
	// No source map by default (same as the Java package): SDK_SOURCEMAP=1 node scripts/build.mjs --sdk when one is needed
	await build({ ...common, entryPoints: ['src/index.ts'], outfile: `${dir}/index.js`, format: 'esm', minify: true, sourcemap: process.env.SDK_SOURCEMAP === '1' ? 'linked' : false, pure: ['console.log', 'console.info', 'console.debug'] });
	// HoloPrint's block data ships inside the bundle: its licence (CC BY-NC-SA 4.0) and notice go next to it
	const { copyFileSync } = await import('node:fs');
	for (const f of ['LICENSE-HoloPrint.txt', 'NOTICE.md']) copyFileSync(`src/renderer/holoprint/data/${f}`, `${dir}/${f}`);
	writeFileSync(`${dir}/release.json`, JSON.stringify({ edition: 'bedrock', name: pkg.name, version: pkg.version, api, entry: 'index.js' }, null, 2) + '\n');
	console.log(`built ${dir}/ (api ${api}); point the site's manifest.json at mc-bedrock-render/${pkg.version}/index.js`);
} else if (args[0] === '--all') {
	const entries = {
		index: 'src/index.ts', core: 'src/core.ts', 'renderer/index': 'src/renderer/index.ts',
		'mesh/core/index': 'src/mesh/core/index.ts', 'mesh/worker/index': 'src/mesh/worker/index.ts', 'mesh/worker/entry': 'src/mesh/worker/entry.ts',
	};
	await build({ ...common, entryPoints: entries, outdir: 'dist', format: 'esm', sourcemap: true, splitting: false });
	// classic <script> bundle: `window.McStructureRenderer` is the module namespace (same global as the first generation)
	await build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/mcstructure-renderer.browser.js', format: 'iife', globalName: 'McStructureRenderer', minify: true });
	console.log('built dist/');
} else {
	const [entry = 'src/index.ts', out = 'dist/index.js', format = 'esm', globalName = ''] = args;
	await build({ ...common, entryPoints: [entry], outfile: out, format, globalName: globalName || undefined, sourcemap: format === 'esm' });
	console.log('built', out);
}
