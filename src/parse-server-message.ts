import type { ServerMessage, ToolCallArgument, ToolCallData } from "./types.js";

function normalizeToolCallData(data: unknown): ToolCallData | null {
	if (data == null || typeof data !== "object") {
		return null;
	}
	const o = data as Record<string, unknown>;
	const toolCallId = o.toolCallId ?? o.tool_call_id;
	const toolName = o.toolName ?? o.tool_name;
	if (typeof toolCallId !== "string" || typeof toolName !== "string") {
		return null;
	}
	const rawArgs = o.arguments;
	const args: ToolCallArgument[] = Array.isArray(rawArgs)
		? (rawArgs as ToolCallArgument[])
		: [];
	return { toolCallId, toolName, arguments: args };
}

export function parseServerMessage(raw: string): ServerMessage {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	if (typeof parsed.type !== "string") {
		throw new Error("Invalid server message: missing type");
	}
	if (parsed.type === "tool_call") {
		const normalized = normalizeToolCallData(parsed.data);
		if (!normalized) {
			throw new Error("Invalid server message: tool_call data");
		}
		return { type: "tool_call", data: normalized };
	}
	return parsed as unknown as ServerMessage;
}
