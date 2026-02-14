// ============================================
// Santé — Voice Health Analysis
// 3-segment voice analysis with OpenAI Realtime
// ============================================

// --- DOM refs ---
const appEl = document.getElementById("app");
const landing = document.getElementById("landing");
const sessionView = document.getElementById("session-view");
const sessionHeader = document.getElementById("session-header");
const shLabel = document.getElementById("sh-label");
const btnContainer = document.getElementById("btn-container");
const orbLabel = document.getElementById("orb-label");
const sessionStatus = document.getElementById("session-status");
const sessionCountdown = document.getElementById("session-countdown");
const sessionControls = document.getElementById("session-controls");
const muteBtn = document.getElementById("mute-btn");
const muteLabel = document.getElementById("mute-label");
const stopBtn = document.getElementById("stop-btn");
const transcriptArea = document.getElementById("transcript-area");
const transcriptScroll = document.getElementById("transcript-scroll");

// Results overlay refs
const resultsOverlay = document.getElementById("results-overlay");
const resultsLoading = document.getElementById("results-loading");
const resultsContent = document.getElementById("results-content");
const resultsError = document.getElementById("results-error");
const resultsIcon = document.getElementById("results-icon");
const resultsPrediction = document.getElementById("results-prediction");
const resultsConfidence = document.getElementById("results-confidence");
const barCalm = document.getElementById("bar-calm");
const barStress = document.getElementById("bar-stress");
const valCalm = document.getElementById("val-calm");
const valStress = document.getElementById("val-stress");
const resultsErrorText = document.getElementById("results-error-text");
const resultsCloseBtn = document.getElementById("results-close-btn");
const resultsErrorClose = document.getElementById("results-error-close");

const SEGMENT_LABELS = {
  speech: "Speech Patterns",
  health: "General Health",
  stress: "Stress & Wellness",
};

function formatRemainingTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// --- State ---
let state = "idle"; // idle | connecting | active
let currentSegment = null;
let pc = null;
let dc = null;
let audioEl = null;
let localStream = null;
let isMuted = false;
let aiSpeaking = false;
let userMutedBeforeAI = false; // remember if user was manually muted
let conversationLog = [];
let turnSequence = 0;
const SESSION_MAX_DURATION_MS = 60_000;
let sessionTimerTimeoutId = null;
let sessionTimerIntervalId = null;
let sessionDeadline = 0;
let isEndingSession = false;
let activeSummaryReport = null;

// Audio recording state (for stress analysis)
let mediaRecorder = null;
let recordedChunks = [];
let recStream = null; // separate clone so cleanup doesn't kill it

