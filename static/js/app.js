// ============================================
// Santé — Voice Biomarker Platform
// Frontend logic for ASR + TTS
// ============================================

// ---------------------------------------------------------------------------
// ASR (Speech-to-Text)
// ---------------------------------------------------------------------------
const micBtn = document.getElementById("mic-btn");
const micRing = document.getElementById("mic-ring");
const micStatus = document.getElementById("mic-status");
const micTimerEl = document.getElementById("mic-timer");
const micTimerText = document.getElementById("mic-timer-text");
const transcriptBox = document.getElementById("transcript-box");
const transcriptContent = document.getElementById("transcript-content");
const asrError = document.getElementById("asr-error");

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isProcessing = false;
let timerInterval = null;
let seconds = 0;

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function startTimer() {
  seconds = 0;
  micTimerText.textContent = formatTime(seconds);
  micTimerEl.style.display = "flex";
  timerInterval = setInterval(() => {
    seconds++;
    micTimerText.textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  micTimerEl.style.display = "none";
}

function setMicState(state) {
  micBtn.className = "mic-btn";
  micRing.className = "mic-ring";
  asrError.className = "error-box";

  switch (state) {
    case "idle":
      micBtn.innerHTML = `<svg fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
      </svg>`;
      micStatus.textContent = "Click to start recording";
      break;

    case "recording":
      micBtn.classList.add("recording");
      micRing.classList.add("active");
      micBtn.innerHTML = `<svg fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>`;
      micStatus.textContent = "Recording — click to stop";
      break;

    case "processing":
      micBtn.classList.add("processing");
      micBtn.innerHTML = `<svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" opacity="0.2"/>
        <path d="M4 12a8 8 0 018-8" stroke-linecap="round"/>
      </svg>`;
      micStatus.textContent = "Transcribing with Whisper...";
      break;
  }
}

async function startRecording() {
  try {
    asrError.className = "error-box";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      await sendToASR(blob);
    };

    mediaRecorder.start();
    isRecording = true;
    setMicState("recording");
    startTimer();
  } catch {
    asrError.textContent =
      "Microphone access denied. Please allow microphone permissions.";
    asrError.className = "error-box visible";
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    isRecording = false;
    stopTimer();
    setMicState("processing");
  }
}

async function sendToASR(blob) {
  isProcessing = true;

  try {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    const res = await fetch("/api/asr", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Transcription failed");

    transcriptContent.textContent = data.text;
    transcriptBox.className = "transcript-box visible";
  } catch (err) {
    asrError.textContent = err.message || "Failed to transcribe audio";
    asrError.className = "error-box visible";
  } finally {
    isProcessing = false;
    setMicState("idle");
  }
}

micBtn.addEventListener("click", () => {
  if (isProcessing) return;
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ---------------------------------------------------------------------------
// TTS (Text-to-Speech)
// ---------------------------------------------------------------------------
const ttsTextarea = document.getElementById("tts-text");
const ttsVoice = document.getElementById("tts-voice");
const ttsSpeakBtn = document.getElementById("tts-speak-btn");
const ttsBtnLabel = document.getElementById("tts-btn-label");
const playbackIndicator = document.getElementById("playback-indicator");
const ttsError = document.getElementById("tts-error");

let ttsAudio = new Audio();
let ttsLoading = false;

function updateSpeakBtn() {
  ttsSpeakBtn.disabled = !ttsTextarea.value.trim() || ttsLoading;
}

ttsTextarea.addEventListener("input", updateSpeakBtn);

ttsAudio.addEventListener("play", () => {
  playbackIndicator.className = "playback-indicator visible";
});

ttsAudio.addEventListener("ended", () => {
  playbackIndicator.className = "playback-indicator";
});

ttsAudio.addEventListener("pause", () => {
  playbackIndicator.className = "playback-indicator";
});

async function handleSpeak() {
  const text = ttsTextarea.value.trim();
  if (!text || ttsLoading) return;

  ttsLoading = true;
  ttsError.className = "error-box";
  ttsSpeakBtn.disabled = true;
  ttsBtnLabel.textContent = "Generating...";

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: ttsVoice.value }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || "Speech generation failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsAudio.src = url;
    ttsAudio.play();
  } catch (err) {
    ttsError.textContent = err.message || "Failed to generate speech";
    ttsError.className = "error-box visible";
  } finally {
    ttsLoading = false;
    ttsBtnLabel.textContent = "Speak";
    updateSpeakBtn();
  }
}

ttsSpeakBtn.addEventListener("click", handleSpeak);
