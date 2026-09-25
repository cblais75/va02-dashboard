// Race results from data/va02_results.json, shaped for display.
import results from "../data/va02_results.json";

export const RACE_LABELS = {
  "2022-us-house-cd02": "2022 U.S. House",
  "2024-president": "2024 President",
  "2024-us-house-cd02": "2024 U.S. House",
  "2025-governor": "2025 Governor",
};

export const LOCALITY_LABELS = {
  "Virginia Beach City": "Virginia Beach",
  "Suffolk City": "Suffolk",
  "Franklin City": "Franklin city",
  "Isle of Wight County": "Isle of Wight",
  "Accomack County": "Accomack",
  "Northampton County": "Northampton",
  "Chesapeake City": "Chesapeake†",
  "Southampton County": "Southampton†",
};

export const fmt = (n) => n.toLocaleString("en-US");
const SURNAMES = { "Winsome Earle Sears": "Earle-Sears" };
export const lastName = (name) => SURNAMES[name] || name.replace(/,? (Jr\.|Sr\.|II|III|IV)$/, "").split(" ").pop();

// Margin = R share minus D share of all votes cast, in points.
function margin(row, rep, dem) {
  return ((row.votes[rep.name] - row.votes[dem.name]) / row.total) * 100;
}
export function marginLabel(m) {
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

export const RACES = results.races.map(prepare);
