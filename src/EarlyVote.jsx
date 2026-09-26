import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Takeaway from "./Takeaway.jsx";
import ev from "../data/early_vote.json";
import { LOCALITY_LABELS } from "./results.js";

// Validated pair for the dark card surface; neither reads as a party color.
const C2026 = "#BE8A22";
const C2022 = "#8A7BCF";

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const short = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const label = (loc) => LOCALITY_LABELS[loc] || loc;
const sumDay = (byLoc, locs) => locs.reduce((s, l) => s + (byLoc[l] ? byLoc[l].in_person + byLoc[l].mail : 0), 0);

// Cumulative ballots by days before Election Day, for the given localities.
function cumulative(days, locs) {
  const out = new Map();
  let run = 0;
  for (const d of [...days].sort((a, b) => b.days_before - a.days_before)) {
    run += sumDay(d.by_locality, locs);
    out.set(d.days_before, run);
  }
  return out;
}
// Value of a cumulative series at `db` days before (carrying forward across gaps).
function at(series, db) {
  let v = 0;
  for (const [k, total] of series) if (k >= db) v = total;
  return v;
}

// Tag that sits beside each headline number while the data is sample.
const SampleTag = () => (ev.sample ? <span className="ev-sample-tag">Sample</span> : null);

const locs = ev.localities;
const cur = cumulative(ev.days, locs);
const today = Math.min(...ev.days.map((d) => d.days_before));
const cmp = ev.comparison || {};
const cmpSeries = cmp.basis === "daily" ? cumulative(cmp.days, locs) : null;

function byLocality() {
  return locs.map((loc) => {
    const mine = ev.days.reduce((s, d) => {
      const c = d.by_locality[loc];
      return c ? { in_person: s.in_person + c.in_person, mail: s.mail + c.mail } : s;
    }, { in_person: 0, mail: 0 });
    const total = mine.in_person + mine.mail;
    const prior = cmp.basis === "daily"
      ? at(cumulative(cmp.days, [loc]), today)
      : cmp.basis === "final_totals" ? cmp.final?.[loc] ?? null : null;
    return { loc, ...mine, total, prior, pct: prior ? total / prior : null };
  });
}

