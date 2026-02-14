"use client";

interface ImpactCardProps {
  number: string;
  title: string;
  body: string;
  source: string;
  href: string;
}

export default function ImpactCard({
  number,
  title,
  body,
  source,
  href,
}: ImpactCardProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        background: "#ffffff",
        border: "1px solid var(--border)",
        borderRadius: "14px",
        padding: "18px",
        textDecoration: "none",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(59,130,246,0.28)";
        el.style.boxShadow = "var(--shadow-sm)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "var(--border)";
        el.style.boxShadow = "none";
      }}
    >
      <div
        style={{
          fontSize: "34px",
          fontWeight: 700,
          letterSpacing: "-1px",
          color: "var(--text)",
          lineHeight: 1.1,
          marginBottom: "6px",
        }}
      >
        {number}
      </div>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: "8px",
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: "12px",
          color: "var(--text-muted)",
          lineHeight: 1.6,
          margin: "0 0 10px",
        }}
      >
        {body}
      </p>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
        }}
      >
        {source}
      </span>
    </a>
  );
}
