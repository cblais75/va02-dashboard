// Builds data/media.json: news mentions of both candidates from Google News RSS.
// Saves only headline, outlet, date and link (no article text), removes duplicates,
// keeps the last 30 days, and tags headlines mentioning endorse / debate / poll.
//
// Run: node scripts/fetch-media.mjs   (or: npm run media)
//      Add --baseline to save the feed without reporting tagged headlines as new.
// For GitHub Actions it writes issue bodies for newly seen tagged headlines:
//   $ENDORSE_BODY (endorse) and $DEBATE_POLL_BODY (debate/poll), and sets
//   endorse=true|false and debate_poll=true|false in $GITHUB_OUTPUT.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "media.json");
const WINDOW_DAYS = 30;
const BASELINE = process.argv.includes("--baseline");
const ENDORSE_BODY = process.env.ENDORSE_BODY || join(tmpdir(), "media-endorse.md");
const DEBATE_POLL_BODY = process.env.DEBATE_POLL_BODY || join(tmpdir(), "media-debate-poll.md");

const QUERIES = [
  { candidate: "kiggans", q: '"Jen Kiggans"' },
  { candidate: "luria", q: '"Elaine Luria"' },
];

// Local outlets, matched by the source domain Google News reports.
const LOCAL = {
  "pilotonline.com": "The Virginian-Pilot",
  "dailypress.com": "Daily Press",
  "wavy.com": "WAVY",
  "wtkr.com": "WTKR (News 3)",
  "13newsnow.com": "13News Now (WVEC)",
  "whro.org": "WHRO",
  "easternshorepost.com": "Eastern Shore Post",
};

// Candidates' own official sites. Their releases are kept but counted separately
// from news coverage.
const OFFICIAL = { "kiggans.house.gov": "kiggans" };

const TAGS = [
  { tag: "endorse", test: (t) => /endors/i.test(t) },
  { tag: "debate", test: (t) => /\bdebat/i.test(t) },
  // "poll" but not "polls open/close" or "polling place".
  { tag: "poll", test: (t) => /\bpoll(s|ster|sters|ing)?\b/i.test(t.replace(/\bpolls? (open|close)\w*|\bpolling (place|location|station)s?/gi, "")) },
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
const tagOf = (xml, name) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1];

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchFeed({ candidate, q }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (va02-dashboard media tracker)" } });
  if (!res.ok) throw new Error(`Google News "${q}": HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const [, it] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = it.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const outletName = source ? decode(source[2]) : null;
    const domain = source ? domainOf(source[1]) : null;
    let headline = decode(tagOf(it, "title") || "");
    if (outletName && headline.endsWith(` - ${outletName}`)) headline = headline.slice(0, -(outletName.length + 3));
    const date = new Date(decode(tagOf(it, "pubDate") || ""));
    if (!headline || Number.isNaN(date.getTime())) continue;
    items.push({
      id: decode(tagOf(it, "guid") || tagOf(it, "link")),
      headline,
      outlet: LOCAL[domain] || outletName || domain,
      outlet_domain: domain,
      local: Boolean(LOCAL[domain]),
      official: Boolean(OFFICIAL[domain]),
      date: date.toISOString(),
      link: decode(tagOf(it, "link") || ""),
      candidates: [candidate],
    });
  }
  return items;
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const fetched = [];
  for (const query of QUERIES) fetched.push(...(await fetchFeed(query)));

  // Merge with what was saved (the feed only returns the latest 100 per search),
  // then drop duplicates: same Google News id, or same headline from the same outlet.
  const byKey = new Map();
  for (const item of [...(prev?.items || []), ...fetched]) {
    const key = byKey.has(item.id) ? item.id : [...byKey.values()].find((x) => normalize(x.headline) === normalize(item.headline) && x.outlet === item.outlet)?.id || item.id;
    const existing = byKey.get(key);
    if (existing) existing.candidates = [...new Set([...existing.candidates, ...item.candidates])].sort();
    else byKey.set(key, { ...item, candidates: [...item.candidates].sort() });
  }
  const cutoff = Date.now() - WINDOW_DAYS * 86400000;
  const items = [...byKey.values()]
    .filter((x) => Date.parse(x.date) >= cutoff)
    .map((x) => ({ ...x, official: Boolean(OFFICIAL[x.outlet_domain]), tags: TAGS.filter((t) => t.test(x.headline)).map((t) => t.tag) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.headline.localeCompare(b.headline));

  // Tagged headlines not in the previous file are new and go to the review issues.
  const seen = new Set((prev?.items || []).map((x) => x.id));
  const fresh = BASELINE || !prev ? [] : items.filter((x) => !seen.has(x.id));
  const line = (x) => `- [ ] [${x.headline.replace(/([\\[\]])/g, "\\$1")}](${x.link}) — ${x.outlet}, ${x.date.slice(0, 10)}`;
  const footer = "\n---\nFound by the daily media tracker (Google News). Nothing was added to the dashboard automatically.";
  const endorse = fresh.filter((x) => x.tags.includes("endorse"));
  const debatePoll = fresh.filter((x) => x.tags.includes("debate") || x.tags.includes("poll"));
  if (endorse.length) {
    writeFileSync(ENDORSE_BODY, `### News headlines mentioning endorsements (${new Date().toISOString().slice(0, 10)})\n\n${endorse.map(line).join("\n")}\n${footer}\n`);
  }
  if (debatePoll.length) {
    writeFileSync(DEBATE_POLL_BODY, `### News headlines mentioning debates or polls (${new Date().toISOString().slice(0, 10)})\n\n${debatePoll.map((x) => `${line(x)} (${x.tags.filter((t) => t !== "endorse").join(", ")})`).join("\n")}\n\nTo add a poll or debate to the dashboard, edit \`polling\` or \`key_dates\` in \`data/manual.json\` by hand.\n${footer}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `endorse=${endorse.length > 0}\ndebate_poll=${debatePoll.length > 0}\nendorse_body=${ENDORSE_BODY}\ndebate_poll_body=${DEBATE_POLL_BODY}\n`);
  }

  const data = {
    source: "Google News RSS search",
    queries: QUERIES.map((q) => q.q),
    window_days: WINDOW_DAYS,
    local_outlets: Object.values(LOCAL),
    official_domains: Object.keys(OFFICIAL),
    items,
  };
  if (prev) {
    const { updated_at, ...prevData } = prev;
    if (JSON.stringify(prevData) === JSON.stringify(data)) {
      console.log(`No changes (${items.length} items in the last ${WINDOW_DAYS} days).`);
      return;
    }
  }
  writeFileSync(OUT, JSON.stringify({ updated_at: new Date().toISOString(), ...data }, null, 2) + "\n");
  const news = items.filter((x) => !x.official);
  const count = (id) => news.filter((x) => x.candidates.includes(id)).length;
  console.log(`Wrote data/media.json: ${news.length} news stories (Kiggans ${count("kiggans")}, Luria ${count("luria")}, local ${news.filter((x) => x.local).length}) + ${items.length - news.length} official releases; new tagged: ${endorse.length} endorse, ${debatePoll.length} debate/poll`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
