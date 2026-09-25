// Builds data/va02_results.json from the raw precinct CSVs in data/raw/.
// Source: Virginia Department of Elections historical database
// (historical.elections.virginia.gov), per-contest "Results CSV" downloads.
//
// Run: node scripts/build-va02-results.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data", "raw");
const OUT = join(ROOT, "data", "va02_results.json");

const FULL_LOCALITIES = [
  "Virginia Beach City",
  "Suffolk City",
  "Franklin City",
  "Isle of Wight County",
  "Accomack County",
  "Northampton County",
];
const PARTIAL_LOCALITIES = ["Chesapeake City", "Southampton County"];

// Where the rest of each partial locality votes for U.S. House.
const OTHER_HOUSE_FILES = {
  2022: { "Chesapeake City": "2022_general_us_house_cd03_contest156722.csv", "Southampton County": "2022_general_us_house_cd04_contest156380.csv" },
  2024: { "Chesapeake City": "2024_general_us_house_cd03_contest161347.csv", "Southampton County": "2024_general_us_house_cd04_contest161321.csv" },
};
const CD2_HOUSE_FILES = {
  2022: "2022_general_us_house_cd02_contest156315.csv",
  2024: "2024_general_us_house_cd02_contest161258.csv",
};

// Known labeling errors in the source files.
const LOCALITY_FIXES = {
  // The 2022 CD2 file labels Franklin city as "Franklin County" (Franklin County is in CD5).
  "2022_general_us_house_cd02_contest156315.csv": { "Franklin County": "Franklin City" },
};
const MISFILED_PRECINCTS = {
  // Prince William County precinct filed under Suffolk City; the Suffolk locality total excludes it.
  "Suffolk City": ["316 - Potomac Shores"],
};

const RACES = [
  { id: "2022-us-house-cd02", year: 2022, office: "U.S. House", district: 2, contest_id: 156315, file: CD2_HOUSE_FILES[2022], scope: "district" },
  { id: "2024-president", year: 2024, office: "President", district: null, contest_id: 161256, file: "2024_general_president_contest161256.csv", scope: "statewide", shareYear: 2024 },
  { id: "2024-us-house-cd02", year: 2024, office: "U.S. House", district: 2, contest_id: 161258, file: CD2_HOUSE_FILES[2024], scope: "district" },
  { id: "2025-governor", year: 2025, office: "Governor", district: null, contest_id: 164996, file: "2025_general_governor_contest164996.csv", scope: "statewide", shareYear: 2024 },
];

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ""));
}

// Returns { candidates, districtRow, localities: { name: { totals, precincts: { name: counts } } } }
// where counts is { votes: {candidate: n}, write_ins, total }.
function loadContest(file) {
  const rows = parseCsv(readFileSync(join(RAW, file), "utf8").replace(/^﻿/, ""));
  const [names, parties] = rows;
  const writeIdx = names.indexOf("Write-Ins");
  const totalIdx = names.indexOf("Total Votes Cast");
  const candidates = [];
  for (let i = 2; i < writeIdx; i++) candidates.push({ name: names[i], party: parties[i] || null });
  const fixes = LOCALITY_FIXES[file] || {};

  const toCounts = (r) => ({
    votes: Object.fromEntries(candidates.map((c, j) => [c.name, Number(r[j + 2] || 0)])),
    write_ins: Number(r[writeIdx] || 0),
    total: Number(r[totalIdx] || 0),
  });

  const localities = {};
  let districtRow = null, current = null;
  for (const r of rows.slice(2)) {
    if (r[0] === "Congressional District" || r[0] === "State") districtRow = toCounts(r);
    else if (r[0] === "Locality") {
      const name = fixes[r[1]] || r[1];
      current = localities[name] = { totals: toCounts(r), precincts: {} };
    } else if (r[0] === "Precinct" && current) current.precincts[r[1]] = toCounts(r);
  }
  return { candidates, districtRow, localities };
}

const isProvisional = (p) => /provisional/i.test(p);
const isCentralAbsentee = (p) => /central absentee/i.test(p);

