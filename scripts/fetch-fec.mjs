// Pulls 2026 campaign finance data for the VA-02 race from the FEC API and
// writes data/fec.json. The file is only rewritten when the data changed.
//
// Needs an FEC API key in the FEC_API_KEY environment variable (never in code).
// Locally, put FEC_API_KEY=... in .env (git-ignored). In GitHub Actions it comes
// from the FEC_API_KEY repository secret.
//
// Run: node scripts/fetch-fec.mjs   (or: npm run fec)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "fec.json");
const API = "https://api.open.fec.gov/v1";
const CYCLE = 2026;
const CYCLE_START = "2025-01-01";
const MAX_48H_NOTICES = 40;

const CANDIDATES = [
  { id: "kiggans", candidate_id: "H2VA02064" },
  { id: "luria", candidate_id: "H6VA02198" },
];

const REPORT_TYPES = {
  Q1: "April Quarterly", Q2: "July Quarterly", Q3: "October Quarterly", YE: "Year-End",
  "12P": "Pre-Primary", "12G": "Pre-General", "30G": "Post-General",
  "12R": "Pre-Runoff", "30R": "Post-Runoff", "12S": "Pre-Special", "30S": "Post-Special",
  "12C": "Pre-Convention", TER: "Termination",
};

function loadKey() {
  if (!process.env.FEC_API_KEY && existsSync(join(ROOT, ".env"))) {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*FEC_API_KEY\s*=\s*(.*?)\s*$/);
      if (m) process.env.FEC_API_KEY = m[1].replace(/^["']|["']$/g, "");
    }
  }
  const key = process.env.FEC_API_KEY;
  if (!key) {
    console.error("FEC_API_KEY is not set. Add it to .env locally or as a GitHub repository secret.");
    process.exit(1);
  }
  return key;
}
const KEY = loadKey();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function getJson(url, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "va02-dashboard (github.com/cblais75/va02-dashboard)" } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt ** 2);
      continue;
    }
    throw new Error(`${label}: HTTP ${res.status}`);
  }
}

// FEC API call. The key is added here and never logged.
function fec(path, params = {}) {
  const qs = new URLSearchParams({ ...params, api_key: KEY });
  calls++;
  return getJson(`${API}${path}?${qs}`, path);
}

async function fecAll(path, params, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const d = await fec(path, { ...params, page, per_page: 100 });
    out.push(...d.results);
    if (page >= (d.pagination?.pages || 1)) break;
  }
  return out;
}

const day = (s) => (s ? String(s).slice(0, 10) : null);
const round2 = (n) => Math.round(n * 100) / 100;
const filingUrl = (committeeId, fileNumber) => `https://docquery.fec.gov/cgi-bin/forms/${committeeId}/${fileNumber}/`;

// Keep one filing per coverage period: the most recently received (amendments replace originals).
function latestPerPeriod(reports) {
  const byEnd = new Map();
  for (const r of reports) {
    const end = day(r.coverage_end_date);
    const prev = byEnd.get(end);
    if (!prev || day(r.receipt_date) > day(prev.receipt_date) ||
        (day(r.receipt_date) === day(prev.receipt_date) && r.file_number > prev.file_number)) byEnd.set(end, r);
  }
  return [...byEnd.values()].sort((a, b) => day(b.coverage_end_date).localeCompare(day(a.coverage_end_date)));
}

async function candidateFinance(c) {
  const info = (await fec(`/candidate/${c.candidate_id}/`)).results[0];
  const committee = (await fec(`/candidate/${c.candidate_id}/committees/`, { designation: "P", cycle: CYCLE })).results[0];
  const totals = (await fec(`/candidate/${c.candidate_id}/totals/`, { cycle: CYCLE, election_full: true })).results[0] || {};

  // Raw e-filed reports show up before the FEC finishes processing them.
  const efiled = latestPerPeriod(
    (await fec("/efile/reports/house-senate/", { committee_id: committee.committee_id, min_receipt_date: CYCLE_START, sort: "-receipt_date", per_page: 100 })).results
  );

  const processedThrough = day(totals.coverage_end_date);
  const newer = efiled.filter((r) => !processedThrough || day(r.coverage_end_date) > processedThrough);
  let raised = totals.receipts || 0;
  let spent = totals.disbursements || 0;
  let cash = totals.last_cash_on_hand_end_period ?? null;
  let through = processedThrough;
  let basis = "FEC processed totals";
  if (newer.length) {
    raised += newer.reduce((s, r) => s + (r.total_receipts_period || 0), 0);
    spent += newer.reduce((s, r) => s + (r.total_disbursements_period || 0), 0);
    cash = Number(newer[0].cash_on_hand_end_period);
    through = day(newer[0].coverage_end_date);
    basis = `FEC processed totals plus ${newer.length} newer e-filed report${newer.length > 1 ? "s" : ""}`;
  }

  const latest = efiled[0];
  const latestReport = latest
    ? {
        type: latest.report_type,
        name: REPORT_TYPES[latest.report_type] || latest.report_type,
        coverage_start: day(latest.coverage_start_date),
        coverage_end: day(latest.coverage_end_date),
        filed: day(latest.receipt_date),
        url: filingUrl(committee.committee_id, latest.file_number),
      }
    : totals.coverage_end_date
      ? { type: null, name: totals.last_report_type_full, coverage_start: null, coverage_end: processedThrough, filed: null, url: null }
      : null;

  return {
    id: c.id,
    candidate_id: c.candidate_id,
    name: info.name,
    party: info.party,
    incumbent_challenge: info.incumbent_challenge_full,
    committee: { id: committee.committee_id, name: committee.name },
    totals: {
      raised: round2(raised),
      spent: round2(spent),
      cash_on_hand: cash == null ? null : round2(cash),
      through,
      basis,
    },
    latest_report: latestReport,
    fec_url: `https://www.fec.gov/data/candidate/${c.candidate_id}/?cycle=${CYCLE}`,
  };
}

