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
  type RoomOptions,
} from "livekit-client";
import type { Client } from "./rest.js";

export type { RoomOptions } from "livekit-client";
export { ConnectionState };

export interface WebRTCSessionOptions {
  agentId: string;
  identity?: string;
  /** When set, used for LiveKit `prepareConnection` / `connect` instead of the URL from the session token. */
  liveKitUrl?: string;
  liveKitRoom?: RoomOptions;
  remoteAudioContainer?: HTMLElement;
}

export type RemoteAudioCallback = (args: {
  track: RemoteTrack;
  publication: RemoteTrackPublication;
  participant: RemoteParticipant;
  element: HTMLAudioElement;
}) => void;

export interface WebRTCSessionCredentials {
  token: string;
  url: string;
  room?: string;
}

/**
 * Browser-only WebRTC session: mints a WebRTC session token via the REST client,
 * joins the server-assigned LiveKit room, and publishes microphone audio only.
 */
export class WebRTCSession {
  private readonly client: Client;
  private readonly options: WebRTCSessionOptions;
  private room: Room | null = null;
  private readonly remoteAudioHandlers = new Set<RemoteAudioCallback>();

  private readonly onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) => {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }
    const element = track.attach() as HTMLAudioElement;
    const container = this.options.remoteAudioContainer;
    if (container) {
      container.appendChild(element);
    }
    for (const h of this.remoteAudioHandlers) {
      h({ track, publication, participant, element });
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

  constructor(client: Client, options: WebRTCSessionOptions) {
    this.client = client;
    this.options = options;
  }

  get liveKitRoom(): Room | null {
    return this.room;
  }

  get connectionState(): ConnectionState {
    return this.room?.state ?? ConnectionState.Disconnected;
  }

  onRemoteAudio(handler: RemoteAudioCallback): () => void {
    this.remoteAudioHandlers.add(handler);
    return () => this.remoteAudioHandlers.delete(handler);
  }

  async connect(credentials?: WebRTCSessionCredentials): Promise<{ room: string }> {
    if (typeof window === "undefined") {
      throw new Error("WebRTCSession requires a browser environment");
    }

    let token: string;
    let url: string;
    let serverRoom: string | undefined;

    if (credentials) {
      token = credentials.token;
      url = credentials.url;
      serverRoom = credentials.room;
    } else {
      const { data, status } = await this.client.generateSessionToken(
        this.options.agentId,
        { transport: "WebRTC", identity: this.options.identity }
      );

      if (!data?.token) {
        const msg =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: string }).error)
            : `Failed to get WebRTC session credentials (${status})`;
        throw new Error(msg);
      }
      if (!this.options.liveKitUrl && !data.url) {
        throw new Error(
          "WebRTC session response missing url; set WebRTCSessionOptions.liveKitUrl or obtain url from the API"
        );
      }

      token = data.token;
      url = data.url ?? "";
      serverRoom = data.room;
    }

    const connectUrl = this.options.liveKitUrl ?? url;
    if (!connectUrl) {
      throw new Error("LiveKit connection URL is missing");
    }

    const room = new Room({
      ...this.options.liveKitRoom,
    });

    this.room = room;

    void room.prepareConnection(connectUrl, token);

    room
      .on(RoomEvent.TrackSubscribed, this.onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed)
      .on(RoomEvent.LocalTrackUnpublished, this.onLocalTrackUnpublished);

    await room.connect(connectUrl, token);

    return { room: serverRoom ?? room.name };
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    const r = this.room;
    if (!r) {
      throw new Error("WebRTCSession is not connected");
    }
    await r.localParticipant.setMicrophoneEnabled(enabled);
  }

  async startRemoteAudio(): Promise<void> {
    const r = this.room;
    if (!r) {
      throw new Error("WebRTCSession is not connected");
    }
    await r.startAudio();
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
    this.remoteAudioHandlers.clear();
    await r.disconnect(true);
  }
}
