"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Segment } from "@/lib/types";

interface SegmentCardProps {
  segment: Segment;
  sessionNumber: number;
  title: string;
  description: string;
  icon: ReactNode;
}

export default function SegmentCard({
  segment,
  sessionNumber,
  title,
  description,
  icon,
}: SegmentCardProps) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(`/session/${segment}`)}
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
        border: "1.5px solid rgba(59,130,246,0.18)",
        borderRadius: "20px",
        padding: "26px 24px 22px",
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition:
          "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
        width: "100%",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.transform = "translateY(-4px)";
        el.style.borderColor = "rgba(59,130,246,0.42)";
        el.style.boxShadow = "0 12px 32px rgba(59,130,246,0.16)";
        const cta = el.querySelector<HTMLElement>(".sc-cta");
        if (cta) {
          cta.style.background = "var(--blue-dark)";
          cta.style.transform = "translateX(2px)";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = "translateY(0)";
        el.style.borderColor = "rgba(59,130,246,0.18)";
        el.style.boxShadow = "none";
        const cta = el.querySelector<HTMLElement>(".sc-cta");
        if (cta) {
          cta.style.background = "var(--blue)";
          cta.style.transform = "translateX(0)";
        }
      }}
    >
      {/* Badge */}
      <div
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--blue)",
          textTransform: "uppercase",
          letterSpacing: "1.2px",
        }}
      >
        Session {sessionNumber}
      </div>

      {/* Icon container */}
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "14px",
          background: "var(--blue-soft)",
          color: "var(--blue)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      {/* Title */}
      <h3
        style={{
          fontSize: "17px",
          fontWeight: 600,
          color: "var(--text)",
          margin: 0,
          lineHeight: 1.3,
        }}
      >
        {title}
      </h3>

      {/* Description */}
      <p
        style={{
          fontSize: "13px",
          color: "var(--text-muted)",
          margin: 0,
          lineHeight: 1.6,
          flex: 1,
        }}
      >
        {description}
      </p>

      {/* CTA pill */}
      <div
        className="sc-cta"
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "var(--blue)",
          color: "#ffffff",
          borderRadius: "999px",
          padding: "8px 14px",
          fontSize: "13px",
          fontWeight: 500,
          alignSelf: "flex-start",
          transition: "background 0.2s ease, transform 0.2s ease",
          marginTop: "4px",
        }}
      >
        Start Session &rarr;
      </div>
    </button>
  );
}
