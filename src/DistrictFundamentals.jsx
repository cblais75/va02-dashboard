import React, { useState } from "react";
import results from "../data/va02_results.json";
import { BLUE, RED } from "./theme.js";

const RACE_LABELS = {
  "2022-us-house-cd02": "2022 U.S. House",
  "2024-president": "2024 President",
  "2024-us-house-cd02": "2024 U.S. House",
  "2025-governor": "2025 Governor",
};

const LOCALITY_LABELS = {
  "Virginia Beach City": "Virginia Beach",
  "Suffolk City": "Suffolk",
  "Franklin City": "Franklin city",
  "Isle of Wight County": "Isle of Wight",
  "Accomack County": "Accomack",
  "Northampton County": "Northampton",
  "Chesapeake City": "Chesapeake†",
  "Southampton County": "Southampton†",
};

const fmt = (n) => n.toLocaleString("en-US");
const SURNAMES = { "Winsome Earle Sears": "Earle-Sears" };
const lastName = (name) => SURNAMES[name] || name.replace(/,? (Jr\.|Sr\.|II|III|IV)$/, "").split(" ").pop();

// Margin = R share minus D share of all votes cast, in points.
function margin(row, rep, dem) {
  return ((row.votes[rep.name] - row.votes[dem.name]) / row.total) * 100;
}
function marginLabel(m) {
  const v = Math.abs(m).toFixed(1);
  if (v === "0.0") return "Even";
  return `${m > 0 ? "R" : "D"}+${v}`;
}

function prepare(race) {
  const rep = race.candidates.find((c) => c.party === "Republican");
  const dem = race.candidates.find((c) => c.party === "Democratic");
  const rows = race.localities.map((l) => ({
    key: l.locality,
    label: LOCALITY_LABELS[l.locality] || l.locality,
    rep: l.votes[rep.name],
    dem: l.votes[dem.name],
    total: l.total,
    margin: margin(l, rep, dem),
    estimated: l.estimated,
    estimatedVotes: l.estimated_portion?.total || 0,
  }));
  const notes = race.localities.flatMap((l) => l.estimate_notes || []);
  const estimateKinds = [
    notes.some((n) => /split between/.test(n)) && "the split Pughsville precinct",
    notes.some((n) => /Locality-wide row/.test(n)) && "provisional ballots reported for the whole locality",
  ].filter(Boolean);
  const d = race.district_total;
  return {
    id: race.id,
    label: RACE_LABELS[race.id] || race.id,
    rep,
    dem,
    rows,
    estimateKinds,
    district: {
      rep: d.votes[rep.name],
      dem: d.votes[dem.name],
      total: d.total,
      margin: margin(d, rep, dem),
      estimated: d.estimated,
      estimatedVotes: d.estimated_votes,
    },
  };
}

const RACES = results.races.map(prepare);

const Star = ({ on }) => (on ? <sup className="df-star">*</sup> : null);

// Fill carries party (hue) and size of margin (opacity); the label carries the value,
// so the color is never the only cue.
function MarginPill({ m, estimated }) {
  const color = m > 0 ? RED : BLUE;
  const strength = Math.min(Math.abs(m) / 30, 1);
  const alpha = Math.round((0.16 + strength * 0.4) * 255).toString(16).padStart(2, "0");
  return (
    <span className="df-pill" style={{ background: `${color}${alpha}`, boxShadow: `inset 3px 0 0 ${color}` }}>
      {marginLabel(m)}
      <Star on={estimated} />
    </span>
  );
}

