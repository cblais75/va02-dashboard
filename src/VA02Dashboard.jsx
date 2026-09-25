import React from "react";
import RaceOverview from "./RaceOverview.jsx";
import Fundraising from "./Fundraising.jsx";
import DistrictFundamentals from "./DistrictFundamentals.jsx";
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
      <DistrictFundamentals />
      <KeyDates />
    </main>
  );
}
