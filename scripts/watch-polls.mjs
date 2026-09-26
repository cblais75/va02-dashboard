// Checks two places for new VA-02 polls and writes a GitHub Issue body for a person
// to review. It never adds polls to the dashboard (data/manual.json).
//   - CNU Wason Center survey list: https://cnu.edu/wasoncenter/surveys/
//   - Wikipedia, "2026 United States House of Representatives elections in Virginia",
//     District 2 > Polling tables (via the MediaWiki API)
// What has already been seen is kept in data/poll_watch.json.
//
// Run: node scripts/watch-polls.mjs   (or: npm run watch-polls)
//      Add --baseline to record what's there now without reporting it as new.
// Outputs (for GitHub Actions): changes=true|false in $GITHUB_OUTPUT, and the issue
// body at $ISSUE_BODY (default: poll-issue.md in the temp folder).

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
const VA02 = /kiggans|luria|\bva-?0?2\b|2nd (congressional )?district|second (congressional )?district/i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘" };
const decode = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const clean = (s) => decode(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
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

// Rows of the District 2 > Polling tables.
async function wikiPolls() {
  const api = "https://en.wikipedia.org/w/api.php";
  const sections = (await get(`${api}?action=parse&page=${WIKI_PAGE}&prop=sections&format=json`, "json")).parse.sections;
  const d2 = sections.findIndex((s) => s.toclevel === 1 && /^District 2$/i.test(clean(s.line)));
  if (d2 < 0) throw new Error("Wikipedia: no 'District 2' section found");
  const rows = [];
  for (let i = d2 + 1; i < sections.length && sections[i].toclevel > 1; i++) {
    if (!/polling/i.test(clean(sections[i].line))) continue;
    const text = (await get(`${api}?action=parse&page=${WIKI_PAGE}&section=${sections[i].index}&prop=wikitext&format=json`, "json")).parse.wikitext["*"];
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

const md = (s) => String(s).replace(/([\\`*_[\]<>|])/g, "\\$1");

async function main() {
  const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { cnu: [], wikipedia: [] };
  const manualPolls = JSON.parse(readFileSync(MANUAL, "utf8")).polling?.polls || [];
  const onDashboard = (row) =>
    manualPolls.some((p) => row.pollster.toLowerCase().includes(p.pollster.toLowerCase().split(" ")[0]) && row.results.includes(`${p.kiggans}%`) && row.results.includes(`${p.luria}%`));

  const next = { cnu: prev.cnu, wikipedia: prev.wikipedia };
  const blocks = [];
  const problems = [];

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
  } catch (err) {
    problems.push(`CNU Wason Center: ${err.message}`);
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
  } catch (err) {
    problems.push(`Wikipedia: ${err.message}`);
  }

  const changed = !BASELINE && (blocks.length > 0 || problems.length > 0);
  if (changed) {
    const body = [
      `### Poll watcher (${new Date().toISOString().slice(0, 10)})`,
      ...blocks,
      problems.length ? `**Problems:**\n${problems.map((p) => `- ${md(p)}`).join("\n")}` : "",
      "---",
      "Nothing was added to the dashboard. To add a poll, confirm its source, then add it by hand to `polling.polls` in `data/manual.json` with its sponsor_type (independent, dem or gop).",
    ].filter(Boolean).join("\n\n");
    writeFileSync(ISSUE_BODY, body + "\n");
    console.log(body);
  } else {
    console.log(`No new polls. (CNU: ${next.cnu.length} surveys; Wikipedia VA-02 rows: ${next.wikipedia.length})`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changes=${changed}\nissue_body=${ISSUE_BODY}\n`);

  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(STATE) || readFileSync(STATE, "utf8") !== serialized) writeFileSync(STATE, serialized);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