// -----------------------------------------------------------------------
// Scribble animation (hero visual — infinite flowing wave)
// -----------------------------------------------------------------------
(function initScribble() {
  const scribbleSvg = document.getElementById("scribbleSvg");
  if (!scribbleSvg) return;

  const paths = [
    document.getElementById("scribblePath1"),
    document.getElementById("scribblePath2"),
    document.getElementById("scribblePath3"),
  ];

  const viewW = 1800;
  const viewH = 200;
  const N = 60;               // many points for smooth flowing curve
  const curveTightness = 0.4;

  const css = getComputedStyle(document.documentElement);
  const SPEED = parseFloat(css.getPropertyValue("--scribble-speed")) || 1;
  const AMP   = parseFloat(css.getPropertyValue("--scribble-amplitude")) || 8;

  // Three stroke layers at different vertical positions
  const layers = [
    { baseY: 85,  waveH: 30, drift: 0.30, path: paths[0] },
    { baseY: 95,  waveH: 25, drift: 0.22, path: paths[1] },
    { baseY: 105, waveH: 20, drift: 0.15, path: paths[2] },
  ];

  // Generate base points for each layer — spanning beyond viewport edges
  layers.forEach((layer) => {
    layer.pts = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = -100 + t * (viewW + 200);  // extend past edges
      layer.pts.push({
        x,
        y: layer.baseY,
        oy: layer.baseY,
        phase: Math.random() * Math.PI * 2,
      });
    }
  });

  function catmullRomToBezier(points) {
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) * curveTightness / 6;
      const c1y = p1.y + (p2.y - p0.y) * curveTightness / 6;
      const c2x = p2.x - (p3.x - p1.x) * curveTightness / 6;
      const c2y = p2.y - (p3.y - p1.y) * curveTightness / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  }

  let start = performance.now();
  function animate(now) {
    const t = ((now - start) / 1000) * SPEED;

    layers.forEach((layer) => {
      for (let i = 0; i < layer.pts.length; i++) {
        const p = layer.pts[i];
        const xN = i / (layer.pts.length - 1);

        // Traveling wave: phase shifts with x so the wave flows horizontally
        const flow = t * layer.drift * 6;  // horizontal flow speed

        const wiggle =
          Math.sin(flow + xN * 8.0  + p.phase) * (AMP * 1.0) +
          Math.sin(flow * 1.7 + xN * 4.0) * (AMP * 0.5)  +
          Math.sin(t * 0.5 + p.phase * 0.7) * (AMP * 0.25);

        // Gentle large-scale arch across the full width
        const arch = Math.sin(xN * Math.PI) * layer.waveH;

        p.y = p.oy + arch + wiggle;
      }
      layer.path.setAttribute("d", catmullRomToBezier(layer.pts));
    });
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();

// -----------------------------------------------------------------------
// Landing: segment card click handlers
// -----------------------------------------------------------------------
document.querySelectorAll(".segment-card").forEach((card) => {
  card.addEventListener("click", () => {
    const seg = card.dataset.segment;
    if (seg) startSession(seg);
  });
});

// Results overlay close buttons
resultsCloseBtn.addEventListener("click", closeResults);
resultsErrorClose.addEventListener("click", closeResults);

// -----------------------------------------------------------------------
// UI transitions
// -----------------------------------------------------------------------
function showLanding() {
  landing.classList.remove("hidden");
  sessionView.classList.remove("active");
}

function showSession(segment) {
  landing.classList.add("hidden");
  sessionView.classList.add("active");
  shLabel.textContent = SEGMENT_LABELS[segment] || segment;
  sessionStatus.textContent = "Connecting...";
  sessionStatus.className = "session-status";
  sessionControls.className = "session-controls";
  btnContainer.className = "btn-container";
  transcriptArea.classList.remove("visible");
  resetConversationLog();
}

function setActive() {
  btnContainer.classList.add("active");
  sessionControls.classList.add("visible");
  transcriptArea.classList.add("visible");
  startSessionTimer();

  if (currentSegment === "stress") {
    sessionStatus.textContent = "Recording — speak naturally, click End Test when done";
    sessionStatus.classList.add("active");
  } else {
    sessionStatus.textContent = "Session active — speak naturally";
    sessionStatus.classList.add("active");
  }
}

// -----------------------------------------------------------------------
// Mute UI
// -----------------------------------------------------------------------
function setMuted(muted) {
  isMuted = muted;
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => { t.enabled = !isMuted; });
  }
  updateMuteUI();
}

function updateMuteUI() {
  const micOn = muteBtn.querySelector(".mic-on");
  const micOff = muteBtn.querySelector(".mic-off");
  if (isMuted) {
    muteBtn.classList.add("muted");
    muteLabel.textContent = aiSpeaking ? "Interrupt" : "Unmute";
    micOn.style.display = "none";
    micOff.style.display = "block";
  } else {
    muteBtn.classList.remove("muted");
    muteLabel.textContent = "Mute";
    micOn.style.display = "block";
    micOff.style.display = "none";
  }
}

function updateTurnUI() {
  if (aiSpeaking) {
    sessionStatus.textContent = "Santé is speaking — tap Interrupt to respond";
    sessionStatus.className = "session-status active ai-turn";
    btnContainer.classList.add("ai-speaking");
    btnContainer.classList.remove("user-speaking");
  } else {
    sessionStatus.textContent = "Your turn — speak naturally";
    sessionStatus.className = "session-status active user-turn";
    btnContainer.classList.remove("ai-speaking");
    btnContainer.classList.add("user-speaking");
  }
}

function onAISpeakStart() {
  if (aiSpeaking) return;
  aiSpeaking = true;
  userMutedBeforeAI = isMuted;
  // Auto-mute the mic so it doesn't pick up AI output
  if (!isMuted) setMuted(true);
  updateTurnUI();
  updateMuteUI();
}

function onAISpeakEnd() {
  if (!aiSpeaking) return;
  aiSpeaking = false;
  // Restore mic: unmute unless user had manually muted before
  if (!userMutedBeforeAI) setMuted(false);
  updateTurnUI();
  updateMuteUI();
}

function bargeIn() {
  // Cancel current AI response so user can speak
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ type: "response.cancel" }));
    console.log("[Santé] Barge-in: cancelled AI response");
  }
  aiSpeaking = false;
  setMuted(false);
  userMutedBeforeAI = false;
  updateTurnUI();
  updateMuteUI();
}

