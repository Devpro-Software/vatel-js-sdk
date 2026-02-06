# @vatel/sdk

Connect to Vatel voice agents from JavaScript or TypeScript. Send audio, receive agent replies and transcripts, and handle tool calls. Works in Node.js and the browser.

## Install

```bash
npm install @vatel/sdk
```

In **Node.js** you also need a WebSocket implementation (browsers have one built in):

```bash
npm install ws
```

## Quick start

**1. Get a session token** using your API key and agent ID:

```js
import { Client } from "@vatel/sdk";

const client = new Client({
  getToken: () => process.env.VATEL_API_KEY,
});

const { data } = await client.generateSessionToken("your-agent-id");
if (!data?.token) throw new Error("Failed to get token");
```

**2. Connect a session** and listen for events:

```js
import { Session } from "@vatel/sdk";

const session = new Session({ token: data.token });

session.on("session_started", () => console.log("Connected"));
session.on("response_text", (msg) => console.log("Agent:", msg.data.text));
session.on("response_audio", (msg) => {
  // msg.data.audio is base64-encoded PCM (24 kHz, mono, 16-bit)
  // Decode and play with your audio stack
});
session.on("input_audio_transcript", (msg) => console.log("You said:", msg.data.transcript));

await session.connect();
```

**3. Send microphone (or other) audio** as base64 PCM chunks:

```js
session.sendInputAudio(base64PcmChunk);
```

## Node.js: WebSocket setup

Node doesn’t include a WebSocket API. Install `ws` and pass a WebSocket factory when creating the session:

```js
import { Session } from "@vatel/sdk";
import WebSocket from "ws";

const session = new Session({
  token: data.token,
  createWebSocket: (url) => new WebSocket(url),
});
await session.connect();
```

## Session options

| Option | Description |
|--------|-------------|
| `token` | **Required.** JWT from `client.generateSessionToken(agentId)`. |
| `baseUrl` | API base URL. Default: `https://api.vatel.ai`. Use `https://…` or `wss://…`; the SDK uses the right protocol. |
| `createWebSocket` | **Node only.** Function that takes a URL and returns a WebSocket instance. Use with the `ws` package. |

## REST client

The `Client` uses your organization API key as a Bearer token. Use it to get session tokens and list agents.

```js
import { Client } from "@vatel/sdk";

const client = new Client({
  getToken: () => process.env.VATEL_API_KEY,
});

const { data: tokenData } = await client.generateSessionToken("agent-id");
const { data: agents } = await client.listAgents();
```

## Tool calls

When the agent invokes a tool, handle it and send the result back:

```js
session.on("tool_call", async (msg) => {
  const { toolCallId, toolName, arguments: args } = msg.data;
  const result = await yourToolHandler(toolName, args);
  session.sendToolCallOutput(toolCallId, JSON.stringify(result));
});
```

## TypeScript

The package includes type definitions. No extra `@types` install; use TypeScript as usual and import types when needed:

```ts
import type { ResponseAudioMessage, SessionStartedMessage } from "@vatel/sdk";
```
