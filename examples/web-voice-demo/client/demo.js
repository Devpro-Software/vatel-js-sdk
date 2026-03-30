import { Client, ConnectionState, Session, WebRTCSession } from "@vatel/sdk";
import { RoomEvent } from "livekit-client";

const SAMPLE_RATE = 24000;
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const agentInput = document.getElementById("agentId");
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");
const btnMic = document.getElementById("btnMic");

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function resampleLinear(input, inRate, outRate) {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

function floatToPcm16LE(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Int16Array(buf);
}

function pcm16ToBase64(samples) {
  const u8 = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToPcm16LE(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const samples = bytes.length >>> 1;
  const out = new Int16Array(samples);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

let session = null;
let playCtx = null;
let nextPlayTime = 0;
let micCtx = null;
let micSource = null;
let micProcessor = null;
let micStream = null;
let micOn = false;

function flushPlaybackSchedule() {
  if (playCtx) nextPlayTime = playCtx.currentTime;
}

function schedulePcm(int16) {
  if (!playCtx) return;
  const ch = playCtx.createBuffer(1, int16.length, SAMPLE_RATE);
  const data = ch.getChannelData(0);
  for (let i = 0; i < int16.length; i++) data[i] = int16[i] / 32768;
  const src = playCtx.createBufferSource();
  src.buffer = ch;
  src.connect(playCtx.destination);
  const startAt = Math.max(nextPlayTime, playCtx.currentTime);
  src.start(startAt);
  nextPlayTime = startAt + ch.duration;
}

function stopMic() {
  micOn = false;
  btnMic.textContent = "Start microphone";
  if (micProcessor) {
    try {
      micProcessor.disconnect();
    } catch (_) {}
    micProcessor.onaudioprocess = null;
    micProcessor = null;
  }
  if (micSource) {
    try {
      micSource.disconnect();
    } catch (_) {}
    micSource = null;
  }
  if (micCtx) {
    try {
      micCtx.close();
    } catch (_) {}
    micCtx = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}

async function startMic() {
  if (!session || session.state !== "open") return;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micCtx = new AudioContext();
  const inRate = micCtx.sampleRate;
  micSource = micCtx.createMediaStreamSource(micStream);
  const bufferSize = 4096;
  micProcessor = micCtx.createScriptProcessor(bufferSize, 1, 1);
  micProcessor.onaudioprocess = (e) => {
    if (!micOn || !session || session.state !== "open") return;
    const input = e.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    const resampled = resampleLinear(copy, inRate, SAMPLE_RATE);
    const pcm = floatToPcm16LE(resampled);
    const b64 = pcm16ToBase64(pcm);
    session.sendInputAudio(b64);
  };
  micSource.connect(micProcessor);
  micProcessor.connect(micCtx.destination);
  micOn = true;
  btnMic.textContent = "Stop microphone";
  log("Microphone on (" + inRate + " Hz → " + SAMPLE_RATE + " Hz PCM)");
}

function setConnected(connected) {
  btnConnect.disabled = connected;
  btnDisconnect.disabled = !connected;
  btnMic.disabled = !connected;
  statusEl.textContent = connected ? "Connected" : "Disconnected";
}

async function connect() {
  const agentId = agentInput.value.trim();
  if (!agentId) {
    log("Enter an agent ID");
    return;
  }
  playCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });
  if (playCtx.state === "suspended") await playCtx.resume();
  nextPlayTime = playCtx.currentTime;

  const apiKey = apiKeyInput.value.trim();
  const res = await fetch("/api/session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      ...(apiKey ? { apiKey } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    log("Token error: " + (body.error || res.statusText));
    return;
  }
  const token = body.token;
  if (!token || typeof token !== "string") {
    log("No token in response");
    return;
  }

  session = new Session({
    token,
    baseUrl: typeof body.apiBase === "string" ? body.apiBase : undefined,
    createWebSocket: (url) => {
      const ws = new WebSocket(url);
      ws.addEventListener("close", () => {
        log("WebSocket closed");
        stopMic();
        setConnected(false);
        session = null;
      });
      return ws;
    },
  });

  session.on("session_started", (msg) => {
    log("session_started " + (msg.data && msg.data.id));
  });
  session.on("response_audio", (msg) => {
    if (msg.data && msg.data.audio) {
      try {
        schedulePcm(base64ToPcm16LE(msg.data.audio));
      } catch (_) {
        log("audio decode error");
      }
    }
  });
  session.on("response_text", (msg) => {
    log("agent: " + (msg.data && msg.data.text));
  });
  session.on("input_audio_transcript", (msg) => {
    log("you: " + (msg.data && msg.data.transcript));
  });
  session.on("interruption", () => {
    flushPlaybackSchedule();
    log("interruption");
  });
  session.on("tool_call", (msg) => {
    log("tool_call " + (msg.data && msg.data.toolName));
    if (session && session.state === "open" && msg.data && msg.data.toolCallId) {
      session.sendToolCallOutput(msg.data.toolCallId, "{}");
    }
  });
  session.on("session_ended", () => {
    log("session_ended");
  });

  try {
    await session.connect();
  } catch (e) {
    log("Connect failed: " + (e instanceof Error ? e.message : String(e)));
    session.close();
    session = null;
    return;
  }

  setConnected(true);
  log("Session connected (" + session.url.replace(/token=[^&]+/, "token=…") + ")");
}

function disconnect() {
  stopMic();
  if (session) {
    session.close();
    session = null;
  }
  if (playCtx) {
    playCtx.close();
    playCtx = null;
  }
  setConnected(false);
}

btnConnect.addEventListener("click", () => connect().catch((e) => log(String(e))));
btnDisconnect.addEventListener("click", disconnect);
btnMic.addEventListener("click", async () => {
  if (micOn) {
    stopMic();
    return;
  }
  try {
    await startMic();
  } catch (e) {
    log("Microphone: " + (e && e.message ? e.message : String(e)));
  }
});

let configApiBase = "https://api.vatel.ai";

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    if (typeof c.apiBase === "string") {
      configApiBase = c.apiBase;
    }
    if (c.defaultAgentId && !agentInput.value) agentInput.value = c.defaultAgentId;
  })
  .catch(() => {});

