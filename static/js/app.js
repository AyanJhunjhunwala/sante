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

// -----------------------------------------------------------------------
// Landing: segment card click handlers
// -----------------------------------------------------------------------
document.querySelectorAll(".segment-card").forEach((card) => {
  card.addEventListener("click", () => {
    const seg = card.dataset.segment;
    if (seg) startSession(seg);
  });
});

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
  sessionStatus.textContent = "Session active — speak naturally";
  sessionStatus.classList.add("active");
  sessionControls.classList.add("visible");
  transcriptArea.classList.add("visible");
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
  console.log("Data channel open");
  dc.send(JSON.stringify({
    type: "session.update",
    session: {
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
    },
  }));
}

function onDCMessage(e) {
  try { handleEvent(JSON.parse(e.data)); } catch {}
}

// -----------------------------------------------------------------------
// Realtime events
// -----------------------------------------------------------------------
function handleEvent(ev) {
  switch (ev.type) {
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

    case "conversation.item.input_audio_transcription.completed":
      {
        const userText = (ev.transcript || "").trim();
        if (!userText) break;

        const lastTurn = conversationLog[conversationLog.length - 1];
        const isDuplicate =
          lastTurn
          && lastTurn.role === "user"
          && lastTurn.status === "final"
          && lastTurn.text === userText;

        if (!isDuplicate) {
          conversationLog.push(newTurn("user", userText, "final"));
          renderConversationLog();
        }
      }
      break;

    case "session.created":
      console.log("Session:", ev.session?.id);
      break;

    case "error":
      console.error("Realtime error:", ev.error);
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

function endSession() {
  cleanup();
  state = "idle";
  showLanding();
}

function cleanup() {
  if (dc) { dc.close(); dc = null; }
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (audioEl) { audioEl.srcObject = null; audioEl = null; }
  resetConversationLog();
}

// -----------------------------------------------------------------------
// Event listeners
// -----------------------------------------------------------------------
muteBtn.addEventListener("click", toggleMute);
stopBtn.addEventListener("click", endSession);
window.addEventListener("beforeunload", cleanup);
