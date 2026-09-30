// Checks for new VA-02 polls and changed race ratings, and writes a GitHub Issue body
// for a person to review. It never changes polls or ratings on the dashboard.
//   Polls:
//   - CNU Wason Center survey list: https://cnu.edu/wasoncenter/surveys/
//   - Wikipedia, "2026 United States House of Representatives elections in Virginia",
//     District 2 > Polling tables (via the MediaWiki API)
//   Ratings:
//   - Cook Political Report race page, Inside Elections' Kiggans page
//   - Sabato's Crystal Ball: its site blocks automated requests, so the rating is read
//     from the same Wikipedia page's District 2 > Predictions table
// What has already been seen is kept in data/poll_watch.json. A source that can't be
// read is reported once when it starts failing, not every day.
//
// Run: node scripts/watch-polls.mjs   (or: npm run watch-polls)
//      Add --baseline to record what's there now without reporting it as new.
// Outputs (for GitHub Actions): changes=true|false in $GITHUB_OUTPUT, and the issue
// body at $ISSUE_BODY (default: poll-issue.md in the temp folder).

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "data", "poll_watch.json");
const MANUAL = join(ROOT, "data", "manual.json");
const ISSUE_BODY = process.env.ISSUE_BODY || join(tmpdir(), "poll-issue.md");
const BASELINE = process.argv.includes("--baseline");
const UA = "va02-dashboard poll watcher (https://github.com/cblais75/va02-dashboard)";

const CNU_URL = "https://cnu.edu/wasoncenter/surveys/";
const WIKI_PAGE = "2026_United_States_House_of_Representatives_elections_in_Virginia";
const WIKI_URL = `https://en.wikipedia.org/wiki/${WIKI_PAGE}`;
const RATING_PAGES = {
  cook: { outlet: "Cook Political Report", url: "https://www.cookpolitical.com/house/race/485441" },
  inside: { outlet: "Inside Elections", url: "https://insideelections.com/person/jennifer-kiggans/" },
  sabato: { outlet: "Sabato's Crystal Ball", url: "https://centerforpolitics.org/crystalball/2026-rating-changes/" },
};
const VA02 = /kiggans|luria|\bva-?0?2\b|2nd (congressional )?district|second (congressional )?district/i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };
const decode = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const clean = (s) => decode(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url, as = "text", ua = UA) {
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

// CNU Wason Center: each survey is a link to archive/YYYY-MM-DD.html with its headline.
async function cnuSurveys() {
  const page = await get(CNU_URL);
  const out = [];
  for (const [, href, label] of page.matchAll(/<a[^>]+href="([^"]*archive\/\d{4}-\d{2}-\d{2}[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const url = new URL(href, CNU_URL).href;
    if (!out.some((x) => x.url === url)) out.push({ url, title: clean(label), date: url.match(/\d{4}-\d{2}-\d{2}/)[0] });
  }
  return out;
}

// Wikipedia wikitext of a table cell -> plain text.
function wikiText(cell) {
  let t = cell
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/\{\{efn[\s\S]*?\}\}/g, "");
  // Drop remaining templates, keeping simple ones' last argument (e.g. {{nowrap|x}}).
  for (let i = 0; i < 5; i++) t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => (inner.includes("|") ? inner.split("|").pop() : ""));
  t = t
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/^\s*(?:style|class|rowspan|colspan|align)\s*=\s*"[^"]*"\s*\|/i, "");
  return clean(t);
}

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// Wikitext of each District 2 subsection whose title matches `pattern`.
async function district2Sections(pattern) {
  const sections = (await get(`${WIKI_API}?action=parse&page=${WIKI_PAGE}&prop=sections&format=json`, "json")).parse.sections;
  const d2 = sections.findIndex((s) => s.toclevel === 1 && /^District 2$/i.test(clean(s.line)));
  if (d2 < 0) throw new Error("no 'District 2' section found");
  const out = [];
  for (let i = d2 + 1; i < sections.length && sections[i].toclevel > 1; i++) {
    if (!pattern.test(clean(sections[i].line))) continue;
    out.push((await get(`${WIKI_API}?action=parse&page=${WIKI_PAGE}&section=${sections[i].index}&prop=wikitext&format=json`, "json")).parse.wikitext["*"]);
  }
  return out;
}