const emptyCounts = (candidates) => ({
  votes: Object.fromEntries(candidates.map((c) => [c.name, 0])),
  write_ins: 0,
  total: 0,
});
function addInto(acc, c, factor = 1) {
  for (const k of Object.keys(acc.votes)) acc.votes[k] += (c.votes[k] || 0) * factor;
  acc.write_ins += c.write_ins * factor;
  acc.total += c.total * factor;
}
// Round each part; total is the sum of the rounded parts so rows always add up.
function roundCounts(c) {
  const votes = Object.fromEntries(Object.entries(c.votes).map(([k, v]) => [k, Math.round(v)]));
  const write_ins = Math.round(c.write_ins);
  const total = Object.values(votes).reduce((a, b) => a + b, 0) + write_ins;
  return { votes, write_ins, total };
}
function sumCounts(list, candidates) {
  const acc = emptyCounts(candidates);
  for (const c of list) addInto(acc, c);
  return acc;
}

// District 2 geography for partial localities, from the 2024 CD2 House race.
const cd2House2024 = loadContest(CD2_HOUSE_FILES[2024]);
const cd2Precincts = Object.fromEntries(
  PARTIAL_LOCALITIES.map((loc) => [
    loc,
    Object.keys(cd2House2024.localities[loc].precincts).filter((p) => !isProvisional(p) && !isCentralAbsentee(p)),
  ])
);

// CD2 share of a precinct or locality-wide row, from U.S. House votes that year.
function houseShares(year) {
  const cd2 = loadContest(CD2_HOUSE_FILES[year]);
  const out = {};
  for (const loc of PARTIAL_LOCALITIES) {
    const other = loadContest(OTHER_HOUSE_FILES[year][loc]);
    const a = cd2.localities[loc].precincts;
    const b = other.localities[loc].precincts;
    const split = {};
    for (const p of Object.keys(a)) {
      if (b[p] && !isProvisional(p)) split[p] = { cd2: a[p].total, other: b[p].total, share: a[p].total / (a[p].total + b[p].total) };
    }
    const sumRows = (rows, test) => Object.entries(rows).filter(([p]) => test(p)).reduce((s, [, c]) => s + c.total, 0);
    const provA = sumRows(a, isProvisional), provB = sumRows(b, isProvisional);
    const absA = sumRows(a, isCentralAbsentee), absB = sumRows(b, isCentralAbsentee);
    out[loc] = {
      split_precincts: split,
      provisional: provA + provB ? { cd2: provA, other: provB, share: provA / (provA + provB) } : null,
      central_absentee: absA + absB ? { cd2: absA, other: absB, share: absA / (absA + absB) } : null,
    };
  }
  return out;
}

function buildDistrictRace(race, contest) {
  const localities = [];
  for (const loc of [...FULL_LOCALITIES, ...PARTIAL_LOCALITIES]) {
    const l = contest.localities[loc];
    if (!l) throw new Error(`${race.id}: missing locality ${loc}`);
    localities.push({
      locality: loc,
      coverage: FULL_LOCALITIES.includes(loc) ? "full" : "partial",
      ...l.totals,
      estimated: false,
    });
  }
  const extra = Object.keys(contest.localities).filter((l) => !localities.some((x) => x.locality === l));
  if (extra.length) throw new Error(`${race.id}: unexpected localities ${extra}`);
  return { localities, notes: ["Every vote in this contest is cast inside VA-02, so no filtering or estimates are needed."] };
}

