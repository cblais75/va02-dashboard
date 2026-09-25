// Builds data/early_vote.json (daily early-vote counts by locality for VA-02)
// from Virginia's Daily Absentee List (DAL).
//
// The DAL lists individual voters. It is sold by the Virginia Department of
// Elections to qualified requesters (candidates, parties, PACs, etc.), so it is
// never downloaded by this repo and never committed:
//   1. Save each day's DAL CSV into a private folder: data/dal/ (git-ignored) by
//      default, or any folder named in the DAL_DIR environment variable. Because
//      this repo lives in OneDrive, a folder outside OneDrive (e.g. C:\DAL) keeps
//      voter files from being synced to the cloud.
//   2. Run: node scripts/early-vote.mjs   (or: npm run early-vote)
// Only per-day, per-locality counts are written out. Names, addresses, voter IDs
// and every other voter-level field are read in memory and discarded.
//
// Files: the newest CSV whose ELECTION_NAME matches the current election is used
// for 2026. For the 2022 comparison, put the 2022 November General DAL in data/dal/
// too (day-by-day pace); if there isn't one, data/early_vote_2022_final.json (hand-
// entered final early totals by locality) is used instead. File names starting with
// SAMPLE_ are fake test files, and the output is then marked as sample data.

import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAL_DIR = resolve(process.env.DAL_DIR || join(ROOT, "data", "dal"));
const OUT = join(ROOT, "data", "early_vote.json");
const FINAL_2022 = join(ROOT, "data", "early_vote_2022_final.json");

const CURRENT = { year: 2026, match: /2026 November General/i, election_day: "2026-11-03" };
const COMPARE = { year: 2022, match: /2022 November General/i, election_day: "2022-11-08" };

// VA-02 localities as named in data/va02_results.json. Chesapeake and Southampton
// are split; only their District 2 voters count.
const LOCALITIES = [
  "Virginia Beach City", "Suffolk City", "Franklin City", "Isle of Wight County",
  "Accomack County", "Northampton County", "Chesapeake City", "Southampton County",
];
const SPLIT = new Set(["Chesapeake City", "Southampton County"]);
const DISTRICT = 2;

// Column names, with alternates, matched case-insensitively. Check these against
// the first real file: the script stops and lists the header if any are missing.
const COLUMNS = {
  election: ["ELECTION_NAME"],
  locality: ["LOCALITY_NAME", "LOCALITY"],
  precinct: ["PRECINCT_NAME", "PRECINCT_CODE_VALUE", "PRECINCT"],
  congressional: ["CONGRESSIONAL", "CONGRESSIONAL_DISTRICT", "CD"],
  voterId: ["IDENTIFICATION_NUMBER", "VOTER_ID", "VOTER_IDENTIFICATION_NUMBER"],
  status: ["BALLOT_STATUS"],
  receiptDate: ["BALLOT_RECEIPT_DATE"],
};
// Ballot statuses that mean a ballot was cast. ON_MACHINE = voted early in person;
// the rest are returned by mail (MARKED, PRE_PROCESSED) or federal write-in (FWAB).
const IN_PERSON = new Set(["ON_MACHINE"]);
const MAIL = new Set(["MARKED", "PRE_PROCESSED", "FWAB"]);

