"use client";

import { useEffect, useRef } from "react";

const VIEW_W = 1800;
const VIEW_H = 200;
const N = 60;
const CURVE_TIGHTNESS = 0.4;
const SPEED = 1;
const AMP = 8;

interface LayerConfig {
  baseY: number;
  waveH: number;
  drift: number;
  pathIndex: number;
}

const LAYERS: LayerConfig[] = [
  { baseY: 85, waveH: 30, drift: 0.3, pathIndex: 0 },
  { baseY: 95, waveH: 25, drift: 0.22, pathIndex: 1 },
  { baseY: 105, waveH: 20, drift: 0.15, pathIndex: 2 },
];

interface Point {
  x: number;
  y: number;
  oy: number;
  phase: number;
}

function catmullRomToBezier(points: Point[]): string {
  if (points.length < 2) return "";
  const d: string[] = [];
  d.push(`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`);

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) * CURVE_TIGHTNESS;
    const cp1y = p1.y + (p2.y - p0.y) * CURVE_TIGHTNESS;
    const cp2x = p2.x - (p3.x - p1.x) * CURVE_TIGHTNESS;
    const cp2y = p2.y - (p3.y - p1.y) * CURVE_TIGHTNESS;

    d.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }

  return d.join(" ");
}

export default function ScribbleWave() {
  const path1Ref = useRef<SVGPathElement>(null);
  const path2Ref = useRef<SVGPathElement>(null);
  const path3Ref = useRef<SVGPathElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  const pathRefs = [path1Ref, path2Ref, path3Ref];

  useEffect(() => {
    // Generate points for each layer
    const layerPoints: Point[][] = LAYERS.map((layer) => {
      const pts: Point[] = [];
      for (let i = 0; i < N; i++) {
        const xN = i / (N - 1);
        const x = -100 + xN * (VIEW_W + 300);
        pts.push({
          x,
          y: layer.baseY,
          oy: layer.baseY,
          phase: Math.random() * Math.PI * 2,
        });
      }
      return pts;
    });

    const animate = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const t = ((now - startRef.current) / 1000) * SPEED;

      LAYERS.forEach((layer, li) => {
        const pts = layerPoints[li];
        const pathEl = pathRefs[li].current;
        if (!pathEl) return;

        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const xN = i / (pts.length - 1);
          const flow = t * layer.drift * 6;
          const wiggle =
            Math.sin(flow + xN * 8 + p.phase) * AMP +
            Math.sin(flow * 1.7 + xN * 4) * AMP * 0.5 +
            Math.sin(t * 0.5 + p.phase * 0.7) * AMP * 0.25;
          const arch = Math.sin(xN * Math.PI) * layer.waveH;
          p.y = p.oy + arch + wiggle;
        }

        pathEl.setAttribute("d", catmullRomToBezier(pts));
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        left: "50%",
        transform: "translateX(-50%)",
        width: "100vw",
        height: "140px",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      <svg
        viewBox="0 0 1800 200"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          ref={path1Ref}
          fill="none"
          stroke="var(--scribble-color)"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.05"
        />
        <path
          ref={path2Ref}
          fill="none"
          stroke="var(--scribble-color)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.09"
        />
        <path
          ref={path3Ref}
          fill="none"
          stroke="var(--scribble-color)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.16"
        />
      </svg>
    </div>
  );
}