// -----------------------------------------------------------------------
// Transcript helpers
// -----------------------------------------------------------------------
function addTranscriptEntry(role, text) {
  const entry = document.createElement("div");
  entry.className = "t-entry";

  const roleEl = document.createElement("span");
  roleEl.className = `t-role ${role === "You" ? "user" : "ai"}`;
  roleEl.textContent = role;

  const textEl = document.createElement("span");
  textEl.className = "t-text";
  textEl.textContent = text;

  entry.appendChild(roleEl);
  entry.appendChild(textEl);
  transcriptScroll.appendChild(entry);
  return textEl;
}

function newTurn(role, text, status = "final") {
  return {
    id: ++turnSequence,
    role,
    text,
    status,
    createdAt: Date.now(),
    segment: currentSegment,
  };
}

function renderConversationLog() {
  transcriptScroll.innerHTML = "";
  conversationLog.forEach((turn) => {
    if (!turn.text) return;
    addTranscriptEntry(turn.role === "user" ? "You" : "Santé", turn.text);
  });
  transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
}

function resetConversationLog() {
  conversationLog = [];
  turnSequence = 0;
  renderConversationLog();
}

function updateSessionTimerVisual() {
  if (!sessionDeadline) {
    btnContainer.style.setProperty("--session-progress", "1");
    if (sessionCountdown) sessionCountdown.textContent = formatRemainingTime(SESSION_MAX_DURATION_MS);
    return;
  }

  const remainingMs = Math.max(0, sessionDeadline - Date.now());
  const progress = remainingMs / SESSION_MAX_DURATION_MS;
  btnContainer.style.setProperty("--session-progress", String(progress));
  if (sessionCountdown) sessionCountdown.textContent = formatRemainingTime(remainingMs);
}

function clearSessionTimer() {
  if (sessionTimerTimeoutId) {
    clearTimeout(sessionTimerTimeoutId);
    sessionTimerTimeoutId = null;
  }
  if (sessionTimerIntervalId) {
    clearInterval(sessionTimerIntervalId);
    sessionTimerIntervalId = null;
  }

  sessionDeadline = 0;
  btnContainer.classList.remove("timed-session");
  btnContainer.style.setProperty("--session-progress", "1");
  if (sessionCountdown) sessionCountdown.textContent = formatRemainingTime(SESSION_MAX_DURATION_MS);
}

function startSessionTimer() {
  clearSessionTimer();
  sessionDeadline = Date.now() + SESSION_MAX_DURATION_MS;
  btnContainer.classList.add("timed-session");
  updateSessionTimerVisual();

  sessionTimerIntervalId = setInterval(updateSessionTimerVisual, 100);
  sessionTimerTimeoutId = setTimeout(async () => {
    sessionStatus.textContent = "Session complete — ending...";
    await endSession();
  }, SESSION_MAX_DURATION_MS);
}

// -----------------------------------------------------------------------
// Audio recording (captures user mic for backend analysis)
// -----------------------------------------------------------------------
function startRecording(stream) {
  recordedChunks = [];

  // Clone so we have an independent stream (unaffected by mute / cleanup)
  recStream = stream.clone();

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  try {
    mediaRecorder = new MediaRecorder(recStream, { mimeType });
  } catch (err) {
    console.error("[Santé] MediaRecorder init failed:", err);
    mediaRecorder = null;
    return;
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
      console.log(`[Santé] Recorded chunk: ${e.data.size} bytes (total chunks: ${recordedChunks.length})`);
    }
  };

  mediaRecorder.onerror = (e) => {
    console.error("[Santé] MediaRecorder error:", e);
  };

  mediaRecorder.start(500); // collect every 500ms
  console.log("[Santé] MediaRecorder started, mimeType:", mimeType, "state:", mediaRecorder.state);
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder) {
      console.warn("[Santé] stopRecording: no mediaRecorder");
      resolve(null);
      return;
    }

    if (mediaRecorder.state === "inactive") {
      console.warn("[Santé] stopRecording: recorder already inactive, chunks:", recordedChunks.length);
      if (recordedChunks.length > 0) {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        recordedChunks = [];
        mediaRecorder = null;
        resolve(blob);
      } else {
        mediaRecorder = null;
        resolve(null);
      }
      return;
    }

    const mimeType = mediaRecorder.mimeType || "audio/webm";

    mediaRecorder.onstop = () => {
      console.log(`[Santé] MediaRecorder stopped. Chunks: ${recordedChunks.length}`);
      if (recordedChunks.length === 0) {
        mediaRecorder = null;
        resolve(null);
        return;
      }
      const blob = new Blob(recordedChunks, { type: mimeType });
      console.log(`[Santé] Created audio blob: ${blob.size} bytes, type: ${blob.type}`);
      recordedChunks = [];
      mediaRecorder = null;
      // Stop the cloned stream tracks
      if (recStream) {
        recStream.getTracks().forEach((t) => t.stop());
        recStream = null;
      }
      resolve(blob);
    };

    console.log("[Santé] Stopping MediaRecorder, current state:", mediaRecorder.state);
    mediaRecorder.stop();
  });
}

