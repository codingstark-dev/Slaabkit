const roomInput = document.getElementById("room");
const joinBtn = document.getElementById("join");
const callBtn = document.getElementById("call");
const hangupBtn = document.getElementById("hangup");
const debugTextInput = document.getElementById("debug-text");
const sendTextBtn = document.getElementById("send-text");
const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");

let ws = null;
let mediaStream = null;
let audioContext = null;
let mediaSource = null;
let processor = null;
let remotePlaybackNode = null;
let remotePlaybackQueue = Promise.resolve();
let connected = false;
let streaming = false;
let isPlayingRemoteAudio = false;
let sttMode = "unknown";
let speechRecognition = null;
let speechRecognitionEnabled = false;

const SAMPLE_RATE = 16000;
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

function log(msg) {
  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
  logsEl.appendChild(line);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function supportsMicrophoneCapture() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function supportsSpeechRecognition() {
  return typeof SpeechRecognitionApi === "function";
}

function shouldUseBrowserSpeechRecognition() {
  return sttMode !== "deepgram";
}

function updateButtons() {
  joinBtn.disabled = connected;
  callBtn.disabled = !(connected && !streaming);
  hangupBtn.disabled = !(connected && streaming);
  sendTextBtn.disabled = !connected;
}

function wsUrl(room) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/agent?room=${encodeURIComponent(room)}`;
}

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function floatToInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    out[i] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return out;
}

function int16ToFloat32(int16) {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    out[i] = int16[i] / 32768;
  }
  return out;
}

function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

async function ensureMedia() {
  if (!supportsMicrophoneCapture()) {
    throw new Error("Microphone capture is not available in this browser/context");
  }

  if (mediaStream) {
    return mediaStream;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  return mediaStream;
}

function teardownCaptureGraph() {
  if (processor) {
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {}
    processor = null;
  }

  if (mediaSource) {
    try {
      mediaSource.disconnect();
    } catch {}
    mediaSource = null;
  }
}

function stopSpeechRecognition() {
  if (!speechRecognition) {
    return;
  }
  speechRecognitionEnabled = false;
  try {
    speechRecognition.stop();
  } catch {}
}

function setupSpeechRecognition() {
  if (!shouldUseBrowserSpeechRecognition()) {
    speechRecognition = null;
    return;
  }

  if (!supportsSpeechRecognition()) {
    log("Browser speech recognition is unavailable. Use Send Text for transcript input.");
    speechRecognition = null;
    return;
  }

  if (speechRecognition) {
    return;
  }

  speechRecognition = new SpeechRecognitionApi();
  speechRecognition.lang = "en-US";
  speechRecognition.interimResults = false;
  speechRecognition.continuous = true;

  speechRecognition.onresult = (event) => {
    if (!connected || !streaming || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (isPlayingRemoteAudio) {
      return;
    }

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result || !result.isFinal) {
        continue;
      }

      const text = result[0]?.transcript?.trim();
      if (!text) {
        continue;
      }

      ws.send(JSON.stringify({ type: "text", text }));
    }
  };

  speechRecognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    log(`Speech recognition error: ${event.error}`);
  };

  speechRecognition.onend = () => {
    if (speechRecognitionEnabled && streaming) {
      try {
        speechRecognition.start();
      } catch {}
    }
  };
}

function startStreamingMicrophone() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (streaming) {
    return;
  }

  ensureMedia()
    .then((stream) => {
      if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
        streaming = false;
        return;
      }

      streaming = true;
      const ctx = ensureAudioContext();
      mediaSource = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(1024, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return;
        }
        if (!streaming) {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const pcm = floatToInt16(input);
        const bytes = new Uint8Array(pcm.buffer);

        ws.send(
          JSON.stringify({
            type: "audio",
            audio: toBase64(bytes),
          }),
        );
      };

      mediaSource.connect(processor);
      processor.connect(ctx.destination);

      setupSpeechRecognition();
      if (speechRecognition) {
        try {
          speechRecognitionEnabled = true;
          speechRecognition.start();
          log("Speech recognition started");
        } catch (error) {
          log(`Speech recognition start failed: ${describeError(error)}`);
        }
      }

      setStatus("Streaming to agent...");
      log("Microphone streaming started");
      updateButtons();
    })
    .catch((error) => {
      log(`Microphone error: ${describeError(error)}`);
      stopSpeechRecognition();
      setStatus("Microphone failed");
      streaming = false;
      updateButtons();
    });
}

function stopStreamingMicrophone() {
  if (!streaming) {
    return;
  }

  streaming = false;
  stopSpeechRecognition();
  teardownCaptureGraph();
  setStatus(connected ? "Connected" : "Idle");
  log("Microphone streaming stopped");
  updateButtons();
}

function enqueuePlaybackChunk(base64Audio) {
  const bytes = fromBase64(base64Audio);
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const floatData = int16ToFloat32(int16);

  remotePlaybackQueue = remotePlaybackQueue
    .catch(() => {})
    .then(async () => {
      const ctx = ensureAudioContext();
      if (!remotePlaybackNode) {
        remotePlaybackNode = ctx.createGain();
        remotePlaybackNode.connect(ctx.destination);
      }

      const buffer = ctx.createBuffer(1, floatData.length, SAMPLE_RATE);
      buffer.copyToChannel(floatData, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(remotePlaybackNode);
      isPlayingRemoteAudio = true;
      source.start();

      await new Promise((resolve) => {
        source.onended = () => {
          isPlayingRemoteAudio = false;
          resolve();
        };
      });
    });
}

function joinAgent() {
  const room = roomInput.value.trim() || "demo-room";

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  setStatus("Connecting...");
  log(`Connecting to agent room ${room}`);

  ws = new WebSocket(wsUrl(room));

  ws.onopen = () => {
    connected = true;
    joinBtn.disabled = true;
    setStatus("Connected");
    log("Agent socket connected");
    if (!supportsMicrophoneCapture()) {
      log("This environment does not support getUserMedia. Use Send Text to validate the pipeline.");
    }
    updateButtons();
  };

  ws.onclose = () => {
    connected = false;
    stopStreamingMicrophone();
    stopSpeechRecognition();
    setStatus("Disconnected");
    log("Agent socket closed");
    joinBtn.disabled = false;
    updateButtons();
  };

  ws.onerror = () => {
    log("Socket error. Check server output.");
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (error) {
      log(`Bad server message: ${describeError(error)}`);
      return;
    }

    if (msg.type === "ready") {
      log(`Session ready. clientId=${msg.clientId}`);
      return;
    }

    if (msg.type === "status") {
      log(msg.message);
      if (typeof msg.message === "string") {
        if (msg.message.startsWith("STT mode: deepgram")) {
          sttMode = "deepgram";
          stopSpeechRecognition();
          log("Using server-side Deepgram STT for microphone transcripts.");
        } else if (msg.message.startsWith("STT mode: browser")) {
          sttMode = "browser";
          log("Using browser speech recognition for transcripts.");
        }
      }
      return;
    }

    if (msg.type === "transcript") {
      log(`User: ${msg.text}`);
      return;
    }

    if (msg.type === "assistant-text") {
      log(`Assistant: ${msg.text}`);
      return;
    }

    if (msg.type === "audio") {
      enqueuePlaybackChunk(msg.audio);
      return;
    }

    if (msg.type === "latency") {
      log(`Latency llm=${Math.round(msg.llmLatency)}ms total=${Math.round(msg.totalLatency)}ms`);
      return;
    }

    if (msg.type === "clear") {
      log("Playback cleared");
      return;
    }

    if (msg.type === "pong") {
      return;
    }

    if (msg.type === "error") {
      log(`Server error: ${msg.message}`);
      setStatus("Error");
      return;
    }

    log(`Unhandled message type: ${msg.type}`);
  };
}

joinBtn.addEventListener("click", joinAgent);

callBtn.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (!supportsMicrophoneCapture()) {
    log("Microphone API unavailable. Use Send Text instead.");
    setStatus("Mic unavailable");
    return;
  }

  ws.send(JSON.stringify({ type: "start" }));
  startStreamingMicrophone();
});

hangupBtn.addEventListener("click", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop" }));
  }
  stopStreamingMicrophone();
});

sendTextBtn.addEventListener("click", () => {
  const text = debugTextInput.value.trim();
  if (!text) {
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    log("Connect first before sending text");
    return;
  }

  ws.send(JSON.stringify({ type: "text", text }));
  log(`Debug text sent: ${text}`);
  if (sttMode === "deepgram") {
    log("Note: text debug is ignored in Deepgram STT mode.");
  }
  debugTextInput.value = "";
});

window.addEventListener("beforeunload", () => {
  stopSpeechRecognition();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop" }));
    ws.close();
  }
});

updateButtons();
