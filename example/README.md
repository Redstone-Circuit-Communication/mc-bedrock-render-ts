# Block Workshop example

Run `pnpm install --frozen-lockfile` and `pnpm run dev:example` in the repository root. The home page is the full workbench;
`/minimal.html` shows the smallest SDK integration.

`pnpm run build && pnpm run build:example` writes `example/dist/`. Serve the whole folder over HTTP so relative paths keep
working. Sources, the official pack listings and structures live in `example/src/`, `example/public/packs/` and
`example/public/schematics/`. The example downloads Mojang's official Bedrock resources in the browser, file by file as a
structure needs them; nothing from Minecraft is bundled.

The "Every block" and "Every entity" structures in the drop-down are for checking the rendering one item at a time;
`pnpm run schematics:coverage` regenerates them (and their CSV indexes).

The page is in English by default and follows a Chinese browser language; the button in the header switches between
English and Simplified Chinese. The strings live in `example/src/i18n.js`.
