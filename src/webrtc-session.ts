import {
	ConnectionState,
	LocalParticipant,
	LocalTrackPublication,
	Room,
	RoomEvent,
	Track,
	type RemoteParticipant,
	type RemoteTrack,
	type RemoteTrackPublication,
} from "livekit-client";

import type { ClientMessage, ToolCallOutputMessage, WebRTCServerMessage } from "./types.js";
import { parseServerMessage } from "./parse-server-message.js";

export { ConnectionState };

export const DEFAULT_WEBRTC_SIGNALING_URL = "wss://sip.vatel.ai";

export const WEBRTC_MESSAGES_TOPIC = "messages";

export interface WebRTCSessionOptions {
	remoteAudioContainer?: HTMLElement;
}

type MessageHandler = (message: WebRTCServerMessage) => void;
type TypedMessageHandler<T extends WebRTCServerMessage> = (message: T) => void;

export interface WebRTCSessionCredentials {
	token: string;
	url?: string;
	room?: string;
}

/**
 * Browser-only WebRTC session: joins using credentials from your backend,
 * publishes microphone audio, and plays remote audio via received tracks.
 * The `messages` text channel carries session events only (no `response_audio`);
 * agent audio is not delivered as base64 over text.
 */
export class WebRTCSession {
	private readonly options: WebRTCSessionOptions;
	private room: Room | null = null;
	private readonly messageHandlers = new Set<MessageHandler>();

	private readonly onTrackSubscribed = (
		track: RemoteTrack,
		publication: RemoteTrackPublication,
		_participant: RemoteParticipant
	) => {
		if (track.kind !== Track.Kind.Audio) {
			return;
		}
		const element = track.attach() as HTMLAudioElement;
		const container = this.options.remoteAudioContainer;
		if (container) {
			container.appendChild(element);
		}
	};

	private readonly onTrackUnsubscribed = (
		track: RemoteTrack,
		_publication: RemoteTrackPublication,
		_participant: RemoteParticipant
	) => {
		if (track.kind !== Track.Kind.Audio) {
			return;
		}
		track.detach();
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

	get connectionState(): ConnectionState {
		return this.room?.state ?? ConnectionState.Disconnected;
	}

	on<T extends WebRTCServerMessage["type"]>(
		type: T,
		handler: TypedMessageHandler<Extract<WebRTCServerMessage, { type: T }>>
	): () => void {
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
			.on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished);

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
		this.room = null;
		r.off(RoomEvent.TrackSubscribed, this.onTrackSubscribed);
		r.off(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed);
		r.off(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished);
		r.unregisterTextStreamHandler(WEBRTC_MESSAGES_TOPIC);
		this.messageHandlers.clear();
		await r.disconnect(true);
	}
}
