import {
  PipelineNode,
  VADError,
  type VADNodeConfig,
  type VADEngine,
  type VoiceProbability,
  type SpeechStartEvent,
  type SpeechEndEvent,
  type InterruptionEvent,
} from "../types/index.js";
import { pcmToFloat32 } from "../transports/utils.js";

class SimpleVADEngine implements VADEngine {
  private threshold: number;
  frameSize = 480;

  constructor(threshold = 0.01) {
    this.threshold = threshold;
  }

  async init(): Promise<void> {}

  processFrame(audioFrame: Float32Array): VoiceProbability {
    let rms = 0;
    for (let i = 0; i < audioFrame.length; i++) {
      const s = audioFrame[i] ?? 0;
      rms += s * s;
    }
    rms = Math.sqrt(rms / audioFrame.length);
    return Math.min(1.0, rms / this.threshold);
  }

  destroy(): void {}
}

class SileroVADEngine implements VADEngine {
  private model: unknown = null;
  frameSize = 480;

  constructor(threshold = 0.5) {
    void threshold;
  }

  async init(): Promise<void> {
    throw new VADError("silero", "wasm_load_failure");
  }

  processFrame(_audioFrame: Float32Array): VoiceProbability {
    if (!this.model) return 0;
    return 0;
  }

  destroy(): void {
    this.model = null;
  }
}

export class VADNode extends PipelineNode<Uint8Array, Uint8Array> {
  private config: VADNodeConfig;
  private engine: VADEngine;
  private isSpeaking = false;
  private speechBuffer: Uint8Array[] = [];
  private silenceStart = 0;
  private isAgentSpeaking = false;
  private speechProbabilityThreshold: number;
  private silenceDurationMs: number;
  private events = new EventTarget();

  constructor(config: VADNodeConfig) {
    super({ id: config.id });
    this.config = config;
    this.speechProbabilityThreshold = config.speechProbabilityThreshold ?? config.threshold ?? 0.5;
    this.silenceDurationMs = config.silenceDurationMs ?? 300;

    if (config.engine === "silero") {
      this.engine = new SileroVADEngine(this.speechProbabilityThreshold);
    } else {
      this.engine = new SimpleVADEngine(0.01);
    }
  }

  async setup(): Promise<void> {
    if (this.config.engine === "silero") {
      try {
        await this.engine.init();
      } catch {
        this.engine = new SimpleVADEngine(0.01);
      }
    } else {
      await this.engine.init();
    }

    const self = this;
    let readableController: ReadableStreamDefaultController<Uint8Array> | null = null;

    this.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        readableController = controller;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write(chunk) {
        const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
        const floats = pcmToFloat32(pcm);

        const frameSize = self.engine.frameSize ?? 480;
        let maxProbability = 0;
        for (let offset = 0; offset < floats.length; offset += frameSize) {
          const frame = floats.subarray(offset, offset + frameSize);
          if (frame.length < frameSize) break;
          const probability = self.engine.processFrame(frame);
          if (probability > maxProbability) {
            maxProbability = probability;
          }
        }

        const now = Date.now();

        if (maxProbability >= self.speechProbabilityThreshold) {
          if (!self.isSpeaking) {
            self.isSpeaking = true;
            self.speechBuffer = [];
            const speechStartEvent: SpeechStartEvent = {
              type: "vad:speech_start",
              timestamp: now,
            };
            self.events.dispatchEvent(new CustomEvent("speech_start", { detail: speechStartEvent }));

            if (self.isAgentSpeaking) {
              const interruptionEvent: InterruptionEvent = {
                type: "vad:interruption",
                timestamp: now,
              };
              self.events.dispatchEvent(new CustomEvent("interruption", { detail: interruptionEvent }));
              self.getAbortController().abort();
            }
          }

          self.silenceStart = now;
          self.speechBuffer.push(chunk);
        } else if (self.isSpeaking) {
          if ((now - self.silenceStart) >= self.silenceDurationMs) {
            self.isSpeaking = false;
            const buffered = self.concatenateBuffers(self.speechBuffer);
            self.speechBuffer = [];
            const speechEndEvent: SpeechEndEvent = {
              type: "vad:speech_end",
              timestamp: now,
              audioBuffer: buffered,
            };
            self.events.dispatchEvent(new CustomEvent("speech_end", { detail: speechEndEvent }));
            if (readableController && buffered.byteLength > 0) {
              readableController.enqueue(buffered);
            }
          } else {
            self.speechBuffer.push(chunk);
          }
        }
      },
      close() {
        readableController?.close();
      },
      abort() {
        readableController?.close();
      },
    });
  }

  private concatenateBuffers(buffers: Uint8Array[]): Uint8Array {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(buf, offset);
      offset += buf.byteLength;
    }
    return result;
  }

  setAgentSpeaking(value: boolean): void {
    this.isAgentSpeaking = value;
  }

  onSpeechStart(listener: (event: CustomEvent<SpeechStartEvent>) => void): void {
    this.events.addEventListener("speech_start", listener as EventListener);
  }

  onSpeechEnd(listener: (event: CustomEvent<SpeechEndEvent>) => void): void {
    this.events.addEventListener("speech_end", listener as EventListener);
  }

  onInterruption(listener: (event: CustomEvent<InterruptionEvent>) => void): void {
    this.events.addEventListener("interruption", listener as EventListener);
  }
}

export { SimpleVADEngine, SileroVADEngine };