const DEMO_LIVEKIT_URL = "ws://localhost:7880";

const webrtcLogEl = document.getElementById("webrtcLog");
const webrtcStatusEl = document.getElementById("webrtcStatus");
const webrtcIdentityInput = document.getElementById("webrtcIdentity");
const webrtcAudioHost = document.getElementById("webrtcAudioHost");
const btnWebrtcConnect = document.getElementById("btnWebrtcConnect");
const btnWebrtcDisconnect = document.getElementById("btnWebrtcDisconnect");
const btnWebrtcStartAudio = document.getElementById("btnWebrtcStartAudio");
const btnWebrtcMic = document.getElementById("btnWebrtcMic");

function wlog(line) {
  const stamp = new Date().toISOString();
  const out = "[" + stamp + "] " + line;
  console.log("[webrtc demo]", out);
  webrtcLogEl.textContent += out + "\n";
  webrtcLogEl.scrollTop = webrtcLogEl.scrollHeight;
}

let webrtcSession = null;
let webrtcMicOn = false;
const webrtcRoomListeners = [];

function setWebrtcUi(connected) {
  btnWebrtcConnect.disabled = connected;
  btnWebrtcDisconnect.disabled = !connected;
  btnWebrtcStartAudio.disabled = !connected;
  btnWebrtcMic.disabled = !connected;
  if (!connected) {
    btnWebrtcMic.textContent = "Start microphone";
    webrtcMicOn = false;
  }
  webrtcStatusEl.textContent = connected
    ? "WebRTC: connected (" + (webrtcSession?.connectionState ?? "?") + ")"
    : "WebRTC: idle";
}

function wireWebrtcRoomDebug(room) {
  const wrap = (ev, fn) => {
    room.on(ev, fn);
    webrtcRoomListeners.push(() => room.off(ev, fn));
  };
  wrap(RoomEvent.Connected, () => wlog("RoomEvent.Connected"));
  wrap(RoomEvent.Disconnected, (reason) => wlog("RoomEvent.Disconnected " + String(reason)));
  wrap(RoomEvent.Reconnecting, () => wlog("RoomEvent.Reconnecting"));
  wrap(RoomEvent.Reconnected, () => wlog("RoomEvent.Reconnected"));
  wrap(RoomEvent.ConnectionStateChanged, (s) =>
    wlog("RoomEvent.ConnectionStateChanged " + String(s))
  );
  wrap(RoomEvent.ParticipantConnected, (p) =>
    wlog("RoomEvent.ParticipantConnected identity=" + p.identity)
  );
  wrap(RoomEvent.ParticipantDisconnected, (p) =>
    wlog("RoomEvent.ParticipantDisconnected identity=" + p.identity)
  );
  wrap(RoomEvent.TrackPublished, (pub, p) =>
    wlog("RoomEvent.TrackPublished kind=" + pub.kind + " from=" + p.identity)
  );
  wrap(RoomEvent.TrackSubscribed, (track, _pub, p) =>
    wlog("RoomEvent.TrackSubscribed kind=" + track.kind + " from=" + p.identity)
  );
}