// -----------------------------------------------------------------------
// WebRTC session
// -----------------------------------------------------------------------
async function startSession(segment) {
  currentSegment = segment;
  state = "connecting";
  isMuted = false;
  updateMuteUI();
  showSession(segment);

  try {
    // 1. Get ephemeral token for this segment
    const tokenResp = await fetch(`/token/${segment}`);
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      throw new Error(err || "Failed to get token");
    }
    const tokenData = await tokenResp.json();
    const ephemeralKey = tokenData.value;
    if (!ephemeralKey) throw new Error("No ephemeral key returned");

    // 2. Peer connection
    pc = new RTCPeerConnection();

    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(localStream.getTracks()[0]);

    // Start recording the mic for stress analysis
    if (segment === "stress") {
      startRecording(localStream);
    }

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", onDCOpen);
    dc.addEventListener("message", onDCMessage);

    // 3. SDP exchange
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });

    if (!sdpResp.ok) throw new Error(await sdpResp.text());

    await pc.setRemoteDescription({ type: "answer", sdp: await sdpResp.text() });

    state = "active";
    setActive();
  } catch (err) {
    console.error("Connection error:", err);
    sessionStatus.textContent = "Connection failed — returning...";
    cleanup();
    setTimeout(showLanding, 1500);
    state = "idle";
  }
}

function onDCOpen() {
  console.log("[Santé] Data channel open");
}

function onDCMessage(e) {
  try {
    const ev = JSON.parse(e.data);
    handleEvent(ev);
  } catch (err) {
    console.error("[Santé] Error handling realtime event:", err, e.data);
  }
}

// -----------------------------------------------------------------------
// Realtime events
// -----------------------------------------------------------------------
function extractUserTranscript(ev) {
  if (typeof ev.transcript === "string") return ev.transcript;
  if (ev.content_part?.transcript) return ev.content_part.transcript;
  if (Array.isArray(ev.content)) {
    for (const c of ev.content) {
      if (c.transcript) return c.transcript;
    }
  }
  if (ev.part?.transcript) return ev.part.transcript;
  return "";
}

function appendUserTurn(text) {
  const userText = (text || "").trim();
  if (!userText) return;

  const lastTurn = conversationLog[conversationLog.length - 1];
  if (lastTurn && lastTurn.role === "user" && lastTurn.status === "final" && lastTurn.text === userText) {
    return;
  }

  conversationLog.push(newTurn("user", userText, "final"));
  renderConversationLog();
}

function handleEvent(ev) {
  switch (ev.type) {
    // ── AI transcript (streaming) ──
    case "response.audio_transcript.delta":
    case "response.output_audio_transcript.delta":
      if (!ev.delta) break;
      {
        let currentTurn = conversationLog[conversationLog.length - 1];
        if (!currentTurn || currentTurn.role !== "assistant" || currentTurn.status !== "draft") {
          currentTurn = newTurn("assistant", "", "draft");
          conversationLog.push(currentTurn);
        }
        currentTurn.text += ev.delta;
        renderConversationLog();
      }
      break;

    case "response.audio_transcript.done":
    case "response.output_audio_transcript.done":
      {
        for (let i = conversationLog.length - 1; i >= 0; i--) {
          const turn = conversationLog[i];
          if (turn.role === "assistant" && turn.status === "draft") {
            turn.status = "final";
            break;
          }
        }
        renderConversationLog();
      }
      break;

    // ── User transcript ──
    case "conversation.item.input_audio_transcription.completed":
      appendUserTurn(extractUserTranscript(ev));
      break;

    case "conversation.item.input_audio_transcription.failed":
      console.warn("[Santé] User transcription FAILED:", ev.error || ev);
      break;

    case "conversation.item.done":
      {
        const item = ev.item;
        if (item && item.role === "user" && Array.isArray(item.content)) {
          for (const part of item.content) {
            const t = part.transcript || part.text || "";
            if (t.trim()) {
              appendUserTurn(t);
              break;
            }
          }
        }
      }
      break;

    case "response.done":
      break;

    // ── Audio playback tracking (controls mute) ──
    case "output_audio_buffer.started":
      onAISpeakStart();
      break;

    case "output_audio_buffer.cleared":
    case "output_audio_buffer.stopped":
      onAISpeakEnd();
      break;

    case "session.created":
      console.log("[Santé] Session created:", ev.session?.id);
      break;

    case "session.updated":
      console.log("[Santé] Session config accepted");
      break;

    case "error":
      console.error("[Santé] Realtime error:", ev.error);
      break;

    default:
      break;
  }
}

