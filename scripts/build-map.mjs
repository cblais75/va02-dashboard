// Builds data/va02_map.json: SVG shapes for the 8 VA-02 localities.
// Source: Census 2024 cartographic boundary files (counties and 119th Congress
// districts, 1:500k). Chesapeake and Southampton are trimmed to the part inside
// Congressional District 2; the other six localities lie entirely inside it.
//
// Run: node scripts/build-map.mjs   (or: npm run map)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mapshaper from "mapshaper";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "data", "cache");
const OUT = join(ROOT, "data", "va02_map.json");
const BASE = "https://www2.census.gov/geo/tiger/GENZ2024/shp";
const FILES = { counties: "cb_2024_us_county_500k.zip", cd: "cb_2024_us_cd119_500k.zip" };

// County GEOID -> locality name used in data/va02_results.json.
const LOCALITIES = {
  51810: "Virginia Beach City",
  51800: "Suffolk City",
  51620: "Franklin City",
  51093: "Isle of Wight County",
  51001: "Accomack County",
  51131: "Northampton County",
  51550: "Chesapeake City",
  51175: "Southampton County",
};
const PARTIAL = ["51550", "51175"];
const CD_GEOID = "5102";
const WIDTH = 1000; // SVG viewBox width; height follows the shape's aspect ratio

async function download(name) {
  const path = join(CACHE, name);
  if (existsSync(path)) return path;
  console.log(`Downloading ${name}...`);
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

function ringsToPath(geometry, x, y) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polys
    .flatMap((rings) => rings.map((ring) => "M" + ring.slice(0, -1).map(([a, b]) => `${x(a)},${y(b)}`).join("L") + "Z"))
    .join("");
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const counties = await download(FILES.counties);
  const cd = await download(FILES.cd);
  const tmp = join(CACHE, "va02_projected.json");

  const ids = Object.keys(LOCALITIES).map((id) => `'${id}'`).join(",");
  const partial = PARTIAL.map((id) => `GEOID=='${id}'`).join("||");
  await mapshaper.runCommands([
    `-i combine-files "${counties}" "${cd}"`,
    `-rename-layers counties,cd`,
    `-filter target=cd "GEOID=='${CD_GEOID}'"`,
    `-filter target=counties "[${ids}].indexOf(GEOID) > -1"`,
    `-filter target=counties "${partial}" + name=partial`,
    `-clip target=partial source=cd`,
    `-filter target=counties "!(${partial})"`,
    `-merge-layers target=counties,partial name=va02 force`,
    // Lambert conformal conic centered on Hampton Roads.
    `-proj target=va02 "+proj=lcc +lat_1=36.5 +lat_2=38 +lat_0=37 +lon_0=-76.5 +datum=NAD83 +units=m"`,
    `-simplify target=va02 35% keep-shapes`,
    `-filter-islands target=va02 min-area=200000`,
    `-each target=va02 "lx=this.innerX, ly=this.innerY"`,
    `-filter-fields target=va02 GEOID,lx,ly`,
    `-o target=va02 "${tmp}" format=geojson precision=1 force`,
  ].join(" "));

  const geo = JSON.parse(readFileSync(tmp, "utf8"));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of geo.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const [a, b] of polys.flat(2)) {
      minX = Math.min(minX, a); maxX = Math.max(maxX, a);
      minY = Math.min(minY, b); maxY = Math.max(maxY, b);
    }
  }
  const k = WIDTH / (maxX - minX);
  const height = Math.ceil((maxY - minY) * k);
  const x = (a) => Math.round((a - minX) * k * 10) / 10;
  const y = (b) => Math.round((maxY - b) * k * 10) / 10;

  const localities = geo.features
    .map((f) => ({
      geoid: f.properties.GEOID,
      locality: LOCALITIES[f.properties.GEOID],
      partial: PARTIAL.includes(f.properties.GEOID),
      label: [x(f.properties.lx), y(f.properties.ly)],
      d: ringsToPath(f.geometry, x, y),
    }))
    .sort((a, b) => a.locality.localeCompare(b.locality));

  const missing = Object.values(LOCALITIES).filter((n) => !localities.some((l) => l.locality === n));
  if (missing.length) throw new Error(`Missing shapes: ${missing.join(", ")}`);

  const out = {
    source: "U.S. Census Bureau, 2024 cartographic boundary files (counties; 119th Congress districts), 1:500,000",
    note: "Chesapeake and Southampton are clipped to Congressional District 2.",
    viewBox: `0 0 ${WIDTH} ${height}`,
    localities,
  };
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`Wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