async function connectWebrtc() {
  const agentId = agentInput.value.trim();
  if (!agentId) {
    wlog("error: enter an agent ID (shared field above)");
    return;
  }

  wlog("POST /api/session-token transport=WebRTC …");
  const apiKey = apiKeyInput.value.trim();
  const identity = webrtcIdentityInput.value.trim();
  const res = await fetch("/api/session-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      transport: "WebRTC",
      ...(apiKey ? { apiKey } : {}),
      ...(identity ? { identity } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  wlog("session-token HTTP " + res.status + " body keys: " + Object.keys(body).join(", "));

  if (!res.ok) {
    wlog("error: " + (body.error || res.statusText));
    if (body.detail) {
      wlog("detail: " + JSON.stringify(body.detail).slice(0, 2000));
    }
    return;
  }

  if (!body.token || typeof body.token !== "string") {
    wlog("error: missing token in response");
    return;
  }
  const tokenUrl =
    typeof body.url === "string" ? body.url.replace(/\?.*/, "?…") : "(none)";
  if (!body.url || typeof body.url !== "string") {
    wlog(
      "note: API returned no url; LiveKit client will use demo host " + DEMO_LIVEKIT_URL
    );
  }

  wlog(
    "credentials: room=" + (body.room ?? "(none)") + " api url=" + tokenUrl + " connect host=" + DEMO_LIVEKIT_URL
  );

  const client = new Client({
    baseUrl: typeof body.apiBase === "string" ? body.apiBase : configApiBase,
    getToken: () => "",
  });

  webrtcAudioHost.replaceChildren();
  webrtcSession = new WebRTCSession(client, {
    agentId,
    liveKitUrl: DEMO_LIVEKIT_URL,
    remoteAudioContainer: webrtcAudioHost,
  });

  webrtcSession.onRemoteAudio(({ participant, track, element }) => {
    wlog(
      "onRemoteAudio participant=" +
        participant.identity +
        " trackSid=" +
        track.sid +
        " element=" +
        element.tagName
    );
  });

  try {
    wlog("WebRTCSession.connect(pre-minted credentials) …");
    const { room: joinedRoom } = await webrtcSession.connect({
      token: body.token,
      url: typeof body.url === "string" ? body.url : DEMO_LIVEKIT_URL,
      room: body.room,
    });
    wlog("WebRTCSession connected, room name: " + joinedRoom);
    wlog("connectionState=" + webrtcSession.connectionState);

    const rk = webrtcSession.liveKitRoom;
    if (rk) {
      wireWebrtcRoomDebug(rk);
    } else {
      wlog("warn: liveKitRoom is null after connect");
    }

    setWebrtcUi(true);
  } catch (e) {
    wlog("connect error: " + (e instanceof Error ? e.message : String(e)));
    webrtcSession = null;
    setWebrtcUi(false);
  }
}

async function disconnectWebrtc() {
  webrtcRoomListeners.splice(0).forEach((u) => u());
  if (webrtcSession) {
    wlog("WebRTCSession.disconnect() …");
    try {
      await webrtcSession.disconnect();
    } catch (e) {
      wlog("disconnect error: " + (e instanceof Error ? e.message : String(e)));
    }
    webrtcSession = null;
  }
  webrtcAudioHost.replaceChildren();
  setWebrtcUi(false);
  wlog("WebRTC idle");
}

btnWebrtcConnect.addEventListener("click", () =>
  connectWebrtc().catch((e) => wlog(String(e)))
);
btnWebrtcDisconnect.addEventListener("click", () =>
  disconnectWebrtc().catch((e) => wlog(String(e)))
);
btnWebrtcStartAudio.addEventListener("click", async () => {
  if (!webrtcSession) return;
  wlog("startRemoteAudio() …");
  try {
    await webrtcSession.startRemoteAudio();
    wlog("startRemoteAudio ok");
  } catch (e) {
    wlog("startRemoteAudio error: " + (e instanceof Error ? e.message : String(e)));
  }
});
btnWebrtcMic.addEventListener("click", async () => {
  if (!webrtcSession) return;
  webrtcMicOn = !webrtcMicOn;
  wlog("setMicrophoneEnabled(" + webrtcMicOn + ") …");
  try {
    await webrtcSession.setMicrophoneEnabled(webrtcMicOn);
    btnWebrtcMic.textContent = webrtcMicOn ? "Stop microphone" : "Start microphone";
    wlog("microphone " + (webrtcMicOn ? "on" : "off"));
  } catch (e) {
    webrtcMicOn = !webrtcMicOn;
    wlog("microphone error: " + (e instanceof Error ? e.message : String(e)));
  }
});

setWebrtcUi(false);
wlog("WebRTC section ready (not connected). ConnectionState enum sample: " + ConnectionState.Disconnected);
