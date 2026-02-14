// ============================================
// Santé — Voice Analysis Platform
// WebRTC Realtime API connection (ephemeral token)
// ============================================

const santeBtn = document.getElementById("sante-btn");
const btnLabel = document.getElementById("btn-label");
const btnContainer = document.getElementById("btn-container");
const statusEl = document.getElementById("status");
const transcriptArea = document.getElementById("transcript-area");
const transcriptScroll = document.getElementById("transcript-scroll");
const appEl = document.getElementById("app");
const controls = document.getElementById("controls");
const muteBtn = document.getElementById("mute-btn");
const muteLabel = document.getElementById("mute-label");
const stopBtn = document.getElementById("stop-btn");
const introEl = document.getElementById("intro");
const featuresEl = document.getElementById("features");
const howItWorksEl = document.getElementById("how-it-works");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = "idle"; // idle | connecting | active
let pc = null;
let dc = null;
let audioEl = null;
let localStream = null;
let isMuted = false;

// Transcript accumulators
let aiTranscriptBuffer = "";
let currentAiEntry = null;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function setState(newState) {
  state = newState;

  santeBtn.className = "sante-btn";
  btnContainer.className = "btn-container";
  statusEl.className = "status";
  appEl.className = "app";
  controls.className = "controls";

  switch (newState) {
    case "idle":
      btnLabel.textContent = "Santé";
      statusEl.textContent = "Tap to begin your voice analysis";
      transcriptArea.classList.remove("visible");
      introEl.classList.remove("hidden");
      featuresEl.classList.remove("hidden");
      howItWorksEl.classList.remove("hidden");
      isMuted = false;
      updateMuteUI();
      break;

    case "connecting":
      santeBtn.classList.add("connecting");
      btnLabel.textContent = "...";
      statusEl.textContent = "Connecting";
      introEl.classList.add("hidden");
      featuresEl.classList.add("hidden");
      howItWorksEl.classList.add("hidden");
      break;

    case "active":
      santeBtn.classList.add("active");
      btnContainer.classList.add("active");
      statusEl.classList.add("active");
      appEl.classList.add("active");
      controls.classList.add("visible");
      introEl.classList.add("hidden");
      featuresEl.classList.add("hidden");
      howItWorksEl.classList.add("hidden");
      btnLabel.textContent = "Santé";
      statusEl.textContent = "Session active";
      transcriptArea.classList.add("visible");
      break;
  }
}

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

    // Remote audio playback
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Local microphone
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc.addTrack(localStream.getTracks()[0]);

    // Data channel
    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", onDataChannelOpen);
    dc.addEventListener("message", onDataChannelMessage);

    // 3. SDP exchange directly with OpenAI
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
    // ignore non-JSON
  }
}

// ---------------------------------------------------------------------------
// Realtime events
// ---------------------------------------------------------------------------
function handleRealtimeEvent(event) {
  switch (event.type) {

    case "response.output_audio_transcript.delta":
      if (!currentAiEntry) {
        aiTranscriptBuffer = "";
        currentAiEntry = addTranscriptEntry("Santé", "");
      }
      aiTranscriptBuffer += event.delta || "";
      currentAiEntry.textContent = aiTranscriptBuffer;
      transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
      break;

    case "response.output_audio_transcript.done":
      currentAiEntry = null;
      aiTranscriptBuffer = "";
      break;

    case "conversation.item.input_audio_transcription.completed":
      if (event.transcript) {
        addTranscriptEntry("You", event.transcript);
      }
      break;

    case "session.created":
      console.log("Session created:", event.session?.id);
      break;

    case "error":
      console.error("Realtime error:", event.error);
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Mute / Unmute
// ---------------------------------------------------------------------------
function toggleMute() {
  if (!localStream) return;

  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });
  updateMuteUI();
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
// Event listeners
// ---------------------------------------------------------------------------
santeBtn.addEventListener("click", () => {
  if (state === "idle") {
    connect();
  }
  // When active, use the dedicated stop button instead
});

muteBtn.addEventListener("click", toggleMute);
stopBtn.addEventListener("click", disconnect);

window.addEventListener("beforeunload", cleanup);
