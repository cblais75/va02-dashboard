import { useEffect, useState } from "react";

// Today's calendar date in Virginia, as "YYYY-MM-DD".
export function todayET(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

const toUTC = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// Whole calendar days from a to b (both "YYYY-MM-DD").
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);

export function formatDate(ymd, opts = { month: "short", day: "numeric" }) {
  return new Date(toUTC(ymd)).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

// Re-renders once a minute so "today" rolls over at midnight Eastern.
export function useTodayET() {
  const [today, setToday] = useState(todayET);
  useEffect(() => {
    const id = setInterval(() => setToday(todayET()), 60000);
    return () => clearInterval(id);
  }, []);
  return today;
}
