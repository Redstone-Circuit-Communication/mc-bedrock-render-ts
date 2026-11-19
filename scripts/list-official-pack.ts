/**
 * Lists the files of Mojang's official Bedrock resource pack (github.com/Mojang/bedrock-samples) that the renderer can use,
 * for loading that pack on demand with a `RemotePackSource`. Only file names are written; the files themselves stay on
 * Mojang's repository and are downloaded by the browser from a CDN.
 *
 *   git clone --filter=blob:none --no-checkout --depth 1 --branch <tag> https://github.com/Mojang/bedrock-samples.git <dir>
 *   pnpm pack:list-official <dir> <tag> [prefix] > example/public/packs/bedrock-samples-<tag>.json
 *
 * `prefix` keeps only the files below it, e.g. `models/entity/` for an older release that is only needed for its legacy
 * entity geometry (see README, "Loading the official resources on demand").
 */
import { execFileSync } from "node:child_process";
import { DEFAULT_ROOTS, PBR_EXTRAS } from "../src/renderer/resources.ts";

const [dir, tag, prefix = ''] = process.argv.slice(2);
if (!dir || !tag) throw new Error("usage: tsx scripts/list-official-pack.ts <bedrock-samples clone> <tag> [prefix]");
const all = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", tag, "resource_pack/"], { encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\n")
  .filter(Boolean)
  .map((p) => p.slice("resource_pack/".length));
const files = all.filter((p) => p.startsWith(prefix) && DEFAULT_ROOTS.some((r) => p.startsWith(r)) && !PBR_EXTRAS.test(p)).sort();
process.stdout.write(
  JSON.stringify(
    {
      source: "https://github.com/Mojang/bedrock-samples",
      tag,
      baseUrl: [
        `https://cdn.jsdelivr.net/gh/Mojang/bedrock-samples@${tag}/resource_pack/`,
        `https://raw.githubusercontent.com/Mojang/bedrock-samples/${tag}/resource_pack/`,
      ],
      files,
    },
    null,
    0,
  ) + "\n",
);
console.error(`${files.length} of ${all.length} files`);
