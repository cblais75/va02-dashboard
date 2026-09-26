import React from "react";
import Takeaway from "./Takeaway.jsx";
import manual from "../data/manual.json";
import { daysBetween, formatDate, useTodayET } from "./dates.js";

export default function KeyDates() {
  const today = useTodayET();
  const dates = [...manual.key_dates].sort((a, b) => a.date.localeCompare(b.date));
  const next = dates.find((d) => d.date >= today);

  return (
    <section className="kd" aria-labelledby="kd-title">
      <header className="df-head">
        <div className="df-kicker">Key Dates</div>
        <h2 id="kd-title">Calendar to Election Day</h2>
      </header>
      <Takeaway section="key_dates" />

      <div className="df-card kd-card">
        <ol className="kd-list">
          {dates.map((d) => {
            const days = daysBetween(today, d.date);
            const state = d.date < today ? "is-past" : d === next ? "is-next" : "is-future";
            return (
              <li key={`${d.date}-${d.label}`} className={`kd-item ${state}`} aria-current={d === next ? "date" : undefined}>
                <span className="kd-marker" aria-hidden="true">{state === "is-past" ? "✓" : ""}</span>
                <span className="kd-date">{formatDate(d.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                <span className="kd-label">{d.label}</span>
                {d === next && (
                  <span className="kd-badge">{days === 0 ? "Today" : `Next · in ${days} ${days === 1 ? "day" : "days"}`}</span>
                )}
              </li>
            );
          })}
        </ol>
        {(manual.key_dates_notes || []).map((note) => (
          <p key={note} className="kd-note">
            <span className="kd-marker kd-marker-note" aria-hidden="true">i</span>
            {note}
          </p>
        ))}
      </div>
    </section>
  );
}
