# Node CLI example

Uses the system microphone to talk to a Vatel call agent. Requires an organization API key and an agent ID.

## Setup

From the repo root, build the SDK and install example deps:

```bash
npm run build
cd examples/node-cli
npm install
```

Copy `.env.example` to `.env` and set `VATEL_API_KEY` and `AGENT_ID`.

## Run

```bash
npm start
```

Speak into the microphone; agent responses are played through the speakers and transcripts are printed. Ctrl+C to exit.

## Requirements

- Node 18+
- Microphone and speakers
- **sox** (macOS/Windows) or **ALSA** (Linux) for mic capture: `brew install sox` (macOS) or `apt install sox` (Linux). Playback uses the `speaker` package (native addon; build tools may be required). Optional: set `BASE_URL` in `.env` to point at a different API (e.g. `http://localhost:8080`).
