import type {
  Agent,
  AgentCreateInput,
  AgentUpdateInput,
  DialAgentResponse,
  GraphVersion,
  GraphVersionDetail,
  LLMStringsResponse,
  Organization,
  GenerateSessionTokenOptions,
  SessionTokenResponse,
  SipTrunk,
  SipTrunkAgentAssignment,
  SipTrunkAgentAssignmentCreateInput,
  SipTrunkAgentAssignmentPatchInput,
  SipTrunkCreateInput,
  SipTrunkUpdateInput,
  TwilioPhoneNumber,
  TwilioPhoneNumberImportInput,
  TwilioPhoneNumberLabelPatchInput,
  VoicesListResponse,
} from "./types.js";

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

  async patch<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<{ data?: T; status: number }> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = unknown>(
    path: string
  ): Promise<{ data?: T; status: number }> {
    return this.request<T>(path, { method: "DELETE" });
  }

  async getOrganization(): Promise<{
    data?: Organization;
    status: number;
  }> {
    return this.get<Organization>("/v1/organization");
  }

  async listLLMs(): Promise<{ data?: LLMStringsResponse; status: number }> {
    return this.get<LLMStringsResponse>("/v1/llms");
  }

  async listVoices(): Promise<{ data?: VoicesListResponse; status: number }> {
    return this.get<VoicesListResponse>("/v1/voices");
  }

  async listAgents(): Promise<{ data?: Agent[]; status: number }> {
    return this.get<Agent[]>("/v1/agents");
  }

  async createAgent(
    input: AgentCreateInput
  ): Promise<{ data?: Agent; status: number }> {
    return this.post<Agent>("/v1/agents", input);
  }

  async getAgent(
    id: string
  ): Promise<{ data?: Agent; status: number }> {
    return this.get<Agent>(`/v1/agents/${encodeURIComponent(id)}`);
  }

  async patchAgent(
    id: string,
    input: AgentUpdateInput
  ): Promise<{ data?: Agent; status: number }> {
    return this.patch<Agent>(`/v1/agents/${encodeURIComponent(id)}`, input);
  }

  async deleteAgent(id: string): Promise<{ data?: unknown; status: number }> {
    return this.delete(`/v1/agents/${encodeURIComponent(id)}`);
  }

  async listAgentGraphVersions(
    agentId: string
  ): Promise<{ data?: GraphVersion[]; status: number }> {
    return this.get<GraphVersion[]>(
      `/v1/agents/${encodeURIComponent(agentId)}/versions`
    );
  }

  async getAgentGraphVersion(
    agentId: string,
    versionId: string
  ): Promise<{ data?: GraphVersionDetail; status: number }> {
    return this.get<GraphVersionDetail>(
      `/v1/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}`
    );
  }

  async publishAgentGraphVersion(
    agentId: string,
    versionId: string
  ): Promise<{ data?: GraphVersion; status: number }> {
    return this.post<GraphVersion>(
      `/v1/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}/publish`
    );
  }

  async dialAgent(
    agentId: string,
    number: string
  ): Promise<{ data?: DialAgentResponse; status: number }> {
    const q = new URLSearchParams({ number });
    return this.post<DialAgentResponse>(
      `/v1/agents/${encodeURIComponent(agentId)}/dial?${q}`
    );
  }

  async listTwilioNumbers(): Promise<{
    data?: TwilioPhoneNumber[];
    status: number;
  }> {
    return this.get<TwilioPhoneNumber[]>("/v1/twilio/numbers");
  }

  async importTwilioNumber(
    input: TwilioPhoneNumberImportInput
  ): Promise<{ data?: TwilioPhoneNumber; status: number }> {
    return this.post<TwilioPhoneNumber>("/v1/twilio/numbers", input);
  }

  async patchTwilioNumberLabel(
    id: string,
    input: TwilioPhoneNumberLabelPatchInput
  ): Promise<{ data?: TwilioPhoneNumber; status: number }> {
    return this.patch<TwilioPhoneNumber>(
      `/v1/twilio/numbers/${encodeURIComponent(id)}`,
      input
    );
  }

  async listSipTrunks(): Promise<{ data?: SipTrunk[]; status: number }> {
    return this.get<SipTrunk[]>("/v1/sip-trunks");
  }

  async createSipTrunk(
    input: SipTrunkCreateInput
  ): Promise<{ data?: SipTrunk; status: number }> {
    return this.post<SipTrunk>("/v1/sip-trunks", input);
  }

  async getSipTrunk(
    id: string
  ): Promise<{ data?: SipTrunk; status: number }> {
    return this.get<SipTrunk>(`/v1/sip-trunks/${encodeURIComponent(id)}`);
  }

  async patchSipTrunk(
    id: string,
    input: SipTrunkUpdateInput
  ): Promise<{ data?: SipTrunk; status: number }> {
    return this.patch<SipTrunk>(
      `/v1/sip-trunks/${encodeURIComponent(id)}`,
      input
    );
  }

  async deleteSipTrunk(id: string): Promise<{ data?: unknown; status: number }> {
    return this.delete(`/v1/sip-trunks/${encodeURIComponent(id)}`);
  }

  async listSipTrunkAgentAssignments(
    sipTrunkId: string
  ): Promise<{ data?: SipTrunkAgentAssignment[]; status: number }> {
    return this.get<SipTrunkAgentAssignment[]>(
      `/v1/sip-trunks/${encodeURIComponent(sipTrunkId)}/assignments`
    );
  }

  async createSipTrunkAgentAssignment(
    sipTrunkId: string,
    input: SipTrunkAgentAssignmentCreateInput
  ): Promise<{ data?: SipTrunkAgentAssignment; status: number }> {
    return this.post<SipTrunkAgentAssignment>(
      `/v1/sip-trunks/${encodeURIComponent(sipTrunkId)}/assignments`,
      input
    );
  }

  async getSipTrunkAgentAssignment(
    assignmentId: string
  ): Promise<{ data?: SipTrunkAgentAssignment; status: number }> {
    return this.get<SipTrunkAgentAssignment>(
      `/v1/sip-trunks/assignments/${encodeURIComponent(assignmentId)}`
    );
  }

  async patchSipTrunkAgentAssignment(
    assignmentId: string,
    input: SipTrunkAgentAssignmentPatchInput
  ): Promise<{ data?: SipTrunkAgentAssignment; status: number }> {
    return this.patch<SipTrunkAgentAssignment>(
      `/v1/sip-trunks/assignments/${encodeURIComponent(assignmentId)}`,
      input
    );
  }

  async deleteSipTrunkAgentAssignment(
    assignmentId: string
  ): Promise<{ data?: unknown; status: number }> {
    return this.delete(
      `/v1/sip-trunks/assignments/${encodeURIComponent(assignmentId)}`
    );
  }

  async generateSessionToken(
    agentId: string,
    options?: GenerateSessionTokenOptions
  ): Promise<{ data?: SessionTokenResponse; status: number }> {
    const q = new URLSearchParams({ agentId });
    if (options?.transport != null) {
      q.set("transport", options.transport);
    }
    if (options?.identity != null && options.identity !== "") {
      q.set("identity", options.identity);
    }
    return this.post<SessionTokenResponse>(`/v1/session-token?${q}`);
  }
}