// Rows of the District 2 > Polling tables.
async function wikiPolls() {
  const rows = [];
  for (const text of await district2Sections(/polling/i)) {
    for (const m of text.matchAll(/\{\|([\s\S]*?)\n\|\}/g)) {
      const table = m[1];
      // The bold line just above a table names the matchup, e.g. '''Jen Kiggans vs. Elaine Luria'''.
      const caption = (text.slice(0, m.index).match(/'''([^']+)'''\s*$/) || [])[1] || "";
      const parts = table.split(/\n\|-[^\n]*/).slice(1);
      const isHeader = (p) => /(^|\n)!/.test(p);
      const headers = (parts.find(isHeader) || "")
        .split("\n")
        .filter((l) => l.startsWith("!"))
        .map((l) => wikiText(l.slice(1).replace(/^[^|]*=[^|]*\|/, "")));
      for (const raw of parts) {
        if (isHeader(raw)) continue;
        const lines = raw.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}"));
        if (lines.length < 2) continue;
        const cells = lines.flatMap((l) => l.slice(1).split("||")).map(wikiText);
        const [pollster, dates, sample] = cells;
        if (!pollster || !dates) continue;
        // Result columns follow poll source, dates, sample size and margin of error.
        const results = cells
          .slice(4)
          .map((v, j) => (v ? `${headers[j + 4] || "?"} ${v}` : ""))
          .filter(Boolean)
          .join(", ");
        rows.push({ key: `${pollster}|${dates}`.toLowerCase(), matchup: clean(caption), pollster, dates, sample, results });
      }
    }
  }
  return rows;
}

// {{USRaceRating|Lean|D|flip}} -> "Lean D"; {{USRaceRating|Tossup}} -> "Toss Up".
function raceRating(cell) {
  const m = cell.match(/\{\{\s*USRaceRating\s*\|([^}]*)\}\}/i);
  if (!m) return wikiText(cell);
  const [level, party] = m[1].split("|").map((x) => x.trim());
  if (/toss/i.test(level)) return "Toss Up";
  return party ? `${level} ${party.toUpperCase()}` : level;
}

async function sabatoRating() {
  for (const text of await district2Sections(/predictions/i)) {
    for (const raw of text.split(/\n\|-[^\n]*/)) {
      if (!/sabato/i.test(raw)) continue;
      const cells = raw.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}")).flatMap((l) => l.slice(1).split("||"));
      if (cells.length >= 3) return { rating: raceRating(cells[1]), as_of: wikiText(cells[2]) };
    }
  }
  throw new Error("no Sabato's Crystal Ball row in Wikipedia's VA-02 Predictions table");
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Cook and Inside Elections refuse Node's built-in fetch but serve the same public
// page to curl, so these two are fetched with curl (available on GitHub runners).
function getWithCurl(url) {
  const out = execFileSync("curl", ["-sS", "-L", "-m", "40", "-A", BROWSER_UA, "-w", "\n%{http_code}", url], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1));
  if (status !== 200) throw new Error(`${url}: HTTP ${status}`);
  return out.slice(0, cut);
}

