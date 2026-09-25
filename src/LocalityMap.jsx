import React, { useState } from "react";
import shapes from "../data/va02_map.json";
import { RACES, LOCALITY_LABELS, marginLabel } from "./results.js";

// Four steps per party, muted (close) to full party color (lopsided).
// Lightness rises evenly and matches across the two ramps.
const RAMP = {
  R: ["#5A4150", "#8C4755", "#C04F59", "#F2585B"],
  D: ["#394A6B", "#3B609C", "#3F79D0", "#4592F2"],
};
const MARGIN_BINS = [5, 10, 20]; // points: <5, 5-10, 10-20, 20+
const SHIFT_BINS = [4, 8, 12]; // points: <4, 4-8, 8-12, 12+

// Hand-placed label positions (viewBox units) where the automatic spot collides.
const LABEL_POS = {
  51175: [62, 655], // Southampton: above its northern tip
  51093: [245, 712], // Isle of Wight: upper, wider part of the county
};
const SHORT_RACE = {
  "2022-us-house-cd02": "’22 House",
  "2024-president": "’24 Pres.",
  "2024-us-house-cd02": "’24 House",
  "2025-governor": "’25 Gov.",
};

const SHIFT_FROM = "2024-us-house-cd02";
const SHIFT_TO = "2025-governor";

const short = (loc) => (LOCALITY_LABELS[loc] || loc).replace("†", "");
const step = (v, bins) => bins.filter((b) => Math.abs(v) >= b).length;
const colorFor = (v, bins) => RAMP[v > 0 ? "R" : "D"][step(v, bins)];

const raceById = Object.fromEntries(RACES.map((r) => [r.id, r]));
const rowOf = (raceId, loc) => raceById[raceId].rows.find((r) => r.key === loc);

// Everything the panel and map need for one locality (or the whole district).
function history(loc) {
  const pick = (race) => (loc ? race.rows.find((r) => r.key === loc) : race.district);
  const races = RACES.map((race) => ({ id: race.id, label: race.label, margin: pick(race).margin, estimated: pick(race).estimated }));
  const from = pick(raceById[SHIFT_FROM]), to = pick(raceById[SHIFT_TO]);
  return { races, shift: to.margin - from.margin, shiftEstimated: from.estimated || to.estimated };
}

const shiftLabel = (s) => (Math.abs(s) < 0.05 ? "No shift" : `${Math.abs(s).toFixed(1)} pts toward ${s > 0 ? "R" : "D"}`);
const Star = ({ on }) => (on ? <sup className="df-star">*</sup> : null);

function MiniBar({ m, domain = 35 }) {
  const w = Math.min(Math.abs(m), domain) / domain * 50;
  return (
    <span className="lm-mini" aria-hidden="true">
      <span className="lm-mini-zero" />
      <span className="lm-mini-bar" style={{ width: `${w}%`, [m > 0 ? "left" : "right"]: "50%", background: RAMP[m > 0 ? "R" : "D"][3] }} />
    </span>
  );
}

function Panel({ loc, mode, raceId }) {
  const h = history(loc);
  const partial = loc && shapes.localities.find((l) => l.locality === loc)?.partial;
  return (
    <div className="lm-panel" aria-live="polite">
      <div className="lm-panel-title">
        {loc ? short(loc) : "VA-02 (whole district)"}
        {partial && <span className="lm-tag">VA-02 portion only</span>}
      </div>
      {!loc && <div className="lm-hint">Tap or hover a locality to see how it voted.</div>}
      <ul className="lm-history">
        {h.races.map((r) => (
          <li key={r.id} className={mode === "margin" && r.id === raceId ? "is-current" : ""}>
            <span className="lm-h-race">{r.label}</span>
            <MiniBar m={r.margin} />
            <span className="lm-h-val">{marginLabel(r.margin)}<Star on={r.estimated} /></span>
          </li>
        ))}
      </ul>
      <div className={`lm-shift${mode === "shift" ? " is-current" : ""}`}>
        <span>Shift, 2024 House → 2025 Governor</span>
        <strong>{shiftLabel(h.shift)}<Star on={h.shiftEstimated} /></strong>
      </div>
    </div>
  );
}

function Legend({ mode }) {
  const bins = mode === "shift" ? SHIFT_BINS : MARGIN_BINS;
  const edges = ["<" + bins[0], `${bins[0]}–${bins[1]}`, `${bins[1]}–${bins[2]}`, `${bins[2]}+`];
  const side = (p) => (
    <div className="lm-legend-side">
      <span className="lm-legend-name">{mode === "shift" ? `Toward ${p}` : `${p} lead`}</span>
      <span className="lm-legend-steps">
        {RAMP[p].map((c, i) => (
          <span key={c}><i style={{ background: c }} />{edges[i]}</span>
        ))}
      </span>
    </div>
  );
  return (
    <div className="lm-legend">
      {side("D")}
      {side("R")}
      <span className="lm-legend-unit">points</span>
    </div>
  );
}

