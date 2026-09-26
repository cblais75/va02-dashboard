import React, { useState } from "react";
import Takeaway from "./Takeaway.jsx";
import media from "../data/media.json";
import manual from "../data/manual.json";
import { BLUE, RED } from "./theme.js";

const PARTY_COLOR = { R: RED, D: BLUE };
const SHOW = 12;
const TAG_LABEL = { endorse: "Endorsement", debate: "Debate", poll: "Poll" };

const people = Object.fromEntries(manual.candidates.map((c) => [c.id, c]));
const surname = (id) => people[id]?.name.split(" ").pop() || id;
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

// News coverage only; candidates' own official releases are counted separately.
const news = media.items.filter((x) => !x.official);
const official = media.items.filter((x) => x.official);

function Counts() {
  return (
    <>
    <div className="mm-counts">
      {manual.candidates.map((c) => {
        const mine = news.filter((x) => x.candidates.includes(c.id));
        return (
          <div key={c.id} className="df-card mm-count" style={{ boxShadow: `inset 0 3px 0 ${PARTY_COLOR[c.party]}` }}>
            <div className="ro-label">{c.name}</div>
            <div className="mm-count-num">{mine.length}</div>
            <div className="ro-meta">
              mentions in {media.window_days} days · {mine.filter((x) => x.local).length} local
            </div>
          </div>
        );
      })}
    </div>
    {official.length > 0 && (
      <p className="mm-official-count">
        <strong>Official releases:</strong> {official.length} from {[...new Set(official.map((x) => x.outlet_domain))].join(", ")} in {media.window_days} days, not counted above.
      </p>
    )}
    </>
  );
}

export default function MediaMentions() {
  const [view, setView] = useState("all"); // all | local | official
  const [showAll, setShowAll] = useState(false);
  const items = view === "official" ? official : news.filter((x) => view === "all" || x.local);
  const shown = showAll ? items : items.slice(0, SHOW);
  const updated = new Date(media.updated_at).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  });

  return (
    <section className="mm" aria-labelledby="mm-title">
      <header className="df-head fr-head">
        <div>
          <div className="df-kicker">Media Mentions</div>
          <h2 id="mm-title">In the news</h2>
        </div>
        <p className="fr-updated">
          Updated {updated} · Source: <a href="https://news.google.com/" target="_blank" rel="noreferrer">Google News</a>
        </p>
      </header>
      <Takeaway section="media_mentions" />

      <Counts />

      <div className="df-card">
        <div className="mm-bar">
          <div className="lm-seg" role="group" aria-label="Outlets">
            <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>All</button>
            <button type="button" aria-pressed={view === "local"} onClick={() => setView("local")}>Local only</button>
            {official.length > 0 && (
              <button type="button" aria-pressed={view === "official"} onClick={() => setView("official")}>Official</button>
            )}
          </div>
          <span className="mm-shown">{items.length} {items.length === 1 ? "story" : "stories"}</span>
        </div>

        {items.length === 0 ? (
          <div className="ro-empty">No {view === "local" ? "local " : view === "official" ? "official " : ""}stories in the last {media.window_days} days</div>
        ) : (
          <ul className="mm-list">
            {shown.map((x) => (
              <li key={x.id} className={x.local ? "is-local" : ""}>
                <div className="mm-meta">
                  <span className="mm-date">{fmtDate(x.date)}</span>
                  <span className="mm-outlet">{x.outlet}</span>
                  {x.local && <span className="mm-local">Local</span>}
                  <span className="mm-who">
                    {x.candidates.map((id) => (
                      <span key={id}><i className="df-dot" style={{ background: colorOf(id) }} />{surname(id)}</span>
                    ))}
                  </span>
                </div>
                <a className="mm-headline" href={x.link} target="_blank" rel="noreferrer">{x.headline}</a>
                {x.tags.length > 0 && (
                  <div className="mm-tags">
                    {x.tags.map((t) => <span key={t} className={`mm-tag mm-tag-${t}`}>{TAG_LABEL[t]}</span>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {items.length > SHOW && (
          <button type="button" className="fr-more" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${items.length}`}
          </button>
        )}
        <p className="df-foot">
          Headlines from Google News searches for “Jen Kiggans” and “Elaine Luria” over the last {media.window_days} days;
          stories mentioning both count for both. Local: {media.local_outlets.join(", ")}. Candidates' own
          official releases ({(media.official_domains || []).join(", ")}) are listed under Official and not counted as coverage.
        </p>
      </div>
    </section>
  );
}

function colorOf(id) {
  return PARTY_COLOR[people[id]?.party] || "#8A97AD";
}
