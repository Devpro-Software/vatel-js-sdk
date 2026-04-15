import { Client, TRANSPORT_WEBRTC } from "@vatel/sdk";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3002;

const API_BASE = (process.env.VATEL_BASE_URL || "https://api.vatel.ai").replace(/\/$/, "");

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
	res.json({
		defaultAgentId: process.env.VATEL_AGENT_ID || null,
		apiBase: API_BASE,
	});
});

app.post("/api/session-token", async (req, res) => {
	const fromBody = req.body?.apiKey;
	const apiKey =
		typeof fromBody === "string" && fromBody.trim()
			? fromBody.trim()
			: process.env.VATEL_API_KEY;
	const agentRaw =
		req.body?.agent_id ?? req.body?.agentId ?? process.env.VATEL_AGENT_ID;
	if (!apiKey) {
		res.status(400).json({
			error: "API key required: paste it in the form or set VATEL_API_KEY",
		});
		return;
	}
	if (!agentRaw || typeof agentRaw !== "string") {
		res.status(400).json({
			error: "agent_id is required (JSON body or VATEL_AGENT_ID)",
		});
		return;
	}

	const agentId = agentRaw.trim();
	const client = new Client({
		baseUrl: API_BASE,
		getToken: () => apiKey,
	});

	const transport = req.body?.transport;
	const tokenOpts = {
		first_message: "Hey whats cracking?",
		prompt: "Your name is john.",
	};
	if (typeof transport === "string" && transport.toLowerCase() === TRANSPORT_WEBRTC) {
		tokenOpts.transport = TRANSPORT_WEBRTC;
	}

	let tokenRes;
	try {
		tokenRes = await client.generateSessionToken(agentId, tokenOpts);
	} catch (err) {
		res.status(502).json({
			error: "Failed to reach Vatel API",
			detail: err instanceof Error ? err.message : String(err),
		});
		return;
	}

	const { data, status } = tokenRes;
	const token = data?.token;
	if (!token || typeof token !== "string") {
		const msg =
			data && typeof data === "object" && "error" in data
				? String(data.error)
				: "Failed to mint session token";
		res.status(status >= 400 && status < 600 ? status : 502).json({
			error: msg,
			detail: data,
		});
		return;
	}

	const payload = { token, apiBase: API_BASE };
	if (typeof data?.url === "string") {
		payload.url = data.url;
	}
	if (typeof data?.room === "string") {
		payload.room = data.room;
	}
	if (typeof data?.identity === "string") {
		payload.identity = data.identity;
	}
	res.json(payload);
});

app.listen(PORT, () => {
	console.log(`Demo: http://localhost:${PORT}`);
	console.log(`Using API base: ${API_BASE}`);
});
