"use client";

import { useEffect, useState, useRef } from "react";

const PREFIX = "Voice analysis for ";
const SUFFIXES = [
  "stress trends",
  "speech biomarkers",
  "structured screening",
  "more than just words",
];

const TYPING_SPEED = 90;       // ms per character typing
const DELETING_SPEED = 52;     // ms per character deleting
const HOLD_DURATION = 3000;    // ms to hold the full phrase
const PAUSE_BEFORE_TYPE = 600; // ms pause after deleting before typing next

export default function TypewriterTagline() {
  const [suffixIndex, setSuffixIndex] = useState(0);
  const [displayed, setDisplayed] = useState(SUFFIXES[0]);
  const [isDeleting, setIsDeleting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const suffix = SUFFIXES[suffixIndex];

    if (!isDeleting) {
      if (displayed.length < suffix.length) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(suffix.slice(0, displayed.length + 1));
        }, TYPING_SPEED);
      } else {
        timeoutRef.current = setTimeout(() => {
          setIsDeleting(true);
        }, HOLD_DURATION);
      }
    } else {
      if (displayed.length > 0) {
        timeoutRef.current = setTimeout(() => {
          setDisplayed(displayed.slice(0, -1));
        }, DELETING_SPEED);
      } else {
        timeoutRef.current = setTimeout(() => {
          setIsDeleting(false);
          setSuffixIndex((prev) => (prev + 1) % SUFFIXES.length);
        }, PAUSE_BEFORE_TYPE);
      }
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [displayed, isDeleting, suffixIndex]);

  return (
    <h1
      style={{
        fontSize: "clamp(28px, 5vw, 48px)",
        fontWeight: 700,
        color: "var(--text)",
        letterSpacing: "-0.03em",
        lineHeight: 1.15,
        margin: "0 0 8px",
      }}
    >
      <span>{PREFIX}</span>
      <br />
      <span style={{ display: "inline" }}>
        {displayed}
        <span
          style={{
            display: "inline-block",
            width: "4px",
            height: "1.05em",
            background: "var(--blue)",
            marginLeft: "3px",
            verticalAlign: "-0.12em",
            animation: "cursor-blink 0.75s steps(2) infinite",
          }}
        />
      </span>
      <style>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </h1>
  );
}