function MarginChart() {
  const [active, setActive] = useState(null);
  const maxAbs = Math.max(...RACES.map((r) => Math.abs(r.district.margin)));
  const domain = Math.max(5, Math.ceil(maxAbs / 5) * 5);
  const ticks = [-domain, -domain / 2, 0, domain / 2, domain];
  const pct = (m) => (Math.abs(m) / domain) * 50;
  const current = active == null ? null : RACES[active];
  const anyEstimated = RACES.some((r) => r.district.estimated);

  return (
    <figure className="df-card df-chart">
      <figcaption>
        <h3>VA-02 margin by race</h3>
        <p className="df-sub">Republican minus Democratic share of all votes, in points</p>
      </figcaption>

      <div className="df-chart-grid" onMouseLeave={() => setActive(null)}>
        <div className="df-axis-spacer" />
        <div className="df-axis-labels" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${50 + (t / domain) * 50}%` }}>
              {t === 0 ? "0" : `${t > 0 ? "R" : "D"}+${Math.abs(t)}`}
            </span>
          ))}
        </div>
        <div />

        {RACES.map((r, i) => {
          const m = r.district.margin;
          const color = m > 0 ? RED : BLUE;
          return (
            <React.Fragment key={r.id}>
              <div className="df-chart-label">
                {r.label}
                <span>{lastName(r.rep.name)} v {lastName(r.dem.name)}</span>
              </div>
              <button
                type="button"
                className={`df-track${active === i ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                aria-label={`${r.label}: ${marginLabel(m)}${r.district.estimated ? ", includes estimates" : ""}`}
              >
                {ticks.map((t) => (
                  <span key={t} className={`df-grid${t === 0 ? " is-zero" : ""}`} style={{ left: `${50 + (t / domain) * 50}%` }} />
                ))}
                <span
                  className={`df-bar ${m > 0 ? "is-r" : "is-d"}`}
                  style={{ background: color, width: `${pct(m)}%`, [m > 0 ? "left" : "right"]: "50%" }}
                />
              </button>
              <div className="df-chart-value">
                {marginLabel(m)}
                <Star on={r.district.estimated} />
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="df-readout" aria-live="polite">
        {current ? (
          <>
            <strong>{current.label}</strong>
            <span><i style={{ background: RED }} />{lastName(current.rep.name)} {fmt(current.district.rep)}</span>
            <span><i style={{ background: BLUE }} />{lastName(current.dem.name)} {fmt(current.district.dem)}</span>
            <span>Total {fmt(current.district.total)}<Star on={current.district.estimated} /></span>
          </>
        ) : (
          <span className="df-hint">Hover or tap a bar for vote totals.</span>
        )}
      </div>

      <div className="df-legend">
        <span><i style={{ background: RED }} />Republican lead</span>
        <span><i style={{ background: BLUE }} />Democratic lead</span>
      </div>
      {anyEstimated && (
        <p className="df-foot">
          * Includes estimated votes in Chesapeake and Southampton (
          {RACES.filter((r) => r.district.estimated).map((r) => `${r.label}: ${fmt(r.district.estimatedVotes)}`).join("; ")}).
          See the race tables below.
        </p>
      )}
    </figure>
  );
}

function RaceTable({ race }) {
  const est = race.rows.filter((r) => r.estimated);
  return (
    <div className="df-card">
      <h3>{race.label}</h3>
      <p className="df-sub">
        <i className="df-dot" style={{ background: RED }} />{race.rep.name} (R) vs.{" "}
        <i className="df-dot" style={{ background: BLUE }} />{race.dem.name} (D)
      </p>
      <div className="df-table-wrap">
        <table className="df-table">
          <thead>
            <tr>
              <th scope="col">Locality</th>
              <th scope="col" className="num">{lastName(race.rep.name)}</th>
              <th scope="col" className="num">{lastName(race.dem.name)}</th>
              <th scope="col" className="num df-col-total">Total</th>
              <th scope="col" className="num">Margin</th>
            </tr>
          </thead>
          <tbody>
            {race.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className="num">{fmt(r.rep)}<Star on={r.estimated} /></td>
                <td className="num">{fmt(r.dem)}<Star on={r.estimated} /></td>
                <td className="num df-col-total">{fmt(r.total)}<Star on={r.estimated} /></td>
                <td className="num"><MarginPill m={r.margin} estimated={r.estimated} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">VA-02</th>
              <td className="num">{fmt(race.district.rep)}<Star on={race.district.estimated} /></td>
              <td className="num">{fmt(race.district.dem)}<Star on={race.district.estimated} /></td>
              <td className="num df-col-total">{fmt(race.district.total)}<Star on={race.district.estimated} /></td>
              <td className="num"><MarginPill m={race.district.margin} estimated={race.district.estimated} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {est.length > 0 && (
        <p className="df-foot">
          * Includes estimated votes ({est.map((r) => `${r.label.replace("†", "")} ${fmt(r.estimatedVotes)}`).join(", ")}).
          District 2’s share of {race.estimateKinds.join(" and ")} is estimated from the 2024 U.S. House vote.
        </p>
      )}
    </div>
  );
}

export default function DistrictFundamentals() {
  return (
    <section className="df" aria-labelledby="df-title">
      <header className="df-head">
        <div className="df-kicker">District Fundamentals</div>
        <h2 id="df-title">How VA-02 has voted</h2>
        <p>
          Recent results inside today’s district lines, by locality. Totals include third-party and
          write-in votes.
        </p>
      </header>

      <MarginChart />

      <div className="df-tables">
        {RACES.map((r) => <RaceTable key={r.id} race={r} />)}
      </div>

      <p className="df-foot df-source">
        † District 2 portion only: precincts that voted in the 2024 U.S. House District 2 race.
        Source: Virginia Department of Elections, historical elections database.
      </p>
    </section>
  );
}
