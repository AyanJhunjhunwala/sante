// ============================================
// Santé — Voice AI Health Platform
// WebRTC Realtime API connection (ephemeral token)
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
let localStream = null;

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
// WebRTC connection (ephemeral token flow)
// ---------------------------------------------------------------------------
async function connect() {
  setState("connecting");
  clearTranscript();

  try {
    // 1. Get ephemeral token from our backend
    const tokenResp = await fetch("/token");
    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      throw new Error(err || "Failed to get session token");
    }
    const tokenData = await tokenResp.json();
    const ephemeralKey = tokenData.value;

    if (!ephemeralKey) {
      throw new Error("No ephemeral key returned from server");
    }

    // 2. Create peer connection
    pc = new RTCPeerConnection();

    // Set up remote audio playback
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Add local microphone track
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(localStream.getTracks()[0]);

    // Set up data channel for events
    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", onDataChannelOpen);
    dc.addEventListener("message", onDataChannelMessage);

    // 3. Create SDP offer and send directly to OpenAI
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

    if (!sdpResp.ok) {
      const errText = await sdpResp.text();
      throw new Error(`OpenAI SDP error: ${errText}`);
    }

    // 4. Set remote SDP answer
    const sdpAnswer = await sdpResp.text();
    await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });

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

  // Enable input audio transcription
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
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
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
