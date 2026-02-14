import ScribbleWave from "@/components/landing/ScribbleWave";
import SegmentCard from "@/components/landing/SegmentCard";
import ImpactCard from "@/components/landing/ImpactCard";

const SpeechIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="24"
    height="24"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const HealthIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="24"
    height="24"
  >
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

const StressIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="24"
    height="24"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export default function HomePage() {
  return (
    <div className="app-bg">
      {/* Brand logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "14px",
          color: "var(--blue)",
          fontSize: "32px",
          fontWeight: 700,
          padding: "28px 8px 0",
          position: "relative",
          zIndex: 1,
          letterSpacing: "-0.5px",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          width="32"
          height="32"
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
            Your voice reveals more than words
          </h1>
        </section>

        {/* Segment cards */}
        <section style={{ marginBottom: "28px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "1.4px",
              marginBottom: "14px",
            }}
          >
            Start a Voice Session
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "18px",
            }}
          >
            <SegmentCard
              segment="speech"
              sessionNumber={1}
              title="Speech Patterns"
              description="Checks articulation, pacing, and speech stability from guided prompts."
              icon={SpeechIcon}
            />
            <SegmentCard
              segment="health"
              sessionNumber={2}
              title="General Health"
              description="Assesses breath support and vocal steadiness linked to overall health."
              icon={HealthIcon}
            />
            <SegmentCard
              segment="stress"
              sessionNumber={3}
              title="Stress & Wellness"
              description="Detects stress-related shifts in tone, rhythm, and speaking pattern."
              icon={StressIcon}
            />
          </div>
        </section>

        {/* Research impact */}
        <section style={{ marginBottom: "48px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "1.4px",
              marginBottom: "14px",
            }}
          >
            Clinical Signal Snapshot
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "14px",
            }}
          >
            <ImpactCard
              number="19×"
              title="CAD voice-pattern association"
              body="Observed in Mayo Clinic research when patients discussed emotionally charged experiences."
              source="Mayo Clinic"
              href="https://www.pfizer.com/news/articles/diagnosing_disease_by_voice"
            />
            <ImpactCard
              number="3"
              title="Core signal domains"
              body="Neurological motor speech, cardiorespiratory strain, and stress-affect vocal markers."
              source="Pfizer x MIT"
              href="https://www.pfizer.com/news/articles/diagnosing_disease_by_voice"
            />
            <ImpactCard
              number="1"
              title="Short voice session"
              body="A brief guided conversation can surface patterns often missed in casual listening."
              source="NIH"
              href="https://newsinhealth.nih.gov/2024/08/sound-check"
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
        </div>
      </div>
    </div>
  );
}
