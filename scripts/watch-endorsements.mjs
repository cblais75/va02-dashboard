// Checks both campaign sites for endorsement changes and writes a GitHub Issue body
// for a human to review. It never edits the endorsement list in data/manual.json.
//
// Watches, via each site's public WordPress API:
//   - Luria: the endorsements page (elaineforcongress.com/endorsements)
//   - Kiggans: any page whose title or slug mentions endorsements (none exists yet)
//   - Both: news posts whose headline mentions "endorse"
// What has already been seen is kept in data/endorsement_watch.json, which is only
// rewritten when something changes.
//
// Run: node scripts/watch-endorsements.mjs   (or: npm run watch-endorsements)
//      Add --baseline to record what's there now without reporting it as new.
// Outputs (for GitHub Actions): changes=true|false in $GITHUB_OUTPUT, and the issue
// body at $ISSUE_BODY (default: endorsement-issue.md in the temp folder).

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "data", "endorsement_watch.json");
const ISSUE_BODY = process.env.ISSUE_BODY || join(tmpdir(), "endorsement-issue.md");
const HEADLINE = /endors/i;
const BASELINE = process.argv.includes("--baseline");

const SITES = [
  { id: "luria", name: "Elaine Luria", base: "https://elaineforcongress.com", endorsementsPage: "https://elaineforcongress.com/endorsements/" },
  { id: "kiggans", name: "Jen Kiggans", base: "https://jenforcongress.com", endorsementsPage: null },
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—" };
function text(htmlStr) {
  return String(htmlStr)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+,/g, ",");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "va02-dashboard endorsement watcher (github.com/cblais75/va02-dashboard)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// List items on a WordPress page, labeled with the heading above them.
function listItems(contentHtml) {
  const items = [];
  let heading = null;
  for (const m of contentHtml.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<li[^>]*>([\s\S]*?)<\/li>/g)) {
    if (m[1] !== undefined) heading = text(m[1]);
    else if (text(m[2])) items.push(heading ? `${text(m[2])} (${heading})` : text(m[2]));
  }
  return items;
}

async function checkSite(site) {
  const out = { page: null, items: null, headlines: [] };
  // Endorsements page: the known one, or any page that looks like one.
  const pages = await getJson(`${site.base}/wp-json/wp/v2/pages?per_page=100&_fields=slug,link,title,content`);
  const page = pages.find((p) => site.endorsementsPage && p.link.replace(/\/$/, "") === site.endorsementsPage.replace(/\/$/, ""))
    || pages.find((p) => HEADLINE.test(p.slug) || HEADLINE.test(text(p.title.rendered)));
  if (page) {
    out.page = page.link;
    out.items = listItems(page.content.rendered);
  }
  const posts = await getJson(`${site.base}/wp-json/wp/v2/posts?per_page=50&_fields=date,link,title`);
  out.headlines = posts
    .filter((p) => HEADLINE.test(text(p.title.rendered)))
    .map((p) => ({ title: text(p.title.rendered), link: p.link, date: p.date.slice(0, 10) }));
  return out;
}

const md = (s) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");

async function main() {
  const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { sites: {} };
  const next = { sites: {} };
  const sections = [];
  const problems = [];

  for (const site of SITES) {
    const before = prev.sites[site.id] || { page: null, items: [], headlines: [] };
    let now;
    try {
      now = await checkSite(site);
    } catch (err) {
      // An unreachable site is not a change: keep what we had and report it.
      problems.push(`${site.name}: couldn't read the site (${err.message}).`);
      next.sites[site.id] = before;
      continue;
    }
    if (before.items.length && (!now.items || now.items.length === 0)) {
      problems.push(`${site.name}: the endorsements list at ${before.page} came back empty. The page may have moved or changed layout; check it by hand.`);
      now.page = before.page;
      now.items = before.items;
    }
    const items = now.items || [];
    const added = items.filter((i) => !before.items.includes(i));
    const removed = before.items.filter((i) => !items.includes(i));
    const seen = new Set(before.headlines.map((h) => h.link));
    const newHeadlines = now.headlines.filter((h) => !seen.has(h.link));
    next.sites[site.id] = { page: now.page, items, headlines: now.headlines };

    // Each block is a heading line plus its list; blocks are separated by blank lines.
    const blocks = [];
    if (now.page && now.page !== before.page) blocks.push(`Endorsements page ${before.page ? "moved to" : "appeared at"} ${now.page}`);
    if (added.length) blocks.push([`**New on the endorsements page** (${now.page}):`, ...added.map((i) => `- [ ] ${md(i)}`)].join("\n"));
    if (removed.length) blocks.push([`**No longer on the page:**`, ...removed.map((i) => `- ${md(i)}`)].join("\n"));
    if (newHeadlines.length) blocks.push([`**New headlines mentioning endorsements:**`, ...newHeadlines.map((h) => `- [ ] [${md(h.title)}](${h.link}) (${h.date})`)].join("\n"));
    if (blocks.length) sections.push([`### ${site.name}`, ...blocks].join("\n\n"));
  }

  const changed = !BASELINE && (sections.length > 0 || problems.length > 0);
  if (changed) {
    const body = [
      `Found on ${new Date().toISOString().slice(0, 10)} by the daily endorsement watcher.`,
      ...sections,
      problems.length ? `### Problems\n\n${problems.map((p) => `- ${md(p)}`).join("\n")}` : "",
      "---",
      "Nothing was added to the dashboard. To add one, confirm it has a public source (the campaign site, the endorser's own announcement or a news story), then add it by hand to `endorsements` in `data/manual.json`.",
    ].filter(Boolean).join("\n\n");
    writeFileSync(ISSUE_BODY, body + "\n");
    console.log(body);
  } else {
    console.log("No endorsement changes.");
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changes=${changed}\nissue_body=${ISSUE_BODY}\n`);

  // Save what we've seen (unchanged file stays byte-identical, so no empty commits).
  const serialized = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(STATE) || readFileSync(STATE, "utf8") !== serialized) writeFileSync(STATE, serialized);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
