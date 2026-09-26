import React from "react";
import Takeaway from "./Takeaway.jsx";
import manual from "../data/manual.json";
import { BLUE, RED } from "./theme.js";
import { daysBetween, formatDate, useTodayET } from "./dates.js";

const PARTY = {
  R: { name: "Republican", color: RED },
  D: { name: "Democratic", color: BLUE },
};

const surname = (c) => c.name.split(" ").pop();

// "Lean R" -> { side: "R", strength: 2 }. Unknown text (e.g. TBD) -> null.
function parseRating(text = "") {
  const t = text.trim().toLowerCase();
  if (/toss/.test(t)) return { side: null, strength: 0 };
  const m = t.match(/^(solid|safe|likely|lean|tilt)\s+(r|d|rep|dem)/);
  if (!m) return null;
  const strength = { tilt: 1, lean: 2, likely: 3, solid: 4, safe: 4 }[m[1]];
  return { side: m[2].startsWith("r") ? "R" : "D", strength };
}

function CandidateCard({ c }) {
  const party = PARTY[c.party] || { name: c.party, color: "#8A97AD" };
  return (
    <div className="df-card ro-cand" style={{ boxShadow: `inset 0 3px 0 ${party.color}` }}>
      <div className="ro-cand-tag">
        <i className="df-dot" style={{ background: party.color }} />
        {party.name} · {c.status}
      </div>
      <div className="ro-cand-name">{c.name}</div>
      {c.note && <div className="ro-cand-note">{c.note}</div>}
    </div>
  );
}

function Countdown({ today }) {
  const day = manual.election_day;
  const days = daysBetween(today, day);
  const longDate = formatDate(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="df-card ro-countdown">
      <div className="ro-label">Countdown</div>
      {days > 0 && (
        <>
          <div className="ro-hero">{days}<span>{days === 1 ? "day" : "days"}</span></div>
          <div className="ro-meta">until Election Day · {longDate}</div>
        </>
      )}
      {days === 0 && (
        <>
          <div className="ro-hero ro-hero-text">Election Day</div>
          <div className="ro-meta">Polls are open 6 a.m. to 7 p.m. ET</div>
        </>
      )}
      {days < 0 && (
        <>
          <div className="ro-hero ro-hero-text">Election held</div>
          <div className="ro-meta">{longDate}</div>
        </>
      )}
    </div>
  );
}

function RatingCard({ r, showDate }) {
  const parsed = parseRating(r.rating);
  let style = {};
  if (parsed?.side) {
    const color = parsed.side === "R" ? RED : BLUE;
    const alpha = Math.round((0.12 + parsed.strength * 0.1) * 255).toString(16).padStart(2, "0");
    style = { background: `${color}${alpha}`, boxShadow: `inset 3px 0 0 ${color}` };
  } else if (parsed) {
    style = { background: "#28344A" };
  }
  return (
    <div className="ro-rating">
      <div className="ro-rating-outlet">
        {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.outlet}</a> : r.outlet}
      </div>
      <div className={`ro-rating-value${parsed ? "" : " is-tbd"}`} style={style}>{r.rating || "TBD"}</div>
      {showDate && <div className="ro-rating-date">{r.as_of ? `as of ${formatDate(r.as_of)}` : " "}</div>}
    </div>
  );
}

const SPONSOR = {
  independent: { label: "Independent", color: "#8A97AD" },
  dem: { label: "Dem-sponsored", color: BLUE },
  gop: { label: "GOP-sponsored", color: RED },
};

// Average of each independent pollster's most recent poll; null until there are 2+.
function independentAverage(polls) {
  const latest = new Map();
  for (const p of polls.filter((x) => x.sponsor_type === "independent")) {
    const prev = latest.get(p.pollster);
    if (!prev || (p.end_date || "") > (prev.end_date || "")) latest.set(p.pollster, p);
  }
  const list = [...latest.values()];
  if (list.length < 2) return null;
  const mean = (id) => list.reduce((s, p) => s + p[id], 0) / list.length;
  return { count: list.length, ...Object.fromEntries(manual.candidates.map((c) => [c.id, mean(c.id)])) };
}

function Polling() {
  const polls = [...(manual.polling?.polls || [])].sort((x, y) => (y.end_date || "").localeCompare(x.end_date || ""));
  const average = independentAverage(polls);
  const [a, b] = manual.candidates;
  const lead = average ? average[a.id] - average[b.id] : 0;

  return (
    <div className="df-card ro-polling">
      <div className="ro-label">{average ? "Polling average" : "Polls"}</div>
      {average && (
        <>
          <div className="ro-poll-row">
            {manual.candidates.map((c) => (
              <div key={c.id} className="ro-poll-cand">
                <span><i className="df-dot" style={{ background: PARTY[c.party]?.color }} />{surname(c)}</span>
                <strong>{average[c.id].toFixed(1)}%</strong>
              </div>
            ))}
          </div>
          <div className="ro-meta">
            {Math.abs(lead) < 0.05 ? "Tied" : `${surname(lead > 0 ? a : b)} +${Math.abs(lead).toFixed(1)}`}
            {` · average of ${average.count} independent polls`}
          </div>
        </>
      )}
      {polls.length === 0 ? (
        <div className="ro-empty">No public polls yet</div>
      ) : (
        <>
          <ul className="ro-polls">
            {polls.map((p, i) => {
              const sp = SPONSOR[p.sponsor_type] || SPONSOR.independent;
              return (
                <li key={i}>
                  <span>
                    {p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.pollster}</a> : p.pollster}
                    <span className="ro-sponsor" style={{ borderColor: sp.color }} title={p.sponsor ? `Sponsored by ${p.sponsor}` : undefined}>
                      {sp.label}
                    </span>
                  </span>
                  <span className="ro-poll-detail">
                    {[p.sponsor && `for ${p.sponsor}`, p.dates, p.sample].filter(Boolean).join(" · ")}
                  </span>
                  <span className="ro-poll-nums">{manual.candidates.map((c) => `${surname(c)} ${p[c.id]}`).join(" · ")}</span>
                </li>
              );
            })}
          </ul>
          {!average && (
            <p className="ro-poll-note">
              An average appears once there are 2 or more independent polls. Sponsored polls are shown but not averaged.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default function RaceOverview() {
  const today = useTodayET();
  return (
    <section id="overview" className="ro" aria-labelledby="ro-title">
      <header className="df-head">
        <div className="df-kicker">Race Overview</div>
        <h2 id="ro-title">The 2026 matchup</h2>
      </header>
      <Takeaway section="race_overview" />

      <div className="ro-top">
        <div className="ro-cands">
          {manual.candidates.map((c) => <CandidateCard key={c.id} c={c} />)}
        </div>
        <Countdown today={today} />
      </div>

      <div className="ro-bottom">
        <div className="df-card">
          <div className="ro-label ro-label-row">
            <span>Race ratings</span>
            {manual.ratings_last_checked && <span className="ro-checked">Last checked {formatDate(manual.ratings_last_checked)}</span>}
          </div>
          <div className="ro-ratings">
            {manual.ratings.map((r) => <RatingCard key={r.outlet} r={r} showDate={manual.ratings.some((x) => x.as_of)} />)}
          </div>
        </div>
        <Polling />
      </div>
    </section>
  );
}
