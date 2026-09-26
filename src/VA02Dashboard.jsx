import React from "react";
import RaceOverview from "./RaceOverview.jsx";
import Fundraising from "./Fundraising.jsx";
import Endorsements from "./Endorsements.jsx";
import MediaMentions from "./MediaMentions.jsx";
import DistrictFundamentals from "./DistrictFundamentals.jsx";
import LocalityMap from "./LocalityMap.jsx";
import EarlyVote from "./EarlyVote.jsx";
import KeyDates from "./KeyDates.jsx";
import "./styles.css";

export default function VA02Dashboard() {
  return (
    <main className="page">
      <header className="masthead">
        <div className="kicker">VA-02 · Virginia’s 2nd District</div>
        <h1>VA-02 Race Dashboard</h1>
        <p className="matchup">Kiggans vs. Luria</p>
        <span className="soon">Live results coming soon</span>
      </header>
      <RaceOverview />
      <Fundraising />
      <Endorsements />
      <MediaMentions />
      <DistrictFundamentals />
      <LocalityMap />
      <EarlyVote />
      <KeyDates />
      <footer className="site-footer">
        <p>
          Built by Colin Blais · Custom race dashboards for campaigns ·{" "}
          <a href="mailto:cblais75@gmail.com">cblais75@gmail.com</a>
        </p>
        <a className="book-call" href="https://calendly.com/cblais75/30min" target="_blank" rel="noopener noreferrer">
          Book a call
        </a>
      </footer>
    </main>
  );
}
