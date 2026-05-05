import type { ResponseAudioMessage } from "./types.js";

const OUT_SAMPLE_RATE = 24000;
const WORKLET_PROCESSOR_NAME = "vatel-remote-audio-tap";

const WORKLET_SOURCE = `
class VatelRemoteAudioTapProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const o = options.processorOptions || {};
		this.outRate = o.outSampleRate || 24000;
		this.inRate = o.inputSampleRate || 48000;
		this.inputChannels = Math.min(2, Math.max(1, o.inputChannels | 0));
	}
	linearResampleFloatMono(input, inRate, outRate) {
		if (inRate === outRate) {
			return Float32Array.from(input);
		}
		const ratio = inRate / outRate;
		const outLen = Math.max(1, Math.floor(input.length / ratio));
		const out = new Float32Array(outLen);
		for (let i = 0; i < outLen; i++) {
			const src = i * ratio;
			const i0 = Math.floor(src);
			const i1 = Math.min(i0 + 1, input.length - 1);
			const t = src - i0;
			out[i] = input[i0] * (1 - t) + input[i1] * t;
		}
		return out;
	}
	process(inputs, outputs) {
		const input = inputs[0];
		const output = outputs[0];
		if (!input || !input[0] || input[0].length === 0) {
			return true;
		}
		const ch0 = input[0];
		const len = ch0.length;
		let mono;
		if (this.inputChannels >= 2 && input[1]) {
			const ch1 = input[1];
			mono = new Float32Array(len);
			for (let i = 0; i < len; i++) {
				mono[i] = 0.5 * (ch0[i] + ch1[i]);
			}
		} else {
			mono = Float32Array.from(ch0);
		}
		const resampled = this.linearResampleFloatMono(mono, this.inRate, this.outRate);
		if (resampled.length > 0) {
			this.port.postMessage(resampled.buffer, [resampled.buffer]);
		}
		if (output) {
			for (let c = 0; c < output.length; c++) {
				const ch = output[c];
				if (ch && ch.length) {
					ch.fill(0);
				}
			}
		}
		return true;
	}
}
registerProcessor("${WORKLET_PROCESSOR_NAME}", VatelRemoteAudioTapProcessor);
`;

function float32ToPcm16LE(input: Float32Array): Int16Array {
	const buf = new ArrayBuffer(input.length * 2);
	const view = new DataView(buf);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i]));
		view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return new Int16Array(buf);
}

function pcm16ToBase64(samples: Int16Array): string {
	const u8 = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	let binary = "";
	const chunk = 8192;
	for (let i = 0; i < u8.length; i += chunk) {
		const slice = u8.subarray(i, i + chunk);
		binary += String.fromCharCode.apply(null, Array.from(slice));
	}
	return btoa(binary);
}

export interface RemoteAudioTap {
	readonly audioContext: AudioContext;
	readonly source: MediaStreamAudioSourceNode;
	readonly processor: AudioWorkletNode;
	readonly mediaStreamTrackId: string;
	readonly clonedTapTrack: MediaStreamTrack | null;
}

export async function createRemoteAudioTap(
	mediaStreamTrack: MediaStreamTrack,
	publicationTrackSid: string,
	handlers: ReadonlySet<(message: ResponseAudioMessage) => void>
): Promise<RemoteAudioTap> {
	const sourceTrackId = mediaStreamTrack.id;
	const tapTrack =
		typeof mediaStreamTrack.clone === "function"
			? mediaStreamTrack.clone()
			: mediaStreamTrack;
	const clonedTapTrack = tapTrack !== mediaStreamTrack ? tapTrack : null;

	let ctx: AudioContext;
	try {
		ctx = new AudioContext();
	} catch (e) {
		if (clonedTapTrack) {
			clonedTapTrack.stop();
		}
		throw e instanceof Error ? e : new Error(String(e));
	}
	await ctx.resume().catch(() => {});

	const stream = new MediaStream([tapTrack]);
	let source: MediaStreamAudioSourceNode;
	try {
		source = ctx.createMediaStreamSource(stream);
	} catch (e) {
		if (clonedTapTrack) {
			clonedTapTrack.stop();
		}
		void ctx.close().catch(() => {});
		throw e instanceof Error ? e : new Error(String(e));
	}

	const settings = mediaStreamTrack.getSettings();
	const inputChannels = Math.min(2, Math.max(1, settings.channelCount ?? 1));
	const turnId = publicationTrackSid;

	const workletBlobUrl = URL.createObjectURL(
		new Blob([WORKLET_SOURCE], { type: "application/javascript" })
	);
	try {
		await ctx.audioWorklet.addModule(workletBlobUrl);
	} catch (e) {
		URL.revokeObjectURL(workletBlobUrl);
		if (clonedTapTrack) {
			clonedTapTrack.stop();
		}
		void ctx.close().catch(() => {});
		throw e instanceof Error ? e : new Error(String(e));
	}
	URL.revokeObjectURL(workletBlobUrl);

	const processor = new AudioWorkletNode(ctx, WORKLET_PROCESSOR_NAME, {
		processorOptions: {
			inputSampleRate: ctx.sampleRate,
			outSampleRate: OUT_SAMPLE_RATE,
			inputChannels,
		},
		channelCount: inputChannels,
		channelCountMode: "explicit",
	});

	processor.port.onmessage = (ev: MessageEvent<unknown>) => {
		if (!(ev.data instanceof ArrayBuffer)) {
			return;
		}
		const resampled = new Float32Array(ev.data);
		if (resampled.length === 0) {
			return;
		}
		const pcm = float32ToPcm16LE(resampled);
		const audio = pcm16ToBase64(pcm);
		const msg: ResponseAudioMessage = {
			type: "response_audio",
			data: { turn_id: turnId, audio, is_final: false },
		};
		for (const h of handlers) {
			h(msg);
		}
	};

	source.connect(processor);
	processor.connect(ctx.destination);

	return {
		audioContext: ctx,
		source,
		processor,
		mediaStreamTrackId: sourceTrackId,
		clonedTapTrack,
	};
}

export function disposeRemoteAudioTap(
	tap: RemoteAudioTap | null,
	emitFinal: boolean,
	handlers: ReadonlySet<(message: ResponseAudioMessage) => void>,
	turnId: string
): void {
	if (!tap) {
		return;
	}
	if (tap.clonedTapTrack) {
		try {
			tap.clonedTapTrack.stop();
		} catch {
			// ignore
		}
	}
	try {
		tap.source.disconnect();
	} catch {
		// ignore
	}
	try {
		tap.processor.disconnect();
	} catch {
		// ignore
	}
	tap.processor.port.onmessage = null;
	tap.processor.port.close();
	void tap.audioContext.close().catch(() => {});

	if (emitFinal && handlers.size > 0) {
		const finalMsg: ResponseAudioMessage = {
			type: "response_audio",
			data: { turn_id: turnId, audio: "", is_final: true },
		};
		for (const h of handlers) {
			h(finalMsg);
		}
	}
}