function buildStatewideRace(race, contest, shares) {
  const localities = [];
  const notes = [];
  for (const loc of FULL_LOCALITIES) {
    const l = contest.localities[loc];
    const misfiled = (MISFILED_PRECINCTS[loc] || []).filter((p) => l.precincts[p]);
    if (misfiled.length) notes.push(`${loc}: precinct(s) ${misfiled.join(", ")} are filed under ${loc} in the source but belong to another locality; the locality total row (used here) already excludes them.`);
    localities.push({ locality: loc, coverage: "full", ...l.totals, estimated: false });
  }

  for (const loc of PARTIAL_LOCALITIES) {
    const l = contest.localities[loc];
    const s = shares[loc];
    const reportedParts = [], estimated = emptyCounts(contest.candidates), estimateNotes = [];
    const included = [];
    for (const p of cd2Precincts[loc]) {
      const c = l.precincts[p];
      if (!c) throw new Error(`${race.id}: ${loc} precinct ${p} not found`);
      const split = s.split_precincts[p];
      if (split) {
        addInto(estimated, c, split.share);
        estimateNotes.push(`${p} is split between CD2 and another district; counted ${(split.share * 100).toFixed(1)}% of its votes (CD2 share of its ${race.shareYear} U.S. House votes: ${split.cd2} of ${split.cd2 + split.other}).`);
        included.push({ precinct: p, share: round4(split.share), estimated: true });
      } else {
        reportedParts.push(c);
        included.push({ precinct: p, share: 1, estimated: false });
      }
    }
    for (const [p, c] of Object.entries(l.precincts)) {
      const rule = isProvisional(p) ? s.provisional : isCentralAbsentee(p) ? s.central_absentee : null;
      if (!isProvisional(p) && !isCentralAbsentee(p)) continue;
      if (!rule) throw new Error(`${race.id}: ${loc} has locality-wide row "${p}" but no ${race.shareYear} House share to apportion it`);
      addInto(estimated, c, rule.share);
      estimateNotes.push(`Locality-wide row "${p}" is not assigned to precincts; counted ${(rule.share * 100).toFixed(1)}% of it (CD2 share of ${loc}'s matching ${race.shareYear} U.S. House row: ${rule.cd2} of ${rule.cd2 + rule.other}).`);
      included.push({ precinct: p, share: round4(rule.share), estimated: true });
    }
    const reported = sumCounts(reportedParts, contest.candidates);
    const est = roundCounts(estimated);
    const total = roundCounts(sumCounts([reported, est], contest.candidates));
    localities.push({
      locality: loc,
      coverage: "partial",
      ...total,
      estimated: est.total > 0,
      reported_portion: reported,
      estimated_portion: est.total > 0 ? est : null,
      estimate_notes: estimateNotes,
      precincts: included,
    });
  }
  notes.push("Chesapeake and Southampton include only precincts that voted in the 2024 U.S. House District 2 race.");
  notes.push("Since 2024, Virginia reports absentee and early votes inside each precinct, so no central-absentee estimate was needed for this race.");
  return { localities, notes };
}

const round4 = (x) => Math.round(x * 10000) / 10000;

const shareCache = {};
const races = RACES.map((race) => {
  const contest = loadContest(race.file);
  const built = race.scope === "district"
    ? buildDistrictRace(race, contest)
    : buildStatewideRace(race, contest, (shareCache[race.shareYear] ||= houseShares(race.shareYear)));

  const district = roundCounts(sumCounts(built.localities, contest.candidates));
  const estimatedVotes = built.localities.reduce((s, l) => s + (l.estimated_portion?.total || 0), 0);

  if (race.scope === "district") {
    const official = contest.districtRow;
    if (official.total !== district.total) throw new Error(`${race.id}: locality sum ${district.total} != official district total ${official.total}`);
  }

  return {
    id: race.id,
    year: race.year,
    office: race.office,
    district: race.district,
    contest_id: race.contest_id,
    source_file: `data/raw/${race.file}`,
    candidates: contest.candidates,
    district_total: { ...district, estimated: estimatedVotes > 0, estimated_votes: estimatedVotes },
    localities: built.localities,
    notes: built.notes,
  };
});

const output = {
  district: "VA-02",
  generated_at: new Date().toISOString(),
  source: "Virginia Department of Elections, Historical Elections Database (https://historical.elections.virginia.gov/), per-contest Results CSV",
  geography: {
    full_localities: FULL_LOCALITIES,
    partial_localities: PARTIAL_LOCALITIES,
    partial_rule: "Only precincts that voted in the 2024 U.S. House District 2 race.",
    partial_precincts: cd2Precincts,
  },
  estimate_method:
    "Where a precinct is split between districts, or votes are reported on a locality-wide row (provisional or central absentee), CD2's portion is estimated using CD2's share of that same row in the U.S. House races (2022 House for 2022; 2024 House for 2024 and 2025). Estimated values are flagged with estimated: true and broken out in estimated_portion.",
  data_corrections: [
    "2022 U.S. House CD2 file labels Franklin city as \"Franklin County\"; relabeled to Franklin City. That file has no precinct detail for Franklin city, so its locality total is used.",
    "2024 President and 2025 Governor files list Prince William precinct \"316 - Potomac Shores\" under Suffolk City; Suffolk's locality total (used here) excludes it.",
  ],
  races,
};

writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${OUT}`);