async function cookRating() {
  const page = getWithCurl(RATING_PAGES.cook.url);
  // The rating block shows previous -> current; the current rating is on the right.
  const rating = page.match(/race-rating-data-right[^"]*">\s*<span>([^<]+)<\/span>/);
  const updated = page.match(/race-rating-update">\s*Last updated\s*:\s*([^<]+)</);
  if (!rating) throw new Error("couldn't find the race rating on the page (layout may have changed)");
  return { rating: clean(rating[1]), as_of: updated ? clean(updated[1]) : null };
}

async function insideRating() {
  const page = getWithCurl(RATING_PAGES.inside.url);
  const rating = page.match(/Current Rating<\/span>\s*<div[^>]*>\s*<span class="rating-badge[^"]*">([^<]+)<\/span>/);
  const date = page.match(/current-rating"[^>]*>\s*<div[^>]*>\s*<date>([^<]+)<\/date>/);
  if (!rating) throw new Error("couldn't find the current rating on the page (layout may have changed)");
  return { rating: clean(rating[1]), as_of: date ? clean(date[1]) : null };
}

// "Toss-up", "Tossup" and "Toss Up" match; "Leans Democratic" matches "Lean D".
const sameRating = (a, b) => {
  const n = (r) => String(r || "").toLowerCase().replace(/\bleans\b/, "lean").replace(/democratic|democrat/, "d").replace(/republican/, "r").replace(/[^a-z]/g, "");
  return n(a) === n(b);
};

const md = (s) => String(s).replace(/([\\`*_[\]<>|])/g, "\\$1");

async function main() {
  const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { cnu: [], wikipedia: [] };
  prev.ratings ||= {};
  prev.status ||= {};
  const manual = JSON.parse(readFileSync(MANUAL, "utf8"));
  const manualPolls = manual.polling?.polls || [];
  const onDashboard = (row) =>
    manualPolls.some((p) => row.pollster.toLowerCase().includes(p.pollster.toLowerCase().split(" ")[0]) && row.results.includes(`${p.kiggans}%`) && row.results.includes(`${p.luria}%`));

  const next = { cnu: prev.cnu, wikipedia: prev.wikipedia, ratings: { ...prev.ratings }, status: {} };
  const blocks = [];
  const problems = [];
  // Report a source's problem only on the day it starts failing.
  const fail = (source, label, err) => {
    next.status[source] = "error";
    if (prev.status[source] !== "error") problems.push(`${label}: ${err.message}`);
  };

  try {
    const surveys = await cnuSurveys();
    if (surveys.length === 0 && prev.cnu.length) throw new Error("the survey list came back empty (layout may have changed)");
    const seen = new Set(prev.cnu.map((s) => s.url));
    const fresh = surveys.filter((s) => !seen.has(s.url));
    const likely = fresh.filter((s) => VA02.test(s.title));
    const other = fresh.filter((s) => !VA02.test(s.title));
    if (likely.length) blocks.push(["**CNU Wason Center, likely VA-02:**", ...likely.map((s) => `- [ ] [${md(s.title)}](${s.url}) (${s.date})`)].join("\n"));
    if (other.length) blocks.push(["**Other new Wason Center surveys** (statewide; check for VA-02 results):", ...other.map((s) => `- [ ] [${md(s.title)}](${s.url}) (${s.date})`)].join("\n"));
    next.cnu = surveys;
    next.status.cnu = "ok";
  } catch (err) {
    fail("cnu", "CNU Wason Center", err);
  }

  try {
    const rows = await wikiPolls();
    if (rows.length === 0 && prev.wikipedia.length) throw new Error("the VA-02 polling table came back empty (section may have moved)");
    const seen = new Set(prev.wikipedia.map((r) => r.key));
    const fresh = rows.filter((r) => !seen.has(r.key));
    if (fresh.length) {
      blocks.push([`**New rows in Wikipedia's VA-02 polling table** ([page](${WIKI_URL}#District_2)):`,
        ...fresh.map((r) => `- [ ] ${md(r.pollster)}, ${md(r.dates)}${r.sample ? `, ${md(r.sample)}` : ""}: ${md(r.results)}${r.matchup ? ` (${md(r.matchup)})` : ""}${onDashboard(r) ? " — already on the dashboard" : ""}`)].join("\n"));
    }
    next.wikipedia = rows;
    next.status.wikipedia = "ok";
  } catch (err) {
    fail("wikipedia", "Wikipedia polling table", err);
  }

  // Race ratings: report a change from the last rating seen for each outlet.
  const ratingChanges = [];
  for (const [id, read] of [["cook", cookRating], ["inside", insideRating], ["sabato", sabatoRating]]) {
    const page = RATING_PAGES[id];
    try {
      const now = await read();
      const before = prev.ratings[id];
      if (before && !sameRating(before.rating, now.rating)) {
        const shown = (manual.ratings || []).find((r) => r.outlet === page.outlet)?.rating;
        const via = id === "sabato" ? ` (read from [Wikipedia](${WIKI_URL}#District_2); [Crystal Ball](${page.url}))` : ` ([source](${page.url}))`;
        ratingChanges.push(`- [ ] ${md(page.outlet)}: ${md(before.rating)} → **${md(now.rating)}**${now.as_of ? `, updated ${md(now.as_of)}` : ""}${via}. The dashboard shows ${md(shown || "no rating")}.`);
      }
      next.ratings[id] = now;
      next.status[id] = "ok";
    } catch (err) {
      fail(id, `${page.outlet} rating`, err);
    }
  }
  if (ratingChanges.length) blocks.push(["**Race rating changes:**", ...ratingChanges].join("\n"));

  const changed = !BASELINE && (blocks.length > 0 || problems.length > 0);
  if (changed) {
    const body = [
      `### Poll watcher (${new Date().toISOString().slice(0, 10)})`,
      ...blocks,
      problems.length ? `**Problems:**\n${problems.map((p) => `- ${md(p)}`).join("\n")}` : "",
      "---",
      "Nothing was changed on the dashboard. To add a poll, confirm its source, then add it by hand to `polling.polls` in `data/manual.json` with its sponsor_type (independent, dem or gop). To update a rating, edit `ratings` (and `ratings_last_checked`) in `data/manual.json`.",
    ].filter(Boolean).join("\n\n");
    writeFileSync(ISSUE_BODY, body + "\n");
    console.log(body);
  } else {
    console.log(`No new polls or rating changes. (CNU: ${next.cnu.length} surveys; Wikipedia VA-02 rows: ${next.wikipedia.length}; ratings: ${Object.entries(next.ratings).map(([k, v]) => `${k} ${v.rating}`).join(", ")})`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changes=${changed}\nissue_body=${ISSUE_BODY}\n`);

  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(STATE) || readFileSync(STATE, "utf8") !== serialized) writeFileSync(STATE, serialized);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