const norm = (s) => String(s || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
const localityKey = new Map(LOCALITIES.map((l) => [norm(l), l]));

// Precinct fallback for split localities when the file has no district column:
// the precincts that voted in the 2024 U.S. House District 2 race.
const results = JSON.parse(readFileSync(join(ROOT, "data", "va02_results.json"), "utf8"));
const precinctNum = (p) => (String(p).match(/^\s*(\d+)/) || [])[1]?.replace(/^0+/, "") || norm(p);
const CD2_PRECINCTS = Object.fromEntries(
  Object.entries(results.geography.partial_precincts).map(([loc, list]) => [loc, new Set(list.map(precinctNum))])
);

function parseCsvLine(line) {
  const out = [];
  let field = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}
const quotesBalanced = (s) => (s.match(/"/g) || []).length % 2 === 0;

function parseDate(s) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
const daysBefore = (date, electionDay) => Math.round((Date.parse(electionDay) - Date.parse(date)) / 86400000);

function resolveColumns(header, file) {
  const upper = header.map((h) => h.trim().toUpperCase());
  const idx = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    idx[key] = names.map((n) => upper.indexOf(n)).find((i) => i >= 0) ?? -1;
  }
  const required = ["locality", "voterId", "status", "receiptDate"];
  const missing = required.filter((k) => idx[k] < 0);
  if (idx.congressional < 0 && idx.precinct < 0) missing.push("congressional or precinct");
  if (missing.length) {
    throw new Error(`${file}: missing column(s) ${missing.join(", ")}.\nHeader: ${upper.join(", ")}\nUpdate COLUMNS in scripts/early-vote.mjs.`);
  }
  return idx;
}

// Reads one DAL file and returns daily counts: { date: { locality: { in_person, mail } } }.
async function countFile(path, electionDay) {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let idx = null, pending = "", rows = 0, election = null;
  const voters = new Map(); // voter id -> { loc, date, method }; memory only
  const skipped = { status: 0, district: 0, noDate: 0 };

  for await (const raw of rl) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if (!quotesBalanced(line)) { pending = line; continue; }
    pending = "";
    const f = parseCsvLine(line.replace(/^﻿/, ""));
    if (!idx) { idx = resolveColumns(f, path); continue; }
    rows++;
    if (!election && idx.election >= 0) election = f[idx.election];

    const loc = localityKey.get(norm(f[idx.locality]));
    if (!loc) continue;
    const status = norm(f[idx.status]);
    const method = IN_PERSON.has(status) ? "in_person" : MAIL.has(status) ? "mail" : null;
    if (!method) { skipped.status++; continue; }

    if (SPLIT.has(loc)) {
      const inDistrict = idx.congressional >= 0
        ? Number((String(f[idx.congressional]).match(/\d+/) || [])[0]) === DISTRICT
        : CD2_PRECINCTS[loc].has(precinctNum(f[idx.precinct]));
      if (!inDistrict) { skipped.district++; continue; }
    }

    const date = parseDate(f[idx.receiptDate]);
    if (!date) { skipped.noDate++; continue; }
    // Count each voter once, on the earliest date a ballot was cast.
    const id = f[idx.voterId];
    const prev = voters.get(id);
    if (!prev || date < prev.date) voters.set(id, { loc, date, method });
  }

  const days = {};
  for (const { loc, date, method } of voters.values()) {
    if (date > electionDay) continue; // mail arriving after Election Day isn't early vote
    days[date] ??= {};
    days[date][loc] ??= { in_person: 0, mail: 0 };
    days[date][loc][method]++;
  }
  voters.clear();
  return { days, rows, election, ballots: [...Object.values(days)].reduce((s, d) => s + Object.values(d).reduce((a, c) => a + c.in_person + c.mail, 0), 0), skipped };
}

function toSeries(days, electionDay) {
  return Object.keys(days).sort().map((date) => ({
    date,
    days_before: daysBefore(date, electionDay),
    by_locality: Object.fromEntries(LOCALITIES.filter((l) => days[date][l]).map((l) => [l, days[date][l]])),
  }));
}

async function firstElectionName(path) {
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    const f = parseCsvLine(line.replace(/^﻿/, ""));
    if (!header) { header = f.map((h) => h.trim().toUpperCase()); continue; }
    rl.close();
    const i = header.indexOf("ELECTION_NAME");
    return i >= 0 ? f[i] : "";
  }
  return "";
}

async function pickFile(match) {
  if (!existsSync(DAL_DIR)) return null;
  const files = readdirSync(DAL_DIR).filter((f) => /\.(csv|txt)$/i.test(f))
    .map((f) => ({ f, path: join(DAL_DIR, f), mtime: statSync(join(DAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of files) if (match.test(await firstElectionName(file.path))) return file;
  return null;
}

// If the voter-file folder is inside this repo, it must be git-ignored.
function assertIgnored() {
  const rel = relative(ROOT, DAL_DIR);
  if (rel.startsWith("..") || resolve(rel) === rel) return; // outside the repo
  try {
    execFileSync("git", ["check-ignore", "-q", join(rel, "check.csv")], { cwd: ROOT });
  } catch {
    throw new Error(`${rel} is not git-ignored. Refusing to run so voter files can't be committed.`);
  }
}

async function main() {
  assertIgnored();
  const current = await pickFile(CURRENT.match);
  if (!current) throw new Error(`No ${CURRENT.year} November General DAL file found in ${DAL_DIR}.`);
  const cur = await countFile(current.path, CURRENT.election_day);

  let comparison = { year: COMPARE.year, election_day: COMPARE.election_day, basis: null };
  const prior = await pickFile(COMPARE.match);
  let sample = /^SAMPLE_/i.test(current.f);
  if (prior) {
    const cmp = await countFile(prior.path, COMPARE.election_day);
    comparison = { ...comparison, basis: "daily", days: toSeries(cmp.days, COMPARE.election_day) };
    sample ||= /^SAMPLE_/i.test(prior.f);
    console.log(`2022: ${prior.f}: ${cmp.rows} rows, ${cmp.ballots} VA-02 early ballots`);
  } else if (existsSync(FINAL_2022)) {
    const final = JSON.parse(readFileSync(FINAL_2022, "utf8"));
    comparison = { ...comparison, basis: "final_totals", final: final.by_locality, source: final.source || null };
  }

  const data = {
    sample,
    election_day: CURRENT.election_day,
    source: sample
      ? "Sample data generated in the format of the Virginia Department of Elections Daily Absentee List"
      : "Virginia Department of Elections, Daily Absentee List",
    source_url: "https://www.elections.virginia.gov/candidatepac-info/client-services/",
    counted: "Early in-person ballots (ON_MACHINE) and returned mail ballots (MARKED, PRE_PROCESSED, FWAB), one per voter, by ballot receipt date. Chesapeake and Southampton: District 2 voters only.",
    localities: LOCALITIES,
    days: toSeries(cur.days, CURRENT.election_day),
    comparison,
  };

  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  if (previous) {
    const { updated_at, ...prev } = previous;
    if (JSON.stringify(prev) === JSON.stringify(data)) {
      console.log("No changes. Left data/early_vote.json as is.");
      return;
    }
  }
  writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), ...data }, null, 2) + "\n");
  console.log(`2026: ${current.f}: ${cur.rows} rows, ${cur.ballots} VA-02 early ballots (skipped: ${JSON.stringify(cur.skipped)})`);
  console.log(`Wrote data/early_vote.json${sample ? " (SAMPLE DATA)" : ""}; 2022 comparison: ${comparison.basis || "none"}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
