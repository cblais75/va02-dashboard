import React, { useState } from "react";
import fec from "../data/fec.json";
import manual from "../data/manual.json";
import { BLUE, RED } from "./theme.js";
import { formatDate, todayET } from "./dates.js";

const PARTY_COLOR = { R: RED, D: BLUE };
const people = Object.fromEntries(manual.candidates.map((c) => [c.id, c]));
const surname = (id) => people[id]?.name.split(" ").pop() || id;
const colorOf = (id) => PARTY_COLOR[people[id]?.party] || "#8A97AD";

const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
function usdShort(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `$${Math.round(n / 1e3)}K`;
  return usd(n);
}

// 48-hour notices cover $1,000+ contributions received after the 20th day before the election.
const generalWindowStart = (() => {
  const [y, m, d] = manual.election_day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 19)).toISOString().slice(0, 10);
})();

const METRICS = [
  { key: "raised", label: "Raised" },
  { key: "spent", label: "Spent" },
  { key: "cash_on_hand", label: "Cash on hand" },
];

function CandidateMoney({ c, max }) {
  const color = colorOf(c.id);
  const t = c.totals;
  const speed = t.raised ? t.spent / t.raised : null;
  const r = c.latest_report;
  return (
    <div className="df-card fr-cand" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
      <div className="fr-cand-name">
        <i className="df-dot" style={{ background: color }} />
        {people[c.id]?.name || c.name}
      </div>
      <dl className="fr-metrics">
        {METRICS.map((m) => (
          <div key={m.key} className={`fr-metric${m.key === "cash_on_hand" ? " is-cash" : ""}`}>
            <dt>{m.label}</dt>
            <dd title={t[m.key] == null ? "" : usd(t[m.key])}>{t[m.key] == null ? "—" : usdShort(t[m.key])}</dd>
            <span className="fr-bar" aria-hidden="true">
              <span style={{ width: `${((t[m.key] || 0) / max[m.key]) * 100}%`, background: color }} />
            </span>
          </div>
        ))}
      </dl>
      <div className="fr-speed">
        <div className="fr-speed-label">Spending speed</div>
        <div className="fr-speed-value">{speed == null ? "—" : `${Math.round(speed * 100)}%`}</div>
        <div className="fr-speed-note">
          {speed == null ? "No money raised yet" : `Spent ${Math.round(speed * 100)}¢ of every $1 raised`}
        </div>
      </div>
      <div className="fr-report">
        {t.through && <>Through {formatDate(t.through)}</>}
        {r && (
          <>
            {" · "}
            {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name} report</a> : `${r.name} report`}
            {r.filed && <>, filed {formatDate(r.filed)}</>}
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ n }) {
  const [open, setOpen] = useState(false);
  const period = n.filed < generalWindowStart ? "Primary" : "General";
  return (
    <li className="fr-notice">
      <button type="button" className="fr-notice-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="fr-notice-date">{formatDate(n.filed)}</span>
        <span className="fr-notice-who">
          <i className="df-dot" style={{ background: colorOf(n.candidate) }} />
          {surname(n.candidate)}
          <span className="fr-tag">{period}</span>
        </span>
        <span className="fr-notice-total">{usd(n.total)}</span>
        <span className="fr-notice-count">
          {n.contributions.length} {n.contributions.length === 1 ? "gift" : "gifts"}
          <span className="fr-caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
        </span>
      </button>
      {open && (
        <ul className="fr-gifts">
          {n.contributions.map((g, i) => (
            <li key={i}>
              <span className="fr-gift-who">
                {g.contributor}
                <span>{[g.city, g.state].filter(Boolean).join(", ")}{g.occupation ? ` · ${g.occupation}` : ""}</span>
              </span>
              <span className="fr-gift-amt">{usd(g.amount)}<span>{formatDate(g.date)}</span></span>
            </li>
          ))}
          <li className="fr-gift-link"><a href={n.url} target="_blank" rel="noreferrer">View filing on FEC.gov</a></li>
        </ul>
      )}
    </li>
  );
}

function FortyEightHour() {
  const [showAll, setShowAll] = useState(false);
  const notices = fec.forty_eight_hour_reports;
  const shown = showAll ? notices : notices.slice(0, 6);
  const today = todayET();
  const windowNote =
    today < generalWindowStart
      ? `The general-election window opens ${formatDate(generalWindowStart)}; notices below are from the primary.`
      : "The general-election window is open.";
  return (
    <div className="df-card">
      <h3>48-hour reports</h3>
      <p className="df-sub">
        Contributions of $1,000 or more received in the last 20 days before an election must be reported within 48 hours.
        {" "}{windowNote}
      </p>
      {notices.length === 0 ? (
        <div className="ro-empty">No 48-hour reports filed yet</div>
      ) : (
        <>
          <ul className="fr-notices">{shown.map((n) => <Notice key={n.file_number} n={n} />)}</ul>
          {notices.length > 6 && (
            <button type="button" className="fr-more" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${notices.length} reports`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function OutsideSpending() {
  const { groups, by_candidate: totals } = fec.outside_spending;
  // Spending that helps the Republican: supporting the R or opposing the D (and vice versa).
  const helps = (g) => {
    const party = people[g.candidate]?.party;
    return g.support_oppose === "support" ? party : party === "R" ? "D" : "R";
  };
  return (
    <div className="df-card">
      <h3>Outside spending</h3>
      <p className="df-sub">Independent expenditures by groups not tied to a campaign, totaled by group.</p>
      <div className="fr-os-summary">
        {manual.candidates.map((c) => (
          <div key={c.id}>
            <i className="df-dot" style={{ background: colorOf(c.id) }} />
            <strong>{surname(c.id)}</strong>
            <span>{usd(totals[c.id]?.support || 0)} for · {usd(totals[c.id]?.oppose || 0)} against</span>
          </div>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="ro-empty">No outside spending reported yet</div>
      ) : (
        <div className="df-table-wrap">
          <table className="df-table fr-os-table">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Spending</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const color = helps(g) === "R" ? RED : BLUE;
                return (
                  <tr key={`${g.committee_id}-${g.candidate}-${g.support_oppose}`}>
                    <th scope="row" className="fr-os-group">{g.committee_name}</th>
                    <td>
                      <span className="fr-os-target" style={{ boxShadow: `inset 3px 0 0 ${color}`, background: `${color}26` }}>
                        {g.support_oppose === "support" ? "For" : "Against"} {surname(g.candidate)}
                      </span>
                    </td>
                    <td className="num">{usd(g.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="df-foot">{fec.outside_spending.note}</p>
    </div>
  );
}

export default function Fundraising() {
  const byId = Object.fromEntries(fec.candidates.map((c) => [c.id, c]));
  const ordered = manual.candidates.map((c) => byId[c.id]).filter(Boolean);
  const max = Object.fromEntries(METRICS.map((m) => [m.key, Math.max(1, ...ordered.map((c) => c.totals[m.key] || 0))]));
  const updated = new Date(fec.updated_at).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  });

  return (
    <section className="fr" aria-labelledby="fr-title">
      <header className="df-head fr-head">
        <div>
          <div className="df-kicker">Fundraising</div>
          <h2 id="fr-title">Money in the race</h2>
        </div>
        <p className="fr-updated">
          Updated {updated} · Source: <a href={fec.source_url} target="_blank" rel="noreferrer">FEC</a>
        </p>
      </header>

      <div className="fr-cands">
        {ordered.map((c) => <CandidateMoney key={c.id} c={c} max={max} />)}
      </div>
      <p className="df-foot fr-foot">
        {fec.cycle} cycle totals for each principal campaign committee. Raised includes transfers from other
        committees, such as joint fundraising committees and a candidate’s earlier campaign committee.
        Spending speed is spent ÷ raised.
      </p>

      <div className="fr-lower">
        <FortyEightHour />
        <OutsideSpending />
      </div>
    </section>
  );
}
