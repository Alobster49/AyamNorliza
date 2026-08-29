// One-off generator for the bundled avatar preset faces.
//
//   node scripts/generate-avatar-presets.mjs
//
// Writes 64 Open Peeps SVGs (CC0, via DiceBear) to public/avatars/presets/
// and prints the id list that src/lib/avatar/presets.ts must mirror.
// Presets are committed; this script only runs when the set changes.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAvatar } from "@dicebear/core";
import { openPeeps } from "@dicebear/collection";

const COUNT = 64;
const outDir = path.join(process.cwd(), "public", "avatars", "presets");
await mkdir(outDir, { recursive: true });

const ids = [];
for (let i = 1; i <= COUNT; i++) {
  const id = `face-${String(i).padStart(2, "0")}`;
  const svg = createAvatar(openPeeps, {
    seed: `ayam-norliza-${id}`,
    size: 128,
  }).toString();
  await writeFile(path.join(outDir, `${id}.svg`), svg, "utf8");
  ids.push(id);
}

console.log(`wrote ${ids.length} presets to ${outDir}`);
console.log(JSON.stringify(ids));
