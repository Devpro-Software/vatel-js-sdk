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