import "dotenv/config";
import mic from "mic";
import Speaker from "speaker";
import WebSocket from "ws";
import { Client, Session } from "@vatel/sdk";

const SAMPLE_RATE = 24000;
const CHANNELS = 1;

function createMic(session) {
  const micInstance = mic({
    rate: String(SAMPLE_RATE),
    channels: String(CHANNELS),
    debug: false,
    fileType: "raw",
  });
  const micInputStream = micInstance.getAudioStream();
  micInputStream.on("data", (chunk) => {
    if (session.state === "open") {
      session.sendInputAudio(chunk.toString("base64"));
    }
  });
  micInputStream.on("error", (err) => console.error("mic error", err));
  micInputStream.on("startComplete", () => console.log("Mic started.\n> "));
  micInputStream.on("stopComplete", () => console.log("Mic stopped."));
  return { micInstance, micInputStream };
}

function createSpeaker() {
  return new Speaker({
    channels: CHANNELS,
    bitDepth: 16,
    sampleRate: SAMPLE_RATE,
    signed: true,
  });
}

async function main() {
  const apiKey = process.env.VATEL_API_KEY;
  const agentId = process.env.AGENT_ID;
  if (!apiKey || !agentId) {
    console.error("Set VATEL_API_KEY and AGENT_ID in .env or environment");
    process.exit(1);
  }

  const baseUrl = process.env.BASE_URL;
  const client = new Client({
    getToken: () => apiKey,
    ...(baseUrl && { baseUrl }),
  });
  const { data: tokenData, status } = await client.generateSessionToken(agentId);
  if (status !== 200 || !tokenData?.token) {
    console.error("Failed to get session token:", status, tokenData);
    process.exit(1);
  }

  const session = new Session({
    token: tokenData.token,
    createWebSocket: (url) => new WebSocket(url),
    ...(baseUrl && { baseUrl }),
  });

  session.on("response_audio", (msg) => {
    const buf = Buffer.from(msg.data.audio, "base64");
    const speaker = createSpeaker();
    speaker.on("error", () => {});
    speaker.write(buf);
    speaker.end();
  });
  session.on("response_text", (msg) => {
    process.stdout.write("\rAgent: " + msg.data.text + "\n> ");
  });
  session.on("input_audio_transcript", (msg) => {
    process.stdout.write("\rYou: " + msg.data.transcript + "\n> ");
  });
  session.on("session_started", () => {
    console.log("Session started. Speak into the microphone. Ctrl+C to exit.\n> ");
  });
  session.on("session_ended", () => {
    console.log("\nSession ended.");
  });

  await session.connect();

  const { micInstance } = createMic(session);
  micInstance.start();

  process.on("SIGINT", () => {
    console.log("\nStopping...");
    micInstance.stop();
    session.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
