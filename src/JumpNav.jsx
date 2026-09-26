import React, { useEffect, useRef, useState } from "react";

// Section ids and labels, in page order.
export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "money", label: "Money" },
  { id: "endorsements", label: "Endorsements" },
  { id: "media", label: "Media" },
  { id: "history", label: "History" },
  { id: "map", label: "Map" },
  { id: "early-vote", label: "Early Vote" },
  { id: "dates", label: "Dates" },
];

// Sticky "jump to" bar. Highlights the section currently under the bar.
export default function JumpNav() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const navRef = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      const barBottom = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= barBottom) current = s.id;
      }
      // The last sections may be too short to reach the bar; at the very bottom, pick the last one.
      setActive(atBottom ? SECTIONS[SECTIONS.length - 1].id : current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Keep the highlighted button visible when the bar scrolls sideways (phones).
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector(`[data-id="${active}"]`);
    if (!nav || !link) return;
    const left = link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active]);

  return (
    <nav className="jump-nav" ref={navRef} aria-label="Jump to section">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          data-id={s.id}
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => setActive(s.id)}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
