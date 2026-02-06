import type { Agent, SessionTokenResponse } from "./types.js";

const DEFAULT_BASE_URL = "https://api.vatel.ai";

export interface ClientOptions {
  baseUrl?: string;
  getToken?: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
}

export class Client {
  private baseUrl: string;
  private getToken: () => string | Promise<string>;
  private fetchFn: typeof globalThis.fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.getToken = options.getToken ?? (() => "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  async request<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<{ data?: T; status: number }> {
    const token = await this.getToken();
    const url = new URL(path, this.baseUrl);
    const res = await this.fetchFn(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const text = await res.text();
    let data: T | undefined;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    }
    return { data, status: res.status };
  }

  async get<T = unknown>(path: string): Promise<{ data?: T; status: number }> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<{ data?: T; status: number }> {
    return this.request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async generateSessionToken(
    agentId: string
  ): Promise<{ data?: SessionTokenResponse; status: number }> {
    const path = `/v1/session-token?agentId=${encodeURIComponent(agentId)}`;
    return this.post<SessionTokenResponse>(path);
  }

  async listAgents(): Promise<{ data?: Agent[]; status: number }> {
    return this.get<Agent[]>("/v1/agents");
  }
}
