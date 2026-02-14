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

// --- State ---
let state = "idle"; // idle | connecting | active
let currentSegment = null;
let pc = null;
let dc = null;
let audioEl = null;
let localStream = null;
let isMuted = false;
let conversationLog = [];
let turnSequence = 0;

// Audio recording state (for stress analysis)
let mediaRecorder = null;
let recordedChunks = [];
let recStream = null; // separate clone so cleanup doesn't kill it

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
function updateMuteUI() {
  const micOn = muteBtn.querySelector(".mic-on");
  const micOff = muteBtn.querySelector(".mic-off");
  if (isMuted) {
    muteBtn.classList.add("muted");
    muteLabel.textContent = "Unmute";
    micOn.style.display = "none";
    micOff.style.display = "block";
  } else {
    muteBtn.classList.remove("muted");
    muteLabel.textContent = "Mute";
    micOn.style.display = "block";
    micOff.style.display = "none";
  }
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
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => { t.enabled = !isMuted; });
  updateMuteUI();
}

async function endSession() {
  const segment = currentSegment;

  // Stop recording BEFORE cleanup (cleanup kills the original stream)
  let audioBlob = null;
  if (segment === "stress") {
    console.log("[Santé] Stopping recording for stress analysis...");
    audioBlob = await stopRecording();
    console.log("[Santé] Audio blob:", audioBlob ? `${audioBlob.size} bytes` : "null");
  }

  cleanup();
  state = "idle";

  // If stress session with valid audio, show results overlay and analyze
  if (segment === "stress" && audioBlob && audioBlob.size > 500) {
    showResultsOverlay();
    runStressAnalysis(audioBlob);
  } else {
    showLanding();
  }
}

function cleanup() {
  if (dc) { dc.close(); dc = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (audioEl) { audioEl.srcObject = null; audioEl = null; }
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
  showLanding();
}

async function runStressAnalysis(audioBlob) {
  try {
    console.log(`[Santé] Uploading ${audioBlob.size} bytes to /api/analyze/stress`);

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

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

function showResults(data) {
  resultsLoading.style.display = "none";
  resultsError.style.display = "none";
  resultsContent.style.display = "";

  const isStressed = data.prediction === "STRESSED";

  // Icon
  resultsIcon.className = `results-icon ${isStressed ? "stressed" : "calm"}`;
  resultsIcon.innerHTML = isStressed
    ? '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    : '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  // Text
  resultsPrediction.textContent = isStressed ? "Stressed" : "Not Stressed";
  resultsPrediction.style.color = isStressed ? "var(--red)" : "var(--emerald)";
  resultsConfidence.textContent = `${data.confidence.toFixed(1)}% confidence`;

  // Bars (animate after a short delay)
  const calmPct = (data.not_stressed || 0).toFixed(1);
  const stressPct = (data.stressed || 0).toFixed(1);

  barCalm.style.width = "0%";
  barStress.style.width = "0%";
  valCalm.textContent = `${calmPct}%`;
  valStress.textContent = `${stressPct}%`;

  requestAnimationFrame(() => {
    setTimeout(() => {
      barCalm.style.width = `${calmPct}%`;
      barStress.style.width = `${stressPct}%`;
    }, 100);
  });
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
