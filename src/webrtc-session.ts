import {
	ConnectionState,
	DisconnectReason,
	LocalParticipant,
	LocalTrackPublication,
	Room,
	RoomEvent,
	Track,
	type RemoteParticipant,
	type RemoteTrack,
	type RemoteTrackPublication,
} from "livekit-client";

import type {
	ClientMessage,
	ResponseAudioMessage,
	ToolCallOutputMessage,
	WebRTCDisconnectedMessage,
	WebRTCServerMessage,
} from "./types.js";
import { parseServerMessage } from "./parse-server-message.js";
import {
	createRemoteAudioTap,
	disposeRemoteAudioTap,
	type RemoteAudioTap,
} from "./webrtc-remote-audio-tap.js";

export { ConnectionState, DisconnectReason };

export const DEFAULT_WEBRTC_SIGNALING_URL = "wss://sip.vatel.ai";

export const WEBRTC_MESSAGES_TOPIC = "messages";

export interface WebRTCSessionOptions {
	remoteAudioContainer?: HTMLElement;
}

export type WebRTCResponseAudioMessage = ResponseAudioMessage;

type MessageHandler = (message: WebRTCServerMessage) => void;
type TypedMessageHandler<T extends WebRTCServerMessage> = (message: T) => void;
type DisconnectedHandler = (message: WebRTCDisconnectedMessage) => void;
type ResponseAudioHandler = (message: ResponseAudioMessage) => void;

export interface WebRTCSessionCredentials {
	token: string;
	url?: string;
	room?: string;
}

/**
 * Browser-only WebRTC session: joins using credentials from your backend,
 * publishes microphone audio, and plays remote audio via received tracks.
 * The `messages` text channel carries session events only (no base64 `response_audio`);
 * agent audio arrives on remote WebRTC tracks. Use `on("response_audio", ...)` for streaming
 * decoded agent PCM (same shape as WebSocket sessions: base64 24 kHz mono s16le), independent of the microphone.
 * Playback uses the remote track element; tapping runs on a cloned track so capture stays reliable.
 * Use `on("disconnected", ...)` when the room session ends (including after `disconnect()` or remote audio unsubscribe).
 */
export class WebRTCSession {
	private readonly options: WebRTCSessionOptions;
	private room: Room | null = null;
	private readonly messageHandlers = new Set<MessageHandler>();
	private readonly disconnectedHandlers = new Set<DisconnectedHandler>();
	private readonly responseAudioHandlers = new Set<ResponseAudioHandler>();
	private remoteAgentAudioSub: {
		track: RemoteTrack;
		publication: RemoteTrackPublication;
	} | null = null;
	private remoteAudioTap: RemoteAudioTap | null = null;
	private remoteAudioSyncRunning = false;
	private remoteAudioSyncPending = false;

