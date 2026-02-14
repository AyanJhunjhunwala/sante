// ============================================
// Santé — Voice AI Health Platform
// WebRTC Realtime API connection
// ============================================

const santeBtn = document.getElementById("sante-btn");
const btnLabel = document.querySelector(".btn-label");
const btnContainer = document.getElementById("btn-container");
const statusEl = document.getElementById("status");
const transcriptArea = document.getElementById("transcript-area");
const transcriptScroll = document.getElementById("transcript-scroll");
const appEl = document.querySelector(".app");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = "idle"; // idle | connecting | active
let pc = null;      // RTCPeerConnection
let dc = null;      // DataChannel
let audioEl = null;

// Transcript accumulators
let aiTranscriptBuffer = "";
let currentAiEntry = null;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setState(newState) {
  state = newState;

  // Button classes
  santeBtn.className = "sante-btn";
  btnContainer.className = "btn-container";
  statusEl.className = "status";
  appEl.className = "app";

  switch (newState) {
    case "idle":
      btnLabel.textContent = "Santé";
      statusEl.textContent = "Tap to begin your health consultation";
      transcriptArea.classList.remove("visible");
      break;

    case "connecting":
      santeBtn.classList.add("connecting");
      btnLabel.textContent = "...";
      statusEl.textContent = "Connecting";
      break;

    case "active":
      santeBtn.classList.add("active");
      btnContainer.classList.add("active");
      statusEl.classList.add("active");
      appEl.classList.add("active");
      btnLabel.textContent = "Santé";
      statusEl.textContent = "Listening — tap to end";
      transcriptArea.classList.add("visible");
      break;
  }
}

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
  transcriptScroll.scrollTop = transcriptScroll.scrollHeight;

  return textEl;
}

function clearTranscript() {
  transcriptScroll.innerHTML = "";
  aiTranscriptBuffer = "";
  currentAiEntry = null;
}

// ---------------------------------------------------------------------------
// WebRTC connection
// ---------------------------------------------------------------------------
async function connect() {
  setState("connecting");
  clearTranscript();

  try {
    // Create peer connection
    pc = new RTCPeerConnection();

    // Set up remote audio playback
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Add local microphone track
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(stream.getTracks()[0]);

    // Set up data channel for events
    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", onDataChannelOpen);
    dc.addEventListener("message", onDataChannelMessage);

    // Create SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Send to our backend, which forwards to OpenAI
    const resp = await fetch("/session", {
      method: "POST",
      body: offer.sdp,
      headers: { "Content-Type": "application/sdp" },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || "Failed to create session");
    }

    // Set remote SDP answer
    const sdp = await resp.text();
    await pc.setRemoteDescription({ type: "answer", sdp });

    setState("active");
  } catch (err) {
    console.error("Connection error:", err);
    statusEl.textContent = "Connection failed — tap to retry";
    cleanup();
    setState("idle");
  }
}

function onDataChannelOpen() {
  console.log("Data channel open");

  // Enable input audio transcription (not supported in initial session config)
  dc.send(JSON.stringify({
    type: "session.update",
    session: {
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
      },
    },
  }));
}

function onDataChannelMessage(e) {
  try {
    const event = JSON.parse(e.data);
    handleRealtimeEvent(event);
  } catch {
    // ignore non-JSON messages
  }
}

// ---------------------------------------------------------------------------
// Handle Realtime API events
// ---------------------------------------------------------------------------
function handleRealtimeEvent(event) {
  switch (event.type) {

    // AI is speaking — streaming transcript
    case "response.output_audio_transcript.delta":
      if (!currentAiEntry) {
        aiTranscriptBuffer = "";
        currentAiEntry = addTranscriptEntry("Santé", "");
      }
      aiTranscriptBuffer += event.delta || "";
      currentAiEntry.textContent = aiTranscriptBuffer;
      transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
      break;

    // AI finished this response
    case "response.output_audio_transcript.done":
      currentAiEntry = null;
      aiTranscriptBuffer = "";
      break;

    // User finished speaking — transcription
    case "conversation.item.input_audio_transcription.completed":
      if (event.transcript) {
        addTranscriptEntry("You", event.transcript);
      }
      break;

    // Session created
    case "session.created":
      console.log("Session created:", event.session?.id);
      break;

    // Error
    case "error":
      console.error("Realtime error:", event.error);
      break;

    default:
      // Log other events at debug level
      break;
  }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------
function disconnect() {
  cleanup();
  setState("idle");
}

function cleanup() {
  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.getSenders().forEach((sender) => {
      if (sender.track) sender.track.stop();
    });
    pc.close();
    pc = null;
  }
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl = null;
  }
  currentAiEntry = null;
  aiTranscriptBuffer = "";
}

// ---------------------------------------------------------------------------
// Button handler
// ---------------------------------------------------------------------------
santeBtn.addEventListener("click", () => {
  if (state === "idle") {
    connect();
  } else if (state === "active") {
    disconnect();
  }
  // ignore clicks while connecting
});

// Clean up on page unload
window.addEventListener("beforeunload", cleanup);
