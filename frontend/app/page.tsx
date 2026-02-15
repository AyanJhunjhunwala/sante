import ScribbleWave from "@/components/landing/ScribbleWave";
import TypewriterTagline from "@/components/landing/TypewriterTagline";
import HomepageAudioUpload from "@/components/landing/HomepageAudioUpload";
import SessionSummaryPanel from "@/components/summary/SessionSummaryPanel";
import {
  SUMMARY_PREVIEW_AI_SECTIONS,
  SUMMARY_PREVIEW_REPORT,
} from "@/lib/summaryPreviewData";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="app-bg">
      {/* Brand logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
          color: "var(--blue)",
          fontSize: "64px",
          fontWeight: 700,
          padding: "32px 4px 0",
          position: "relative",
          top: "20px",
          zIndex: 1,
          letterSpacing: "-0.5px",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="64"
          height="64"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
        <span>Santé</span>
      </div>

      {/* Scribble wave */}
      <div style={{ position: "relative", zIndex: 0 }}>
        <ScribbleWave />
      </div>

      {/* Main content */}
      <div
        style={{
          maxWidth: "1040px",
          margin: "0 auto",
          padding: "0 24px 72px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Hero */}
        <section
          style={{
            textAlign: "center",
            paddingBottom: "24px",
            position: "relative",
          }}
        >
          <TypewriterTagline />
        </section>

        {/* Session start */}
        <section style={{ marginBottom: "28px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: "14px",
              padding: "14px 0 8px",
            }}
          >
            <Link
              href="/session"
              className="start-conversation-orb"
              style={{
                width: "220px",
                height: "220px",
                borderRadius: "999px",
                background: "var(--blue)",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                textDecoration: "none",
                boxShadow: "0 18px 40px rgba(59,130,246,0.28)",
                border: "1px solid rgba(255,255,255,0.32)",
                transition: "transform 0.2s ease",
                fontWeight: 700,
                letterSpacing: "0.2px",
              }}
            >
              <span style={{ fontSize: "28px", lineHeight: 1 }}>Start</span>
              <span style={{ fontSize: "16px", opacity: 0.9, marginTop: "4px" }}>
                Conversation
              </span>
            </Link>
            <HomepageAudioUpload />
          </div>
        </section>

        <section style={{ marginBottom: "48px" }}>
          <div
            style={{
              background: "#ffffff",
              borderRadius: "22px",
              padding: "24px",
              border: "1px solid var(--border)",
              boxShadow: "0 16px 40px rgba(15,23,42,0.08)",
            }}
          >
            <SessionSummaryPanel
              report={SUMMARY_PREVIEW_REPORT}
              showCloseButton={false}
              autoGenerateAI={false}
              initialSections={SUMMARY_PREVIEW_AI_SECTIONS}
            />
          </div>
        </section>

        {/* Footer */}
        <div
          style={{
            borderTop: "1px solid var(--border-light)",
            paddingTop: "24px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-dim)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Santé is a research tool, not a medical device. Always consult a
            healthcare professional for medical advice.
          </p>

          <div
            style={{
              marginTop: "12px",
              fontSize: "10px",
              color: "var(--text-dim)",
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: 0 }}>
              Research context: voice biomarkers may reflect cardiometabolic, neurological, and stress-linked changes in speech.
            </p>
            <p style={{ margin: 0 }}>
              Sources:
              {" "}
              <a
                href="https://www.pfizer.com/news/articles/diagnosing_disease_by_voice"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
              >
                Mayo Clinic / Pfizer feature
              </a>
              ,{" "}
              <a
                href="https://newsinhealth.nih.gov/2024/08/sound-check"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
              >
                NIH News in Health
              </a>
              , and industry-academic voice diagnostics studies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