// -----------------------------------------------------------------------
// Mute / Stop
// -----------------------------------------------------------------------
function toggleMute() {
  if (!localStream) return;

  if (aiSpeaking) {
    // User taps while AI is speaking → barge-in: cancel AI, unmute user
    bargeIn();
    return;
  }

  // Normal toggle
  setMuted(!isMuted);
  userMutedBeforeAI = isMuted;
}

async function endSession() {
  if (isEndingSession) return;
  isEndingSession = true;
  clearSessionTimer();

  const segment = currentSegment;
  const endedAt = Date.now();
  const userTranscription = conversationLog
    .filter((turn) => turn.role === "user" && turn.text)
    .map((turn) => turn.text)
    .join(" ");
  const aiTranscription = conversationLog
    .filter((turn) => turn.role === "assistant" && turn.text)
    .map((turn) => turn.text)
    .join(" ");
  const firstTurnAt = conversationLog.length > 0 ? conversationLog[0].createdAt : endedAt;
  const durationSeconds = Math.max(0, (endedAt - firstTurnAt) / 1000);

  // Stop recording BEFORE cleanup (cleanup kills the original stream)
  let audioBlob = null;
  if (segment === "stress") {
    console.log("[Santé] Stopping recording for stress analysis...");
    audioBlob = await stopRecording();
    console.log("[Santé] Audio blob:", audioBlob ? `${audioBlob.size} bytes` : "null");
  }

  cleanup();
  state = "idle";

  showResultsOverlay();
  runSessionSummary({
    segment,
    user_transcription: userTranscription,
    ai_transcription: aiTranscription,
    duration_seconds: durationSeconds,
  });

  isEndingSession = false;
}

function cleanup() {
  clearSessionTimer();
  if (dc) { dc.close(); dc = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (audioEl) { audioEl.srcObject = null; audioEl = null; }
  aiSpeaking = false;
  userMutedBeforeAI = false;
  isEndingSession = false;
  resetConversationLog();
}

// -----------------------------------------------------------------------
// Results overlay
// -----------------------------------------------------------------------
function showResultsOverlay() {
  sessionView.classList.remove("active");
  resultsLoading.style.display = "";
  resultsContent.style.display = "none";
  resultsError.style.display = "none";
  resultsOverlay.classList.add("visible");
}

function closeResults() {
  resultsOverlay.classList.remove("visible");
  activeSummaryReport = null;
  showLanding();
}

async function runStressAnalysis(audioBlob) {
  const loadingSub = document.getElementById("results-loading-sub");

  try {
    console.log(`[Santé] Uploading ${audioBlob.size} bytes to /api/analyze/stress`);
    if (loadingSub) loadingSub.textContent = "Uploading recording...";

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    if (loadingSub) loadingSub.textContent = "Running stress detection — warming up model, this may take up to a minute...";

    const resp = await fetch("/api/analyze/stress", {
      method: "POST",
      body: formData,
    });

    console.log("[Santé] Analysis response status:", resp.status);

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(errData.detail || "Analysis failed");
    }

    const data = await resp.json();
    console.log("[Santé] Analysis result:", data);
    showResults(data);
  } catch (err) {
    console.error("[Santé] Stress analysis error:", err);
    showResultsError(err.message || "Analysis failed. Please try again.");
  }
}

async function runSessionSummary(payload) {
  const loadingSub = document.getElementById("results-loading-sub");

  try {
    if (loadingSub) loadingSub.textContent = "Building biomarker summary...";

    const resp = await fetch("/api/session-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(errData.detail || "Summary generation failed");
    }

    const report = await resp.json();
    activeSummaryReport = report;
    showSummaryReport(report);
  } catch (err) {
    console.error("[Santé] Session summary error:", err);
    showResultsError(err.message || "Summary failed. Please try again.");
  }
}