// Container width in pixels; measured before first paint so the chart never
// renders wider than a phone screen.
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.clientWidth);
  }, []);
  useEffect(() => {
    if (!ref.current) return;
    const measure = () => ref.current && setW(ref.current.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    window.addEventListener("resize", measure); // e.g. phone rotation
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, w];
}

function PaceChart() {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const h = width < 480 ? 220 : 260;
  const m = { top: 16, right: width < 480 ? 44 : 56, bottom: 34, left: 44 };
  const maxDb = Math.max(...ev.days.map((d) => d.days_before), ...(cmp.days || []).map((d) => d.days_before));
  const final2022 = cmpSeries ? at(cmpSeries, 0) : 0;
  const yMaxRaw = Math.max(final2022, at(cur, today)) * 1.05 || 10;
  const step = [1000, 2500, 5000, 10000, 25000, 50000].find((s) => yMaxRaw / s <= 5) || 100000;
  const yMax = Math.ceil(yMaxRaw / step) * step;
  const x = (db) => m.left + ((maxDb - db) / maxDb) * (width - m.left - m.right);
  const y = (v) => m.top + (1 - v / yMax) * (h - m.top - m.bottom);
  const line = (series, from, to) => {
    const pts = [];
    for (let db = from; db >= to; db--) pts.push(`${x(db).toFixed(1)},${y(at(series, db)).toFixed(1)}`);
    return `M${pts.join("L")}`;
  };
  const xTicks = [];
  for (let db = 42; db >= 0; db -= width < 480 ? 14 : 7) xTicks.push(db);
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const db = Math.round(maxDb - ((px - m.left) / (width - m.left - m.right)) * maxDb);
    setHover(Math.max(0, Math.min(maxDb, db)));
  };
  const curEnd = at(cur, today);

  return (
    <div className="ev-chart" ref={ref} style={width ? undefined : { height: h + 42 }}>
      {width > 0 && (<>
      <svg
        width={width}
        height={h}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${ev.sample ? "SAMPLE DATA, not real turnout. " : ""}Running total of early ballots: ${fmt(curEnd)} so far in 2026${cmpSeries ? `, versus ${fmt(at(cmpSeries, today))} at the same point in 2022` : ""}.`}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} className="ev-grid" />
            <text x={m.left - 6} y={y(v) + 4} textAnchor="end" className="ev-axis">{short(v)}</text>
          </g>
        ))}
        {xTicks.map((db) => (
          <text key={db} x={x(db)} y={h - 14} textAnchor="middle" className="ev-axis">{db === 0 ? "E-Day" : db}</text>
        ))}
        <text x={(m.left + width - m.right) / 2} y={h - 1} textAnchor="middle" className="ev-axis ev-axis-title">days before Election Day</text>

        {cmpSeries && <path d={line(cmpSeries, maxDb, 0)} className="ev-line" style={{ stroke: C2022 }} />}
        <path d={line(cur, maxDb, today)} className="ev-line" style={{ stroke: C2026 }} />

        {cmpSeries && (
          <>
            <circle cx={x(0)} cy={y(final2022)} r="4" fill={C2022} className="ev-dot" />
            <text x={x(0) + 8} y={y(final2022) + 4} className="ev-end">2022</text>
          </>
        )}
        <circle cx={x(today)} cy={y(curEnd)} r="4.5" fill={C2026} className="ev-dot" />
        <text x={x(today) + 8} y={y(curEnd) - 6} className="ev-end">2026</text>

        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={h - m.bottom} className="ev-cross" />
            {hover >= today && <circle cx={x(hover)} cy={y(at(cur, hover))} r="4" fill={C2026} className="ev-dot" />}
            {cmpSeries && <circle cx={x(hover)} cy={y(at(cmpSeries, hover))} r="4" fill={C2022} className="ev-dot" />}
          </g>
        )}
        {/* Drawn inside the chart so a cropped screenshot still says it's sample data. */}
        {ev.sample && (
          <g className="ev-watermark" pointerEvents="none" aria-hidden="true">
            <text
              x={(m.left + width - m.right) / 2}
              y={(m.top + h - m.bottom) / 2}
              transform={`rotate(-16 ${(m.left + width - m.right) / 2} ${(m.top + h - m.bottom) / 2})`}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.min(width * 0.2, 120)}
            >
              SAMPLE
            </text>
            <text x={width - m.right} y={m.top + 4} textAnchor="end" className="ev-watermark-tag">SAMPLE DATA · NOT REAL</text>
          </g>
        )}
      </svg>
      <div className="ev-readout" aria-live="polite">
        {hover == null ? (
          <span className="df-hint">Hover or tap the chart to compare a day.</span>
        ) : (
          <>
            <strong>{ev.sample ? "Sample · " : ""}{hover === 0 ? "Election Day" : `${hover} days before`}</strong>
            <span><i style={{ background: C2026 }} />2026 {hover >= today ? fmt(at(cur, hover)) : "—"}</span>
            {cmpSeries && <span><i style={{ background: C2022 }} />2022 {fmt(at(cmpSeries, hover))}</span>}
          </>
        )}
      </div>
      </>)}
    </div>
  );
}

export default function EarlyVote() {
  const rows = byLocality();
  const total = rows.reduce((s, r) => ({ in_person: s.in_person + r.in_person, mail: s.mail + r.mail, total: s.total + r.total, prior: (s.prior ?? 0) + (r.prior ?? 0) }), { in_person: 0, mail: 0, total: 0, prior: null });
  const pct = total.prior ? total.total / total.prior : null;
  const vs = cmp.basis === "daily" ? "2022 at this point" : cmp.basis === "final_totals" ? "2022 final" : null;
  const updated = new Date(ev.updated_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
  const lastDay = [...ev.days].sort((a, b) => b.date.localeCompare(a.date))[0]?.date;

  return (
    <section className="ev" aria-labelledby="ev-title">
      <header className="df-head fr-head">
        <div>
          <div className="df-kicker">Early Vote Tracker</div>
          <h2 id="ev-title">Early ballots cast</h2>
        </div>
        <p className="fr-updated">
          Updated {updated} · Source: <a href={ev.source_url} target="_blank" rel="noreferrer">
            {ev.sample ? "sample data" : "Va. Dept. of Elections"}
          </a>
        </p>
      </header>
      <Takeaway section="early_vote" />

      {ev.sample && (
        <div className="ev-banner" role="note">
          <strong>Sample data</strong> — this tracker runs on a campaign's own absentee file. Live public numbers coming soon.
        </div>
      )}

      <div className="df-card">
        <div className={`ev-stats${ev.sample ? " ev-sampled" : ""}`}>
          <div>
            <div className="ro-label">Ballots cast{ev.sample ? " (sample)" : ""}</div>
            <div className="ev-hero">{fmt(total.total)}<SampleTag /></div>
            <div className="ro-meta">
              {lastDay && <>through {new Date(lastDay + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })} · {today} days before Election Day</>}
            </div>
          </div>
          <div>
            <div className="ro-label">vs. {vs || "2022"}</div>
            <div className="ev-stat">{pct == null ? "—" : `${Math.round(pct * 100)}%`}<SampleTag /></div>
            <div className="ro-meta">{total.prior ? `${fmt(total.prior)} ballots in 2022` : "No 2022 comparison loaded"}</div>
          </div>
          <div>
            <div className="ro-label">In person · Mail</div>
            <div className="ev-stat">{fmt(total.in_person)} · {fmt(total.mail)}<SampleTag /></div>
            <div className="ro-meta">{total.total ? `${Math.round((total.in_person / total.total) * 100)}% in person` : ""}</div>
          </div>
        </div>

        <h3 className="ev-chart-title">Running total, 2026 vs. 2022 pace</h3>
        <div className="df-legend ev-legend">
          <span><i style={{ background: C2026 }} />2026</span>
          {cmpSeries && <span><i style={{ background: C2022 }} />2022 (same days before Election Day)</span>}
        </div>
        <PaceChart />

        <div className={`df-table-wrap ev-table-wrap${ev.sample ? " ev-sampled" : ""}`}>
          <table className="df-table">
            <thead>
              <tr>
                <th scope="col">Locality</th>
                <th scope="col" className="num ev-col-split">In person</th>
                <th scope="col" className="num ev-col-split">Mail</th>
                <th scope="col" className="num">2026</th>
                <th scope="col" className="num">{cmp.basis === "final_totals" ? "2022 final" : "2022"}</th>
                <th scope="col" className="num">Pace</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.loc}>
                  <th scope="row">{label(r.loc)}</th>
                  <td className="num ev-col-split">{fmt(r.in_person)}</td>
                  <td className="num ev-col-split">{fmt(r.mail)}</td>
                  <td className="num">{fmt(r.total)}</td>
                  <td className="num">{r.prior == null ? "—" : fmt(r.prior)}</td>
                  <td className="num">{r.pct == null ? "—" : `${Math.round(r.pct * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">VA-02</th>
                <td className="num ev-col-split">{fmt(total.in_person)}</td>
                <td className="num ev-col-split">{fmt(total.mail)}</td>
                <td className="num">{fmt(total.total)}</td>
                <td className="num">{total.prior == null ? "—" : fmt(total.prior)}</td>
                <td className="num">{pct == null ? "—" : `${Math.round(pct * 100)}%`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="df-foot">
          Pace = 2026 ballots so far as a share of {cmp.basis === "final_totals" ? "2022's final early vote" : `2022's ballots at the same number of days before Election Day (${today})`}.
          Counts early in-person ballots and returned mail ballots, one per voter, by the date received.
          † District 2 voters only.
        </p>
      </div>
    </section>
  );
}
