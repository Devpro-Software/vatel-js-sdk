export type ServerMessageType =
	| "session_started"
	| "response_audio"
	| "response_text"
	| "input_audio_transcript"
	| "speech_started"
	| "speech_stopped"
	| "session_ended"
	| "interruption"
	| "tool_call";

export interface SessionStartedData {
	id: string;
}

export interface SessionStartedMessage {
	type: "session_started";
	data: SessionStartedData;
}

export interface ResponseAudioData {
	turn_id: string;
	audio: string;
	is_final?: boolean;
}

export interface ResponseAudioMessage {
	type: "response_audio";
	data: ResponseAudioData;
}

export interface ResponseTextData {
	turn_id: string;
	text: string;
}

export interface ResponseTextMessage {
	type: "response_text";
	data: ResponseTextData;
}

export interface InputAudioTranscriptData {
	transcript: string;
}

export interface InputAudioTranscriptMessage {
	type: "input_audio_transcript";
	data: InputAudioTranscriptData;
}

export interface SpeechStartedData {
	emulated: boolean;
}

export interface SpeechStartedMessage {
	type: "speech_started";
	data?: SpeechStartedData;
}

export interface SpeechStoppedMessage {
	type: "speech_stopped";
}

export interface SessionEndedMessage {
	type: "session_ended";
	data?: Record<string, unknown>;
}

export interface InterruptionMessage {
	type: "interruption";
}

export interface ToolCallArgument {
	name?: string;
	type?: string;
	dataType?: string;
	description?: string;
	required?: boolean;
	value?: unknown;
}

export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	arguments: ToolCallArgument[];
}

export interface ToolCallMessage {
	type: "tool_call";
	data: ToolCallData;
}

export type ServerMessage =
	| SessionStartedMessage
	| ResponseAudioMessage
	| ResponseTextMessage
	| InputAudioTranscriptMessage
	| SpeechStartedMessage
	| SpeechStoppedMessage
	| SessionEndedMessage
	| InterruptionMessage
	| ToolCallMessage;

export type WebRTCServerMessage = Exclude<ServerMessage, ResponseAudioMessage>;

export type WebRTCServerMessageType = WebRTCServerMessage["type"];

export interface WebRTCDisconnectedData {
	reason?: number;
}

export interface WebRTCDisconnectedMessage {
	type: "disconnected";
	data?: WebRTCDisconnectedData;
}

export interface InputAudioData {
	audio: string;
}

export interface InputAudioMessage {
	type: "input_audio";
	data: InputAudioData;
}

export interface ToolCallOutputData {
	toolCallId: string;
	output: string;
}

export interface ToolCallOutputMessage {
	type: "tool_call_output";
	data: ToolCallOutputData;
}

export type ClientMessage = InputAudioMessage | ToolCallOutputMessage;

export interface SessionOptions {
	token: string;
	baseUrl?: string;
	createWebSocket?: (url: string) => WebSocket;
}

export type AgentStatus = "active" | "inactive";

export type TTSStrategy =
	| "elevenlabs"
	| "openai"
	| "cartesia"
	| "hume"
	| "minimax"
	| "fish";

export type TimeoutAction = "end_call" | "transfer_call";

export interface VoiceSettings {
	id?: string;
	provider?: TTSStrategy;
	speed?: number;
	stability?: number;
	similarity_boost?: number;
	volume?: number;
}

export interface VadSettings {
	start_secs?: number;
	starting_secs?: number;
	stop_secs?: number;
	stopping_secs?: number;
	silence_timeout_secs?: number;
}

export interface NoiseCancelSettings {
	enabled?: boolean;
	level?: number;
}

export interface TimeoutSettings {
	default_timeout?: number;
	defaultTimeout?: number;
	timeout_action?: TimeoutAction;
	timeoutAction?: TimeoutAction;
	transfer_number?: string;
	transferNumber?: string;
	transfer_message?: string;
	transferMessage?: string;
	silence_counter?: number;
	silenceCounter?: number;
	silence_timeout_action?: TimeoutAction;
	silenceTimeoutAction?: TimeoutAction;
	silence_transfer_number?: string;
	silenceTransferNumber?: string;
	silence_transfer_message?: string;
	silenceTransferMessage?: string;
}

export interface Agent {
	id?: string;
	phone_number_id?: string;
	name?: string;
	llm?: string;
	fallback_llm?: string;
	status?: AgentStatus;
	prompt?: string;
	first_message?: string;
	first_message_interruption_time?: number;
	default_language?: string;
	summarize_calls?: boolean;
	tts_strategy?: TTSStrategy;
	created_at?: string;
	updated_at?: string;
	noise_cancel_settings?: NoiseCancelSettings;
	vad_settings?: VadSettings;
	enable_first_message_outbound?: boolean;
	voice_settings?: VoiceSettings;
	timeout_settings?: TimeoutSettings;
	keyterms?: string[];
}

export interface AgentCreateInput {
	phone_number_id?: string | null;
	name: string;
	llm?: string;
	fallback_llm?: string;
	status?: AgentStatus;
	prompt?: string;
	first_message?: string;
	first_message_interruption_time?: number;
	default_language?: string;
	summarize_calls?: boolean;
	noise_cancel_settings?: NoiseCancelSettings;
	vad_settings?: VadSettings;
	enable_first_message_outbound?: boolean;
	timeout_settings?: TimeoutSettings;
	keyterms?: string[];
	voice_settings?: VoiceSettings;
}

