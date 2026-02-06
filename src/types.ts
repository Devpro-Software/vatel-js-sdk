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

export type TTSStrategy = "elevenlabs" | "openai" | "cartesia";

export type TimeoutAction = "end_call" | "transfer_call";

export interface VoiceSettings {
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
  defaultTimeout?: number;
  timeoutAction?: TimeoutAction;
  transferNumber?: string;
  transferMessage?: string;
  silenceCounter?: number;
  silenceTimeoutAction?: TimeoutAction;
  silenceTransferNumber?: string;
  silenceTransferMessage?: string;
}

export interface Agent {
  id?: string;
  phone_number_id?: string;
  name?: string;
  llm?: string;
  status?: AgentStatus;
  prompt?: string;
  first_message?: string;
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

export interface SessionTokenResponse {
  token: string;
}
