import type {
  ServerMessage,
  ClientMessage,
  InputAudioMessage,
  ToolCallOutputMessage,
} from "./types.js";

type MessageHandler = (message: ServerMessage) => void;
type TypedMessageHandler<T extends ServerMessage> = (message: T) => void;

const DEFAULT_BASE_URL = "wss://api.vatel.ai";
const CONNECTION_PATH = "/v1/connection";

function parseServerMessage(raw: string): ServerMessage {
  const parsed = JSON.parse(raw) as ServerMessage;
  if (typeof parsed?.type !== "string") {
    throw new Error("Invalid server message: missing type");
  }
  return parsed;
}

export class Session {
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private token: string;
  private createWebSocket: (url: string) => WebSocket;
  private handlers = new Set<MessageHandler>();
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  constructor(options: {
    token: string;
    baseUrl?: string;
    createWebSocket?: (url: string) => WebSocket;
  }) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/^http/, "ws");
    this.createWebSocket =
      options.createWebSocket ??
      ((url: string) => new WebSocket(url));
  }

  get url(): string {
    const u = new URL(CONNECTION_PATH, this.baseUrl + "/");
    u.searchParams.set("token", this.token);
    return u.toString();
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      try {
        this.ws = this.createWebSocket(this.url);
      } catch (err) {
        this.readyPromise = null;
        this.readyResolve = null;
        reject(err);
        return;
      }
      this.ws.onopen = () => {
        this.readyResolve?.();
        this.readyResolve = null;
      };
      this.ws.onerror = (event: Event) => {
        if (!this.readyResolve) return;
        this.readyPromise = null;
        this.readyResolve = null;
        reject(event);
      };
      this.ws.onclose = () => {
        this.readyPromise = null;
        this.readyResolve = null;
      };
      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const message = parseServerMessage(event.data as string);
          this.handlers.forEach((h) => h(message));
        } catch (_) {}
      };
    });
    return this.readyPromise;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  on<T extends ServerMessage["type"]>(
    type: T,
    handler: TypedMessageHandler<Extract<ServerMessage, { type: T }>>
  ): () => void {
    const wrapper: MessageHandler = (msg) => {
      if (msg.type === type) {
        (handler as TypedMessageHandler<ServerMessage>)(msg);
      }
    };
    this.handlers.add(wrapper);
    return () => this.handlers.delete(wrapper);
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Connection is not open");
    }
    this.ws.send(JSON.stringify(message));
  }

  sendInputAudio(audioBase64: string): void {
    const msg: InputAudioMessage = {
      type: "input_audio",
      data: { audio: audioBase64 },
    };
    this.send(msg);
  }

  sendToolCallOutput(toolCallId: string, output: string): void {
    const msg: ToolCallOutputMessage = {
      type: "tool_call_output",
      data: { toolCallId, output },
    };
    this.send(msg);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.readyPromise = null;
    this.readyResolve = null;
    this.handlers.clear();
  }

  get state(): "connecting" | "open" | "closing" | "closed" {
    if (!this.ws) return "closed";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      case WebSocket.CLOSING:
        return "closing";
      default:
        return "closed";
    }
  }
}
