import { TRANSPORT_WEBRTC, Session, WebRTCSession } from "@vatel/sdk";

const SAMPLE_RATE = 24000;
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const agentInput = document.getElementById("agentId");
const btnConnect = document.getElementById("btnConnect");
const btnDisconnect = document.getElementById("btnDisconnect");

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
	if (micProcessor) {
		try {
			micProcessor.disconnect();
		} catch (_) { }
		micProcessor.onaudioprocess = null;
		micProcessor = null;
	}
	if (micSource) {
		try {
			micSource.disconnect();
		} catch (_) { }
		micSource = null;
	}
	if (micCtx) {
		try {
			micCtx.close();
		} catch (_) { }
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
	log("Microphone on");
}

function setConnected(connected) {
	btnConnect.disabled = connected;
	btnDisconnect.disabled = !connected;
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
			agent_id: agentId,
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
		log("Session started" + (msg.data?.id ? " (" + msg.data.id + ")" : ""));
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
		const name = msg.data?.toolName;
		log("Tool: " + (name || "(unnamed)"));
		if (session?.state === "open" && msg.data?.toolCallId) {
			session.sendToolCallOutput(msg.data.toolCallId, "Success");
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
	log("Connected");
	try {
		await startMic();
	} catch (e) {
		log("Microphone: " + (e instanceof Error ? e.message : String(e)));
	}
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

fetch("/api/config")
	.then((r) => r.json())
	.then((c) => {
		if (c.defaultAgentId && !agentInput.value) {
			agentInput.value = c.defaultAgentId;
		}
	})
	.catch(() => { });

const webrtcLogEl = document.getElementById("webrtcLog");
const webrtcStatusEl = document.getElementById("webrtcStatus");
const webrtcAudioHost = document.getElementById("webrtcAudioHost");
const btnWebrtcConnect = document.getElementById("btnWebrtcConnect");
const btnWebrtcDisconnect = document.getElementById("btnWebrtcDisconnect");

function wlog(line) {
	webrtcLogEl.textContent += line + "\n";
	webrtcLogEl.scrollTop = webrtcLogEl.scrollHeight;
}

let webrtcSession = null;

function setWebrtcUi(connected) {
	btnWebrtcConnect.disabled = connected;
	btnWebrtcDisconnect.disabled = !connected;
	webrtcStatusEl.textContent = connected ? "WebRTC: connected" : "WebRTC: idle";
}

async function connectWebrtc() {
	const agentId = agentInput.value.trim();
	if (!agentId) {
		wlog("Enter an agent ID.");
		return;
	}

	const apiKey = apiKeyInput.value.trim();
	const res = await fetch("/api/session-token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			agent_id: agentId,
			transport: TRANSPORT_WEBRTC,
			...(apiKey ? { apiKey } : {}),
		}),
	});
	const body = await res.json().catch(() => ({}));

	if (!res.ok) {
		wlog("Could not start session: " + (body.error || res.statusText));
		return;
	}

	if (!body.token || typeof body.token !== "string") {
		wlog("No token returned. Check your account and agent ID.");
		return;
	}

	webrtcAudioHost.replaceChildren();
	webrtcSession = new WebRTCSession({
		remoteAudioContainer: webrtcAudioHost,
	});

	webrtcSession.on("session_started", (msg) => {
		wlog("Session started" + (msg.data?.id ? " (" + msg.data.id + ")" : ""));
	});
	webrtcSession.on("response_text", (msg) => {
		wlog("Agent: " + (msg.data && msg.data.text));
	});
	webrtcSession.on("input_audio_transcript", (msg) => {
		wlog("You: " + (msg.data && msg.data.transcript));
	});
	webrtcSession.on("speech_started", (msg) => {
		wlog("Speech started" + (msg.data?.emulated ? " (emulated)" : ""));
	});
	webrtcSession.on("speech_stopped", () => {
		wlog("Speech stopped");
	});
	webrtcSession.on("interruption", () => {
		wlog("Interrupted");
	});
	webrtcSession.on("tool_call", (msg) => {
		const name = msg.data?.toolName;
		wlog("Tool: " + (name || "(unnamed)"));
		if (msg.data?.toolCallId) {
			webrtcSession
				.sendToolCallOutput(msg.data.toolCallId, "Success")
				.catch((e) =>
					wlog(e instanceof Error ? e.message : String(e))
				);
		}
	});
	webrtcSession.on("session_ended", () => {
		wlog("Session ended");
	});
	webrtcSession.on("disconnected", (msg) => {
		wlog(
			"Disconnected: " +
				(msg.data?.reason != null ? String(msg.data.reason) : "unknown reason")
		);
	});

	try {
		await webrtcSession.connect({
			token: body.token,
			url: typeof body.url === "string" ? body.url : undefined,
			room: body.room,
		});
		wlog("Connected");
		setWebrtcUi(true);
		try {
			await webrtcSession.start();
		} catch (e) {
			wlog("Remote audio: " + (e instanceof Error ? e.message : String(e)));
		}
		try {
			await webrtcSession.setMicrophoneEnabled(true);
			wlog("Microphone on");
		} catch (e) {
			wlog("Microphone: " + (e instanceof Error ? e.message : String(e)));
		}
	} catch (e) {
		wlog("Connect failed: " + (e instanceof Error ? e.message : String(e)));
		webrtcSession = null;
		setWebrtcUi(false);
	}
}

async function disconnectWebrtc() {
	if (webrtcSession) {
		try {
			await webrtcSession.disconnect();
		} catch (e) {
			wlog("Disconnect error: " + (e instanceof Error ? e.message : String(e)));
		}
		webrtcSession = null;
	}
	webrtcAudioHost.replaceChildren();
	setWebrtcUi(false);
}

btnWebrtcConnect.addEventListener("click", () =>
	connectWebrtc().catch((e) => wlog(String(e)))
);
btnWebrtcDisconnect.addEventListener("click", () =>
	disconnectWebrtc().catch((e) => wlog(String(e)))
);

setWebrtcUi(false);
