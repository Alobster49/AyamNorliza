/**
 * Generates src/lib/malaysia-postcodes.json from the
 * `malaysia-postcodes` npm dataset. Output is a compact lookup:
 *   { states: string[], postcodes: { "80000": ["Johor Bahru", 0], ... } }
 * A postcode listed under several cities keeps the first occurrence.
 * Run: node scripts/generate-malaysia-postcodes.mjs
 */
import { writeFileSync } from "node:fs";
import { allPostcodes } from "malaysia-postcodes";

if (!Array.isArray(allPostcodes) || allPostcodes.length === 0) {
  throw new Error("Unexpected malaysia-postcodes dataset shape: allPostcodes is not a non-empty array");
}

const states = [];
const postcodes = {};

for (const stateEntry of allPostcodes) {
  if (typeof stateEntry?.name !== "string" || !Array.isArray(stateEntry?.city)) {
    throw new Error(`Unexpected state entry shape: ${JSON.stringify(stateEntry).slice(0, 200)}`);
  }
  const stateIndex = states.push(stateEntry.name) - 1;
  for (const city of stateEntry.city) {
    if (typeof city?.name !== "string" || !Array.isArray(city?.postcode)) {
      throw new Error(`Unexpected city entry shape in ${stateEntry.name}`);
    }
    for (const pc of city.postcode) {
      if (!/^[0-9]{5}$/.test(pc)) continue;
      if (!(pc in postcodes)) postcodes[pc] = [city.name, stateIndex];
    }
  }
}

const out = { states, postcodes };
const count = Object.keys(postcodes).length;
if (count < 2000) {
  throw new Error(`Suspiciously few postcodes generated: ${count}`);
}
writeFileSync(
  new URL("../src/lib/malaysia-postcodes.json", import.meta.url),
  JSON.stringify(out),
);
console.log(`Wrote ${count} postcodes across ${states.length} states.`);
