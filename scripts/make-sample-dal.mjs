// Writes FAKE Daily Absentee List files for testing scripts/early-vote.mjs.
// Every name, address and voter ID is made up. File names start with SAMPLE_,
// which makes early-vote.mjs mark its output as sample data.
//
// Run: node scripts/make-sample-dal.mjs [folder]   (default: DAL_DIR or data/dal)
// The files are ~50 MB, so pick a folder outside OneDrive, e.g. your temp folder.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(process.argv[2] || process.env.DAL_DIR || join(ROOT, "data", "dal"));
const TODAY_2026 = "2026-09-25";

// Column layout reconstructed from the fields ELECT lists for the DAL.
const HEADER = [
  "ELECTION_NAME", "ELECTION_DATE", "LOCALITY_CODE", "LOCALITY_NAME", "PRECINCT_CODE_VALUE", "PRECINCT_NAME",
  "LAST_NAME", "FIRST_NAME", "MIDDLE_NAME", "SUFFIX",
  "ADDRESS_LINE_1", "ADDRESS_LINE_2", "CITY", "STATE", "ZIP",
  "MAILING_ADDRESS_LINE_1", "MAILING_ADDRESS_LINE_2", "MAILING_CITY", "MAILING_STATE", "MAILING_ZIP",
  "IDENTIFICATION_NUMBER", "CONGRESSIONAL", "STATE_SENATE", "STATE_HOUSE",
  "VOTER_TYPE", "ONGOING", "APP_RECIEPT_DATE", "APP_STATUS", "BALLOT_STATUS", "BALLOT_STATUS_REASON", "BALLOT_RECEIPT_DATE",
];

// Seeded random numbers so the sample is identical on every run.
let seed = 20260925;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rand() * a.length)];

function precinctsFrom(file, locality) {
  const rows = readFileSync(join(ROOT, "data", "raw", file), "utf8").split(/\r?\n/);
  let inLoc = false;
  const out = [];
  for (const r of rows) {
    if (r.startsWith("Locality,")) inLoc = r.split(",")[1] === locality;
    else if (inLoc && r.startsWith("Precinct,") && !/provisional/i.test(r)) out.push(r.split(",")[1]);
  }
  return out;
}
const CD2 = "2024_general_us_house_cd02_contest161258.csv";

// [locality, code, CD, precinct list, 2022 early ballots]. VA-02 volumes are ~36% of
// each locality's 2022 House vote; the rest are decoys the tracker must skip.
const GROUPS = [
  ["Virginia Beach City", "810", 2, precinctsFrom(CD2, "Virginia Beach City"), 58600],
  ["Suffolk City", "800", 2, precinctsFrom(CD2, "Suffolk City"), 13200],
  ["Franklin City", "620", 2, precinctsFrom(CD2, "Franklin City"), 1050],
  ["Isle of Wight County", "093", 2, precinctsFrom(CD2, "Isle of Wight County"), 6700],
  ["Accomack County", "001", 2, precinctsFrom(CD2, "Accomack County"), 4750],
  ["Northampton County", "131", 2, precinctsFrom(CD2, "Northampton County"), 1950],
  ["Chesapeake City", "550", 2, precinctsFrom(CD2, "Chesapeake City"), 19000],
  ["Southampton County", "175", 2, precinctsFrom(CD2, "Southampton County"), 1650],
  // Decoys: the other parts of the split localities, and neighbors outside VA-02.
  ["Chesapeake City", "550", 3, precinctsFrom("2024_general_us_house_cd03_contest161347.csv", "Chesapeake City"), 13000],
  ["Southampton County", "175", 4, precinctsFrom("2024_general_us_house_cd04_contest161321.csv", "Southampton County"), 1300],
  ["Norfolk City", "710", 3, ["101 - Sample Precinct A", "102 - Sample Precinct B"], 9000],
  ["Hampton City", "650", 3, ["101 - Sample Precinct C"], 5000],
];

