# @vatel/sdk

JavaScript/TypeScript SDK for the Call Agent Builder WebSocket API and REST APIs. Works in Node and browser. Types are included but optional (no need to use TypeScript).

## Install

```bash
npm install @vatel/sdk
```

For Node.js WebSocket support (optional):

```bash
npm install ws
```

## WebSocket session

Connect with a JWT from `POST /session-token` (see REST client):

```js
import { Session, Client } from "@vatel/sdk";

const client = new Client({
  getToken: () => process.env.VATEL_API_KEY,
});
const { data } = await client.generateSessionToken("agent-uuid");
const session = new Session({ token: data.token });

session.on("session_started", (msg) => console.log("Session:", msg.data.id));
session.on("response_audio", (msg) => { /* play msg.data.audio (base64 PCM) */ });
session.on("response_text", (msg) => console.log("Text:", msg.data.text));
session.on("input_audio_transcript", (msg) => console.log("User said:", msg.data.transcript));
session.on("tool_call", (msg) => {
  const { toolCallId, toolName, arguments: args } = msg.data;
  const result = await myToolRunner(toolName, args);
  session.sendToolCallOutput(toolCallId, JSON.stringify(result));
});

await session.connect();
session.sendInputAudio(base64PcmChunk);
```

In Node, pass a WebSocket constructor so the SDK doesn’t rely on a global:

```js
import { Session } from "@vatel/sdk";
import WebSocket from "ws";

const session = new Session({
  token: process.env.VATEL_TOKEN,
  createWebSocket: (url) => new WebSocket(url),
});
await session.connect();
```

Session options:

- `token` (required): JWT from `generateSessionToken(agentId)`.
- `baseUrl`: default `wss://api.vatel.ai`. Use `https://…` or `wss://…`; the SDK switches to `wss` when needed.
- `createWebSocket`: optional; use in Node with `ws` to provide a WebSocket implementation.

## REST client

Uses the organization API key as Bearer token.

```js
import { Client } from "@vatel/sdk";

const client = new Client({
  getToken: () => process.env.VATEL_API_KEY,
});

const { data: tokenData } = await client.generateSessionToken("agent-uuid");
const { data: agents } = await client.listAgents();
```

## Types (optional)

TypeScript users get full typings from the package. No separate `@types` or TS dependency is required for JS-only usage.

```ts
import type { ServerMessage, ResponseAudioMessage } from "@vatel/sdk";
```

## Build

```bash
npm install
npm run build
```

Output: `dist/` (ESM, CJS, and `.d.ts`).
