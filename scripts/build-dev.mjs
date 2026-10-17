// A build for the game's dev server, for testers: dist/dev/, the extension
// folder without its tests, pointed at dev.warera.io and its API
// (apidev.warera.io). Load it unpacked beside the store build; the two never
// share storage (different extension ids) and the store manifest is not
// touched. Every substitution must match exactly once, so a moved constant
// fails the build instead of shipping a half-pointed copy.
//
//   npm run build:dev
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
  copyFile,
} from "node:fs/promises";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "extension");
const out = resolve(root, "dist", "dev");

const LIVE_PAGE = "https://app.warera.io/";
const DEV_PAGE = "https://dev.warera.io/";
const LIVE_API = "https://api2.warera.io/trpc/";
const DEV_API = "https://apidev.warera.io/trpc/";

/** Every file under `dir` but the tests and dotfiles, relative to the extension folder. */
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (!/\.test\.mjs$/.test(entry.name))
      files.push(relative(extension, path).replaceAll("\\", "/"));
  }
  return files;
}

/** `text` with `from` replaced by `to`, which must occur exactly once in `file`. */
function once(text, from, to, file) {
  const n = text.split(from).length - 1;
  assert.equal(n, 1, `${file}: expected "${from}" once, found ${n}`);
  return text.replace(from, to);
}

await rm(out, { recursive: true, force: true });
const files = await walk(extension);
for (const f of files) {
  await mkdir(dirname(resolve(out, f)), { recursive: true });
  await copyFile(resolve(extension, f), resolve(out, f));
}

const manifest = JSON.parse(
  await readFile(resolve(extension, "manifest.json"), "utf8"),
);
assert.deepEqual(manifest.host_permissions, ["https://api2.warera.io/*"]);
manifest.name = `${manifest.name} DEV`;
manifest.description =
  "WarEra Plus for the game's dev server (dev.warera.io). Testers only.";
manifest.host_permissions = ["https://apidev.warera.io/*"];
for (const group of [
  ...manifest.content_scripts,
  ...manifest.web_accessible_resources,
]) {
  assert.deepEqual(group.matches, [`${LIVE_PAGE}*`]);
  group.matches = [`${DEV_PAGE}*`];
}
await writeFile(
  resolve(out, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const api = resolve(out, "lib/api.mjs");
await writeFile(
  api,
  once(await readFile(api, "utf8"), LIVE_API, DEV_API, "lib/api.mjs"),
);
const worker = resolve(out, "background.js");
await writeFile(
  worker,
  once(await readFile(worker, "utf8"), LIVE_PAGE, DEV_PAGE, "background.js"),
);

const sha = createHash("sha256")
  .update(await readFile(resolve(out, "manifest.json")))
  .digest("hex")
  .slice(0, 16);
console.log(
  `${relative(root, out)}: ${files.length} files for dev.warera.io / apidev.warera.io (manifest ${sha}). Load it unpacked from chrome://extensions.`,
);
