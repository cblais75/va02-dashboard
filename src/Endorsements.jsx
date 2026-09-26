import React, { useState } from "react";
import Takeaway from "./Takeaway.jsx";
import manual from "../data/manual.json";
import { BLUE, RED } from "./theme.js";
import { formatDate } from "./dates.js";

const GROUPS = [
  { type: "elected_official", label: "Elected officials" },
  { type: "party", label: "Party support" },
  { type: "union", label: "Unions" },
  { type: "organization", label: "Organizations & advocacy groups" },
  { type: "newspaper", label: "Newspapers" },
];
const PARTY_COLOR = { R: RED, D: BLUE };
const SHOW = 5; // names shown per column before "Show all"

const surname = (c) => c.name.split(" ").pop();
const list = manual.endorsements || [];
// Shown in the order they appear in data/manual.json.
const byCandidate = (id, type) => list.filter((e) => e.candidate === id && e.type === type);

function Column({ cand, items, expanded, emptyNote }) {
  const shown = expanded ? items : items.slice(0, SHOW);
  return (
    <div className="en-col">
      <div className="en-col-head">
        <span><i className="df-dot" style={{ background: PARTY_COLOR[cand.party] }} />{surname(cand)}</span>
        <span className="en-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="en-none">{emptyNote}</div>
      ) : (
        <ul className="en-list">
          {shown.map((e) => (
            <li key={e.name}>
              <a href={e.source} target="_blank" rel="noreferrer">{e.name}</a>
              {(e.title || e.date) && (
                <span>{[e.title, e.date && formatDate(e.date, { month: "short", day: "numeric", year: "numeric" })].filter(Boolean).join(" · ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Group({ g }) {
  const [expanded, setExpanded] = useState(false);
  const cols = manual.candidates.map((c) => ({ cand: c, items: byCandidate(c.id, g.type) }));
  const longest = Math.max(...cols.map((c) => c.items.length));
  const emptyNote = g.type === "newspaper" ? "None yet" : "None found";
  return (
    <div className="df-card en-group">
      <h3>{g.label}</h3>
      <div className="en-cols">
        {cols.map(({ cand, items }) => (
          <Column key={cand.id} cand={cand} items={items} expanded={expanded} emptyNote={emptyNote} />
        ))}
      </div>
      {longest > SHOW && (
        <button type="button" className="fr-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all (${longest})`}
        </button>
      )}
    </div>
  );
}

export default function Endorsements() {
  const checked = manual.endorsements_last_checked;
  return (
    <section className="en" aria-labelledby="en-title">
      <header className="df-head fr-head">
        <div>
          <div className="df-kicker">Endorsements</div>
          <h2 id="en-title">Who's backing whom</h2>
        </div>
        {checked && <p className="fr-updated">Last checked {formatDate(checked, { month: "short", day: "numeric", year: "numeric" })}</p>}
      </header>
      <Takeaway section="endorsements" />

      {/* One column per candidate: counts per group, then any note about that candidate. */}
      <div className="en-summary">
        {manual.candidates.map((c) => {
          const note = manual.endorsement_notes?.[c.id];
          return (
            <div key={c.id} className="df-card en-sum-card" style={{ boxShadow: `inset 0 3px 0 ${PARTY_COLOR[c.party]}` }}>
              <div className="en-sum-name">{c.name}</div>
              <dl className="en-sum-counts">
                {GROUPS.map((g) => (
                  <div key={g.type}>
                    <dt>{g.label}</dt>
                    <dd>{byCandidate(c.id, g.type).length}</dd>
                  </div>
                ))}
                <div className="en-sum-total">
                  <dt>Total</dt>
                  <dd>{list.filter((e) => e.candidate === c.id).length}</dd>
                </div>
              </dl>
              {note && <p className="en-note">{note}</p>}
            </div>
          );
        })}
      </div>

      <div className="en-groups">
        {GROUPS.map((g) => <Group key={g.type} g={g} />)}
      </div>
      <p className="df-foot">
        Only endorsements with a public source are listed: the campaign's site, the endorser's own announcement or a
        news story. Each name links to its source. Campaigns publicize endorsements differently, so counts reflect
        what's public, not total support.
      </p>
    </section>
  );
}