const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 86400000).toISOString().slice(0, 10);
const mdY = (ymd) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;
const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Relative daily weights by days before Election Day: a first-day bump, a rise
// into the final week, quiet Sundays, and early voting ending the Saturday before.
function weights(electionDay, start) {
  const out = [];
  for (let d = start; d >= 0; d--) {
    const date = addDays(electionDay, -d);
    const sunday = new Date(date).getUTCDay() === 0;
    const inPerson = d < 3 ? 0 : (1 + 5 * Math.exp(-(d - 3) / 7)) * (d === start ? 2.5 : 1) * (sunday ? 0.15 : 1);
    const mail = d > 40 ? 0 : 1 + 1.5 * Math.exp(-d / 10);
    out.push({ date, inPerson, mail });
  }
  return out;
}
function draw(ws, key) {
  const total = ws.reduce((s, w) => s + w[key], 0);
  let r = rand() * total;
  for (const w of ws) if ((r -= w[key]) <= 0) return w.date;
  return ws[ws.length - 1].date;
}

function makeFile({ year, electionName, electionDay, start, scale, through }) {
  const ws = weights(electionDay, start);
  const lines = [HEADER.join(",")];
  let n = 0;
  const row = (g, status, date, reason = "", sameVoterAs = null) => {
    n++;
    const [loc, code, cd, precincts] = g;
    const precinct = pick(precincts);
    const id = sameVoterAs || String(900000000 + n + year * 10);
    const addr = `${100 + (n % 9000)} Sample St, Apt ${1 + (n % 40)}`; // comma inside quotes
    lines.push([
      electionName, mdY(electionDay), code, loc.toUpperCase(), precinct.split(" - ")[0], precinct.toUpperCase(),
      `TESTVOTER${n}`, pick(["ALEX", "SAM", "JORDAN", "TAYLOR", "CASEY"]), "", "",
      addr, "", "SAMPLEVILLE", "VA", "23000",
      "", "", "", "", "",
      id, String(cd).padStart(3, "0"), "007", "084",
      pick(["", "", "", "MILITARY", "TEMPORARY"]), pick(["N", "N", "Y"]), date ? mdY(addDays(date, -10)) : "", "Approved", status, reason, date ? mdY(date) : "",
    ].map(csv).join(","));
    return id;
  };

  for (const g of GROUPS) {
    const count = Math.round(g[4] * scale);
    for (let i = 0; i < count; i++) {
      const inPerson = rand() < 0.6;
      const date = draw(ws, inPerson ? "inPerson" : "mail");
      if (date > through) {
        // Not cast yet as of the file date: the application exists, the ballot is out.
        if (!inPerson) row(g, "Issued", "");
        continue;
      }
      const id = row(g, inPerson ? "On Machine" : pick(["Marked", "Marked", "Pre-Processed"]), date);
      // Some voters appear twice: a replaced ballot, or a mail ballot that was also
      // recorded again a few days later. Each voter must be counted once.
      if (rand() < 0.01) row(g, "Deleted", "", "REISSUED", id);
      if (rand() < 0.005) row(g, "Marked", addDays(date, 3) <= through ? addDays(date, 3) : date, "", id);
    }
    // Rows that are not cast ballots.
    for (let i = 0; i < count * 0.08; i++) row(g, pick(["Issued", "Not Issued", "Provisional"]), "");
  }
  // Mail ballots arriving after Election Day (counted in results, not as early vote).
  if (through > electionDay) for (let i = 0; i < 300; i++) row(GROUPS[0], "Marked", addDays(electionDay, 1 + (i % 3)));

  const file = join(OUT_DIR, `SAMPLE_${year}_November_General_DAL.csv`);
  writeFileSync(file, lines.join("\r\n") + "\r\n");
  console.log(`Wrote ${file} (${lines.length - 1} fake rows)`);
}

mkdirSync(OUT_DIR, { recursive: true });
makeFile({ year: 2022, electionName: "2022 November General", electionDay: "2022-11-08", start: 46, scale: 1, through: "2022-11-14" });
// 2026: a bit ahead of 2022's pace, through today.
makeFile({ year: 2026, electionName: "2026 November General", electionDay: "2026-11-03", start: 46, scale: 1.08, through: TODAY_2026 });