function showSummaryReport(report) {
  resultsLoading.style.display = "none";
  resultsError.style.display = "none";
  resultsContent.style.display = "";

  const accent = report.executive_summary?.accent_prediction || "Unknown";
  const accentConf = (report.executive_summary?.accent_confidence || 0).toFixed(2);
  const stressBinary = String(report.content?.stress_binary || "no").toUpperCase();
  const userTx = report.content?.user_transcription || "";
  const phonemes = (report.content?.phonemes || []).slice(0, 24).join(" ");
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const aiSummary = report.ai_summary || "No summary available.";

  const metricsRows = metrics.map((m) => {
    const scorePct = Math.round((m.score || 0) * 100);
    const confPct = Math.round((m.confidence || 0) * 100);
    return `
      <div class="summary-metric-row">
        <span class="metric-name">${(m.name || "").replaceAll("_", " ")}</span>
        <span class="metric-score">Score ${scorePct}</span>
        <span class="metric-conf">Conf ${confPct}%</span>
      </div>
    `;
  }).join("");

  resultsContent.innerHTML = `
    <h2 class="summary-title">Session Summary</h2>
    <p class="summary-accent">Accent: <strong>${accent}</strong> (${accentConf})</p>

    <div class="summary-grid">
      <div class="summary-block">
        <h3>User Transcription</h3>
        <p>${userTx || "No user transcription captured."}</p>
      </div>
      <div class="summary-block">
        <h3>Phonemes (dummy)</h3>
        <p class="summary-phonemes">${phonemes || "N/A"}</p>
      </div>
      <div class="summary-block">
        <h3>Stress (binary)</h3>
        <p>${stressBinary}</p>
      </div>
    </div>

    <div class="summary-metrics">
      <h3>Signals</h3>
      ${metricsRows}
    </div>

    <div class="summary-ai-note">
      <h3>AI Summary</h3>
      <p>${aiSummary}</p>
    </div>

    <div class="summary-chat" id="summary-chat">
      <h3>Ask the summary AI</h3>
      <div class="summary-chat-log" id="summary-chat-log">
        <div class="summary-chat-msg ai">Ask about stress, accent, phonemes, or confidence.</div>
      </div>
      <div class="summary-chat-controls">
        <input id="summary-chat-input" type="text" placeholder="Ask about this report..." />
        <button id="summary-chat-send" class="results-close-btn" type="button">Send</button>
      </div>
    </div>

    <button class="results-close-btn summary-done-btn" id="summary-done-btn" type="button">Back to Home</button>
  `;

  const doneBtn = document.getElementById("summary-done-btn");
  const sendBtn = document.getElementById("summary-chat-send");
  const input = document.getElementById("summary-chat-input");

  if (doneBtn) doneBtn.addEventListener("click", closeResults);
  if (sendBtn) sendBtn.addEventListener("click", onSummaryChatSend);
  if (input) {
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") onSummaryChatSend();
    });
  }
}

async function onSummaryChatSend() {
  const input = document.getElementById("summary-chat-input");
  const log = document.getElementById("summary-chat-log");
  if (!input || !log || !activeSummaryReport) return;

  const message = input.value.trim();
  if (!message) return;

  const userMsg = document.createElement("div");
  userMsg.className = "summary-chat-msg user";
  userMsg.textContent = message;
  log.appendChild(userMsg);
  input.value = "";

  try {
    const resp = await fetch("/api/session-summary/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: activeSummaryReport, message }),
    });

    const data = await resp.json();
    const aiMsg = document.createElement("div");
    aiMsg.className = "summary-chat-msg ai";
    aiMsg.textContent = data.reply || "No reply.";
    log.appendChild(aiMsg);
  } catch {
    const aiMsg = document.createElement("div");
    aiMsg.className = "summary-chat-msg ai";
    aiMsg.textContent = "I couldn't answer that right now.";
    log.appendChild(aiMsg);
  }

  log.scrollTop = log.scrollHeight;
}

function showResultsError(message) {
  resultsLoading.style.display = "none";
  resultsContent.style.display = "none";
  resultsError.style.display = "";
  resultsErrorText.textContent = message;
}

// -----------------------------------------------------------------------
// Event listeners
// -----------------------------------------------------------------------
muteBtn.addEventListener("click", toggleMute);
stopBtn.addEventListener("click", endSession);
window.addEventListener("beforeunload", cleanup);
