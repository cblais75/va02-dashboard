import React from "react";

const styles = {
  page: {
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    boxSizing: "border-box",
    color: "#E8ECF4",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    textAlign: "center",
  },
  title: { fontSize: "clamp(28px, 6vw, 48px)", margin: "0 0 12px" },
  matchup: { fontSize: "clamp(18px, 3.5vw, 24px)", margin: "0 0 24px", color: "#AEB8CC" },
  soon: {
    fontSize: 14,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#7C879C",
    margin: 0,
  },
};

export default function VA02Dashboard() {
  return (
    <main style={styles.page}>
      <h1 style={styles.title}>VA-02 Race Dashboard</h1>
      <p style={styles.matchup}>Kiggans vs. Luria</p>
      <p style={styles.soon}>Coming soon</p>
    </main>
  );
}