	private detachFromRoom(r: Room): void {
		r.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed);
		r.off(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed);
		r.off(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished);
		r.off(RoomEvent.Disconnected, this.onRoomDisconnected);
		r.unregisterTextStreamHandler(WEBRTC_MESSAGES_TOPIC);
	}

	private notifyDisconnected(reason?: DisconnectReason): void {
		const turnId = this.remoteAgentAudioSub?.publication.trackSid ?? "";
		disposeRemoteAudioTap(
			this.remoteAudioTap,
			true,
			this.responseAudioHandlers,
			turnId
		);
		this.remoteAudioTap = null;
		this.remoteAgentAudioSub = null;

		const message: WebRTCDisconnectedMessage = {
			type: "disconnected",
			...(reason !== undefined ? { data: { reason } } : {}),
		};
		for (const h of this.disconnectedHandlers) {
			h(message);
		}
		this.messageHandlers.clear();
		this.responseAudioHandlers.clear();
	}

	private readonly onRoomDisconnected = (reason?: DisconnectReason) => {
		const r = this.room;
		if (!r) {
			return;
		}
		this.room = null;
		this.detachFromRoom(r);
		this.notifyDisconnected(reason);
	};

	private readonly onTrackSubscribed = (
		track: RemoteTrack,
		publication: RemoteTrackPublication,
		_participant: RemoteParticipant
	) => {
		if (track.kind !== Track.Kind.Audio) {
			return;
		}
		this.remoteAgentAudioSub = { track, publication };
		void this.scheduleRemoteAgentAudioSync();
	};

	private readonly onTrackUnsubscribed = (
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		_participant: RemoteParticipant
	) => {
		if (track.kind !== Track.Kind.Audio) {
			return;
		}
		if (this.remoteAgentAudioSub?.track === track) {
			const turnId = this.remoteAgentAudioSub.publication.trackSid;
			disposeRemoteAudioTap(
				this.remoteAudioTap,
				true,
				this.responseAudioHandlers,
				turnId
			);
			this.remoteAudioTap = null;
			this.remoteAgentAudioSub = null;
		}
		track.detach();
		void this.disconnect();
	};

	private readonly onLocalTrackUnpublished = (
		publication: LocalTrackPublication,
		_participant: LocalParticipant
	) => {
		if (publication.kind !== Track.Kind.Audio) {
			return;
		}
		publication.track?.detach();
	};

	constructor(options: WebRTCSessionOptions = {}) {
		this.options = options;
	}

	private scheduleRemoteAgentAudioSync(): void {
		void this.runRemoteAgentAudioSync();
	}

	private async runRemoteAgentAudioSync(): Promise<void> {
		if (this.remoteAudioSyncRunning) {
			this.remoteAudioSyncPending = true;
			return;
		}
		this.remoteAudioSyncRunning = true;
		try {
			do {
				this.remoteAudioSyncPending = false;
				await this.applyRemoteAgentAudioOutputOnce();
			} while (this.remoteAudioSyncPending);
		} finally {
			this.remoteAudioSyncRunning = false;
		}
	}

	private async applyRemoteAgentAudioOutputOnce(): Promise<void> {
		const sub = this.remoteAgentAudioSub;
		if (!sub || sub.track.kind !== Track.Kind.Audio) {
			return;
		}
		const { track, publication } = sub;
		const sid = publication.trackSid;

		if (this.responseAudioHandlers.size > 0) {
			if (
				this.remoteAudioTap &&
				this.remoteAudioTap.mediaStreamTrackId === track.mediaStreamTrack.id
			) {
				return;
			}
			disposeRemoteAudioTap(
				this.remoteAudioTap,
				false,
				this.responseAudioHandlers,
				sid
			);
			this.remoteAudioTap = null;
			try {
				this.remoteAudioTap = await createRemoteAudioTap(
					track.mediaStreamTrack,
					sid,
					this.responseAudioHandlers
				);
			} catch {
				this.remoteAudioTap = null;
			}
			const element = track.attach() as HTMLAudioElement;
			const container = this.options.remoteAudioContainer;
			if (container) {
				container.appendChild(element);
			}
			return;
		}

		disposeRemoteAudioTap(
			this.remoteAudioTap,
			false,
			this.responseAudioHandlers,
			sid
		);
		this.remoteAudioTap = null;

		const element = track.attach() as HTMLAudioElement;
		const container = this.options.remoteAudioContainer;
		if (container) {
			container.appendChild(element);
		}
	}

	get connectionState(): ConnectionState {
		return this.room?.state ?? ConnectionState.Disconnected;
	}

	on<T extends WebRTCServerMessage["type"]>(
		type: T,
		handler: TypedMessageHandler<Extract<WebRTCServerMessage, { type: T }>>
	): () => void;
	on(type: "disconnected", handler: DisconnectedHandler): () => void;
	on(type: "response_audio", handler: ResponseAudioHandler): () => void;
	on(
		type: WebRTCServerMessage["type"] | "disconnected" | "response_audio",
		handler:
			| TypedMessageHandler<WebRTCServerMessage>
			| DisconnectedHandler
			| ResponseAudioHandler
	): () => void {
		if (type === "disconnected") {
			const h = handler as DisconnectedHandler;
			this.disconnectedHandlers.add(h);
			return () => this.disconnectedHandlers.delete(h);
		}
		if (type === "response_audio") {
			const h = handler as ResponseAudioHandler;
			this.responseAudioHandlers.add(h);
			void this.scheduleRemoteAgentAudioSync();
			return () => {
				this.responseAudioHandlers.delete(h);
				void this.scheduleRemoteAgentAudioSync();
			};
		}
		const wrapper: MessageHandler = (msg) => {
			if (msg.type === type) {
				(handler as TypedMessageHandler<WebRTCServerMessage>)(msg);
			}
		};
		this.messageHandlers.add(wrapper);
		return () => this.messageHandlers.delete(wrapper);
	}

	private async deliverTextFromStream(
		room: Room,
		reader: { readAll: () => Promise<string> },
		_participantIdentity: string
	): Promise<void> {
		const text = await reader.readAll();
		let message: ReturnType<typeof parseServerMessage>;
		try {
			message = parseServerMessage(text);
		} catch {
			return;
		}
		if (message.type === "response_audio") {
			return;
		}
		const webRtcMessage = message as WebRTCServerMessage;
		for (const h of this.messageHandlers) {
			h(webRtcMessage);
		}
	}

	async connect(credentials: WebRTCSessionCredentials): Promise<{ room: string }> {
		if (typeof window === "undefined") {
			throw new Error("WebRTCSession requires a browser environment");
		}
		if (!credentials.token) {
			throw new Error("WebRTCSession.connect: token is required");
		}

		const url = credentials.url ?? "";
		const connectUrl = url !== "" ? url : DEFAULT_WEBRTC_SIGNALING_URL;

		const room = new Room();

		this.room = room;

		void room.prepareConnection(connectUrl, credentials.token);

		room
			.on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
			.on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
			.on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished)
			.on(RoomEvent.Disconnected, this.onRoomDisconnected);

		room.registerTextStreamHandler(WEBRTC_MESSAGES_TOPIC, (reader, { identity }) => {
			void this.deliverTextFromStream(room, reader, identity);
		});

		await room.connect(connectUrl, credentials.token);

		return { room: credentials.room ?? room.name };
	}

	async setMicrophoneEnabled(enabled: boolean): Promise<void> {
		const r = this.room;
		if (!r) {
			throw new Error("WebRTCSession is not connected");
		}
		await r.localParticipant.setMicrophoneEnabled(enabled, undefined, { dtx: false });
	}

	async start(): Promise<void> {
		const r = this.room;
		if (!r) {
			throw new Error("WebRTCSession is not connected");
		}
		await r.startAudio();
	}

	async send(message: ClientMessage): Promise<void> {
		const r = this.room;
		if (!r) {
			throw new Error("WebRTCSession is not connected");
		}
		await r.localParticipant.sendText(JSON.stringify(message), {
			topic: WEBRTC_MESSAGES_TOPIC,
		});
	}

	async sendToolCallOutput(toolCallId: string, output: string): Promise<void> {
		const msg: ToolCallOutputMessage = {
			type: "tool_call_output",
			data: { toolCallId, output },
		};
		await this.send(msg);
	}

	async disconnect(): Promise<void> {
		const r = this.room;
		if (!r) {
			return;
		}
		try {
			await r.disconnect(true);
		} catch {
			if (this.room === r) {
				this.room = null;
				this.detachFromRoom(r);
				this.notifyDisconnected(undefined);
			}
		}
	}
}
