import { PipelineNode } from "../types/index.js";
import type { TransportAdapter, PipelineNodeConfig } from "../types/index.js";
import { pcmResample, pcmToMulaw } from "../transports/utils.js";

export interface OutputBufferNodeConfig extends PipelineNodeConfig {
  targetSampleRate?: number;
  targetEncoding?: "pcm" | "mulaw";
  lookaheadMs?: number;
  transportAdapter?: TransportAdapter;
}

export class OutputBufferNode extends PipelineNode<Uint8Array, Uint8Array> {
  private config: OutputBufferNodeConfig;
  private audioQueue: Uint8Array[] = [];
  private totalQueuedBytes = 0;
  private lookaheadMs: number;
  private lookaheadTimer: ReturnType<typeof setTimeout> | null = null;
  private targetSampleRate: number;
  private targetEncoding: "pcm" | "mulaw";
  private isPlaying = false;

  constructor(config: OutputBufferNodeConfig) {
    super({ id: config.id });
    this.config = config;
    this.lookaheadMs = config.lookaheadMs ?? 100;
    this.targetSampleRate = config.targetSampleRate ?? 16000;
    this.targetEncoding = config.targetEncoding ?? "pcm";
  }

  async setup(): Promise<void> {
    const self = this;
    const sampleRate = this.targetSampleRate;
    const encoding = this.targetEncoding;

    this.writable = new WritableStream<Uint8Array>({
      write(chunk) {
        self.audioQueue.push(chunk);
        self.totalQueuedBytes += chunk.byteLength;
      },
      close() {},
      abort() {
        self.flush();
      },
    });

    this.readable = new ReadableStream<Uint8Array>({
      pull(controller) {
        const pullLoop = () => {
          if (self.audioQueue.length > 0) {
            const chunk = self.audioQueue.shift()!;
            self.totalQueuedBytes -= chunk.byteLength;

            let output: Uint8Array = chunk;
            const pcm = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);

            if (sampleRate !== 16000) {
              const resampled = pcmResample(pcm, 16000, sampleRate);
              output = new Uint8Array(resampled.buffer, resampled.byteOffset, resampled.byteLength * 2);
            }

            if (encoding === "mulaw") {
              const pcmData = sampleRate !== 16000
                ? pcmResample(new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2), 16000, sampleRate)
                : new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
              const mulawData = pcmToMulaw(pcmData);
              output = mulawData;
            }

            controller.enqueue(output);
            self.isPlaying = true;
          }

          if (self.audioQueue.length > 0) {
            setTimeout(pullLoop, 0);
          } else {
            self.lookaheadTimer = setTimeout(pullLoop, self.lookaheadMs);
            self.isPlaying = false;
          }
        };
        pullLoop();
      },
      cancel() {
        self.flush();
      },
    });

    this.getAbortController().signal.addEventListener("abort", () => {
      self.flush();
    }, { once: true });
  }

  flush(): void {
    if (this.lookaheadTimer) {
      clearTimeout(this.lookaheadTimer);
      this.lookaheadTimer = null;
    }
    this.audioQueue = [];
    this.totalQueuedBytes = 0;
    this.isPlaying = false;

    if (this.config.transportAdapter) {
      const adapter = this.config.transportAdapter as unknown as {
        clearOutput?: () => void;
        _websocket?: { send: (payload: string) => void; readyState: number; OPEN: number };
      };

      if (typeof adapter.clearOutput === "function") {
        adapter.clearOutput();
      } else {
        const ws = adapter._websocket;
        if (ws && ws.readyState === ws.OPEN) {
          try {
            ws.send(JSON.stringify({ event: "clear" }));
          } catch {}
        }
      }
    }
  }

  get queuedBytes(): number {
    return this.totalQueuedBytes;
  }

  get queueLength(): number {
    return this.audioQueue.length;
  }

  get playing(): boolean {
    return this.isPlaying;
  }
}