export default function LocalityMap() {
  const [raceId, setRaceId] = useState("2025-governor");
  const [mode, setMode] = useState("margin");
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const active = hovered || selected;

  const valueOf = (loc) =>
    mode === "shift" ? history(loc).shift : rowOf(raceId, loc).margin;
  const labelOf = (loc) => {
    const v = valueOf(loc);
    if (mode === "shift") return `${Math.abs(v).toFixed(1)} → ${v > 0 ? "R" : "D"}`;
    return marginLabel(v);
  };
  const estimatedOf = (loc) =>
    mode === "shift" ? history(loc).shiftEstimated : rowOf(raceId, loc).estimated;

  const [, , vbW, vbH] = shapes.viewBox.split(" ").map(Number);
  const pick = (loc) => setSelected(selected === loc ? null : loc);

  return (
    <section className="lm" aria-labelledby="lm-title">
      <header className="df-head">
        <div className="df-kicker">Locality Map</div>
        <h2 id="lm-title">Where the district leans</h2>
        <p>Each locality shaded by margin: red for Republican, blue for Democratic, stronger color for bigger margins.</p>
      </header>

      <div className="df-card">
        <div className="lm-controls">
          <div className="lm-seg" role="group" aria-label="View">
            <button type="button" aria-pressed={mode === "margin"} onClick={() => setMode("margin")}>Margin</button>
            <button type="button" aria-pressed={mode === "shift"} onClick={() => setMode("shift")}>Shift</button>
          </div>
          {mode === "margin" ? (
            <div className="lm-seg lm-races" role="group" aria-label="Race">
              {RACES.map((r) => (
                <button key={r.id} type="button" aria-pressed={raceId === r.id} onClick={() => setRaceId(r.id)}>
                  <span className="lm-long">{r.label.replace("U.S. ", "")}</span>
                  <span className="lm-short">{SHORT_RACE[r.id]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="lm-shift-caption">How far each locality moved from the 2024 House race to the 2025 Governor race</div>
          )}
        </div>

        <div className="lm-body">
          <div className="lm-map" onMouseLeave={() => setHovered(null)}>
            <svg viewBox={shapes.viewBox} role="img" aria-label={`Map of VA-02 localities, ${mode === "shift" ? "shift from 2024 House to 2025 Governor" : raceById[raceId].label + " margin"}`}>
              {shapes.localities.map((l) => (
                <path
                  key={l.geoid}
                  d={l.d}
                  fill={colorFor(valueOf(l.locality), mode === "shift" ? SHIFT_BINS : MARGIN_BINS)}
                  className={`lm-shape${active === l.locality ? " is-active" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${short(l.locality)}${l.partial ? ", VA-02 portion only" : ""}: ${labelOf(l.locality)}`}
                  onMouseEnter={() => setHovered(l.locality)}
                  onFocus={() => setHovered(l.locality)}
                  onBlur={() => setHovered(null)}
                  onClick={() => pick(l.locality)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(l.locality))}
                />
              ))}
              {/* Draw the active outline on top so its border isn't hidden by neighbors. */}
              {active && (
                <path d={shapes.localities.find((l) => l.locality === active).d} className="lm-outline" />
              )}
            </svg>
            {shapes.localities.map((l) => {
              const [lx, ly] = LABEL_POS[l.geoid] || l.label;
              return (
              <span
                key={l.geoid}
                className={`lm-label lm-label-${l.geoid}`}
                style={{ left: `${(lx / vbW) * 100}%`, top: `${(ly / vbH) * 100}%` }}
                aria-hidden="true"
              >
                <b>{short(l.locality)}{l.partial ? "†" : ""}</b>
                {labelOf(l.locality)}<Star on={estimatedOf(l.locality)} />
              </span>
              );
            })}
          </div>

          <div className="lm-side">
            <Panel loc={active} mode={mode} raceId={raceId} />
            <div className="lm-list" role="group" aria-label="Choose a locality">
              {shapes.localities.map((l) => (
                <button
                  key={l.geoid}
                  type="button"
                  aria-pressed={selected === l.locality}
                  onClick={() => pick(l.locality)}
                >
                  <i style={{ background: colorFor(valueOf(l.locality), mode === "shift" ? SHIFT_BINS : MARGIN_BINS) }} />
                  {short(l.locality)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Legend mode={mode} />
        <p className="df-foot">
          † VA-02 portion only: Chesapeake and Southampton are split between districts; the map and numbers cover only
          the part inside District 2. * Includes estimated votes (see District Fundamentals).
          Boundaries: U.S. Census Bureau, 2024 cartographic boundary files.
        </p>
      </div>
    </section>
  );
}