export interface AgentUpdateInput {
	phone_number_id?: string | null;
	name?: string;
	llm?: string;
	fallback_llm?: string;
	status?: AgentStatus;
	prompt?: string;
	first_message?: string;
	first_message_interruption_time?: number;
	default_language?: string;
	summarize_calls?: boolean;
	noise_cancel_settings?: NoiseCancelSettings;
	vad_settings?: VadSettings;
	enable_first_message_outbound?: boolean;
	timeout_settings?: TimeoutSettings;
	keyterms?: string[];
	voice_settings?: VoiceSettings;
}

export interface Organization {
	id?: string;
	name?: string;
	created_at?: string;
}

export interface LLMStringsResponse {
	llms: string[];
}

export interface VoiceCatalogEntry {
	id: string;
	name: string;
	description?: string | null;
	provider: TTSStrategy;
	languages: string[];
	preview_url?: string | null;
	featured?: boolean;
}

export interface VoicesListResponse {
	voices: VoiceCatalogEntry[];
}

export interface GraphVersion {
	id?: string;
	agent_id?: string;
	created_at?: string;
	published_at?: string | null;
	tag?: string;
}

export type GraphNode = Record<string, unknown>;

export interface GraphVersionDetail {
	version: GraphVersion;
	nodes: GraphNode[];
}

export interface DialAgentResponse {
	success: boolean;
}

export interface TwilioPhoneNumber {
	id?: string;
	phone_number?: string;
	phone_sid?: string;
	label?: string;
	account_sid?: string;
	created_at?: string;
	updated_at?: string;
}

export interface TwilioPhoneNumberImportInput {
	label?: string;
	phone_number: string;
	account_sid: string;
	auth_token: string;
}

export interface TwilioPhoneNumberLabelPatchInput {
	label: string;
}

export type CallerTransformType =
	| "add_prefix"
	| "add_suffix"
	| "replace"
	| "strip_digits_end"
	| "strip_digits_start";

export type SIPTrunkAuthType = "digest" | "acl" | "none";

export type RegistrationStatus =
	| "not_registered"
	| "pending"
	| "registered"
	| "failed"
	| "auth_failed";

export interface SipTrunkCallerIDTransform {
	type: CallerTransformType;
	value?: string;
	value2?: string;
	number?: number;
}

export type SipTrunkPbx = "3cx" | "yeastar" | "webex" | "generic";

export interface SipTrunk {
	id?: string;
	created_at?: string;
	pbx?: SipTrunkPbx;
	caller_id_transforms?: SipTrunkCallerIDTransform[];
	inbound_host?: string;
	inbound_auth_type?: SIPTrunkAuthType;
	inbound_sip_username?: string;
	inbound_registration_status?: RegistrationStatus;
	outbound_host?: string;
	outbound_sip_username?: string;
	register?: boolean;
	outbound_registration_status?: RegistrationStatus;
	remain_in_dialog?: boolean;
}

export interface SipTrunkCreateInput {
	pbx: SipTrunkPbx;
	caller_id_transforms?: SipTrunkCallerIDTransform[];
	inbound_host?: string | null;
	inbound_auth_type?: SIPTrunkAuthType | null;
	inbound_sip_username?: string | null;
	inbound_sip_password?: string | null;
	outbound_host?: string | null;
	outbound_sip_username?: string | null;
	outbound_sip_password?: string | null;
	register?: boolean | null;
	remain_in_dialog?: boolean | null;
}

export interface SipTrunkUpdateInput {
	pbx?: SipTrunkPbx;
	caller_id_transforms?: SipTrunkCallerIDTransform[] | null;
	inbound_host?: string | null;
	inbound_auth_type?: SIPTrunkAuthType | null;
	inbound_sip_username?: string | null;
	inbound_sip_password?: string | null;
	outbound_host?: string | null;
	outbound_sip_username?: string | null;
	outbound_sip_password?: string | null;
	register?: boolean | null;
	remain_in_dialog?: boolean | null;
}

export interface SipTrunkAgentAssignment {
	id?: string;
	agent_id?: string;
	sip_trunk_id?: string;
	number?: string;
	alternate_number?: string;
	created_at?: string;
}

export interface SipTrunkAgentAssignmentCreateInput {
	agent_id: string;
	number?: string;
	alternate_number?: string;
}

export interface SipTrunkAgentAssignmentPatchInput {
	number?: string | null;
	alternate_number?: string | null;
}

export interface ErrorResponse {
	error: string;
}

export const TRANSPORT_WEBSOCKET = "websocket" as const;
export const TRANSPORT_WEBRTC = "webrtc" as const;

export type SessionTokenTransport =
	| typeof TRANSPORT_WEBSOCKET
	| typeof TRANSPORT_WEBRTC;

export interface GenerateSessionTokenOptions {
	transport?: SessionTokenTransport;
}

export interface SessionTokenResponse {
	token: string;
	room?: string;
	identity?: string;
	url?: string;
}
