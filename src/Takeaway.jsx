import React from "react";
import manual from "../data/manual.json";

// The "What this means" line under a section heading, from takeaways in
// data/manual.json. Nothing renders when the line is blank.
export default function Takeaway({ section }) {
  const text = manual.takeaways?.[section]?.trim();
  if (!text) return null;
  return (
    <p className="takeaway">
      <span className="takeaway-label">What this means</span>
      {text}
    </p>
  );
}