// Parse the F65 (contribution) lines of a raw Form 6 .fec file.
// Layout (FEC format 8.x): 3 entity type, 4 org name, 5 last, 6 first, 7 middle,
// 12 city, 13 state, 16 date (YYYYMMDD), 17 amount, 18 employer, 19 occupation.
function parseForm6(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.split("\x1c");
    if (!/^F65/.test(f[0])) continue;
    const date = f[16], amount = Number(f[17]);
    if (!/^\d{8}$/.test(date || "") || !Number.isFinite(amount)) {
      throw new Error(`Unexpected F65 layout: ${f.slice(0, 3).join("|")}`);
    }
    const person = [f[6], f[7], f[5]].filter(Boolean).join(" ");
    rows.push({
      contributor: (f[4] || person).trim(),
      entity_type: f[3] || null,
      city: f[12] || null,
      state: f[13] || null,
      employer: f[18] || null,
      occupation: f[19] || null,
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      amount: round2(amount),
    });
  }
  return rows;
}

async function fortyEightHourReports(cand) {
  const filings = await fecAll("/efile/filings/", {
    committee_id: cand.committee.id, min_receipt_date: CYCLE_START, sort: "-receipt_date",
  });
  const f6 = filings
    .filter((f) => /^F6/.test(f.form_type || ""))
    .filter((f) => !f.amended_by && f.most_recent !== false)
    .slice(0, MAX_48H_NOTICES);

  const out = [];
  for (const f of f6) {
    const text = await (await fetch(`https://docquery.fec.gov/dcdev/posted/${f.file_number}.fec`)).text();
    const contributions = parseForm6(text).sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
    out.push({
      candidate: cand.id,
      committee_id: cand.committee.id,
      file_number: f.file_number,
      form_type: f.form_type,
      filed: day(f.receipt_date || f.filed_date),
      total: round2(contributions.reduce((s, x) => s + x.amount, 0)),
      contributions,
      url: filingUrl(cand.committee.id, f.file_number),
    });
    await sleep(250);
  }
  return out;
}

async function outsideSpending(cand) {
  const rows = await fecAll("/schedules/schedule_e/by_candidate/", {
    candidate_id: cand.candidate_id, cycle: CYCLE, election_full: true,
  });
  const groups = new Map();
  for (const r of rows) {
    const so = r.support_oppose_indicator === "S" ? "support" : r.support_oppose_indicator === "O" ? "oppose" : null;
    if (!so || !r.total) continue;
    const key = `${r.committee_id}|${so}`;
    const g = groups.get(key) || { committee_id: r.committee_id, committee_name: r.committee_name, candidate: cand.id, support_oppose: so, total: 0, count: 0 };
    g.total += r.total;
    g.count += r.count || 0;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, total: round2(g.total) }));
}

async function main() {
  const candidates = [];
  for (const c of CANDIDATES) candidates.push(await candidateFinance(c));

  const notices = [];
  for (const c of candidates) notices.push(...(await fortyEightHourReports(c)));
  notices.sort((a, b) => b.filed.localeCompare(a.filed) || b.file_number - a.file_number);

  const groups = [];
  for (const c of candidates) groups.push(...(await outsideSpending(c)));
  groups.sort((a, b) => b.total - a.total);
  const summary = Object.fromEntries(candidates.map((c) => {
    const mine = groups.filter((g) => g.candidate === c.id);
    const sum = (so) => round2(mine.filter((g) => g.support_oppose === so).reduce((s, g) => s + g.total, 0));
    return [c.id, { support: sum("support"), oppose: sum("oppose") }];
  }));

  const data = {
    cycle: CYCLE,
    source: "Federal Election Commission, OpenFEC API (api.open.fec.gov)",
    source_url: "https://www.fec.gov/data/elections/house/VA/02/2026/",
    candidates,
    forty_eight_hour_reports: notices,
    outside_spending: {
      note: "Independent expenditures from FEC processed data, totaled by spending group; the newest 24/48-hour reports can take a few days to appear.",
      by_candidate: summary,
      groups,
    },
  };

  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  if (previous) {
    const { updated_at, ...prevData } = previous;
    if (JSON.stringify(prevData) === JSON.stringify(data)) {
      console.log(`No changes (${calls} API calls). Left ${OUT} as is.`);
      return;
    }
  }
  writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), ...data }, null, 2) + "\n");

  console.log(`Wrote ${OUT} (${calls} API calls)`);
  for (const c of candidates) {
    const t = c.totals;
    console.log(`  ${c.name}: raised ${t.raised}, spent ${t.spent}, cash ${t.cash_on_hand}, through ${t.through} (${t.basis}); latest report ${c.latest_report?.name} filed ${c.latest_report?.filed}`);
  }
  console.log(`  48-hour notices: ${notices.length}; outside spending groups: ${groups.length}`, JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
