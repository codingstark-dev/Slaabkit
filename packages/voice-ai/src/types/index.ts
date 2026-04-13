export type VoiceProbability = number;

export interface PipelineEvent {
  type: string;
  timestamp: number;
}

export interface PipelineStartEvent extends PipelineEvent {
  type: "pipeline:start";
}

export interface PipelineStopEvent extends PipelineEvent {
  type: "pipeline:stop";
}

export interface NodeErrorEvent extends PipelineEvent {
  type: "node:error";
  nodeId: string;
  error: Error;
  recoverable: boolean;
}

export interface LatencyEvent extends PipelineEvent {
  type: "pipeline:latency";
  sttLatency: number;
  llmLatency: number;
  ttsLatency: number;
  totalLatency: number;
}

export interface InterruptionEvent extends PipelineEvent {
  type: "vad:interruption";
}

export interface DTMFEvent extends PipelineEvent {
  type: "transport:dtmf";
  digit: string;
}

export interface SpeechStartEvent extends PipelineEvent {
  type: "vad:speech_start";
}

export interface SpeechEndEvent extends PipelineEvent {
  type: "vad:speech_end";
  audioBuffer: Uint8Array;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export type PipelineEvents =
  | PipelineStartEvent
  | PipelineStopEvent
  | NodeErrorEvent
  | LatencyEvent
  | InterruptionEvent
  | DTMFEvent
  | SpeechStartEvent
  | SpeechEndEvent;

export type PipelineEventType = PipelineEvents["type"];

export interface PipelineNodeConfig {
  id: string;
}

export abstract class PipelineNode<
  TInput = Uint8Array,
  TOutput = Uint8Array,
> {
  readonly id: string;
  protected readable: ReadableStream<TOutput> | null = null;
  protected writable: WritableStream<TInput> | null = null;
  protected abortController: AbortController;

  constructor(config: PipelineNodeConfig) {
    this.id = config.id;
    this.abortController = new AbortController();
  }

  abstract setup(): Promise<void>;

  getReadable(): ReadableStream<TOutput> {
    if (!this.readable) {
      throw new Error(`Node ${this.id}: readable stream not initialized. Call setup() first.`);
    }
    return this.readable;
  }

  getWritable(): WritableStream<TInput> {
    if (!this.writable) {
      throw new Error(`Node ${this.id}: writable stream not initialized. Call setup() first.`);
    }
    return this.writable;
  }

  getAbortController(): AbortController {
    return this.abortController;
  }

  getSignal(): AbortSignal {
    return this.abortController.signal;
  }

  destroy(): void {
    this.abortController.abort();
    if (this.readable && !this.readable.locked) {
      void this.readable.cancel().catch(() => {});
    }
    if (this.writable && !this.writable.locked) {
      void this.writable.abort("Node destroyed").catch(() => {});
    }
  }
}

export interface TransportSession {
  callId?: string;
  callerNumber?: string;
  calleeNumber?: string;
  metadata: Record<string, unknown>;
}

export interface TransportAdapter {
  createIngressStream(): ReadableStream<Uint8Array>;
  createEgressStream(): WritableStream<Uint8Array>;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly session: TransportSession;
}

export interface VADEngine {
  processFrame(audioFrame: Float32Array): VoiceProbability;
  init(): Promise<void>;
  destroy(): void;
  frameSize?: number;
}

export interface VADNodeConfig extends PipelineNodeConfig {
  engine: "silero" | "webrtc";
  threshold?: number;
  silenceDurationMs?: number;
  speechProbabilityThreshold?: number;
}

export interface STTAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  getTranscriptStream(): ReadableStream<TranscriptEvent>;
  sendAudio(chunk: Uint8Array): void;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ConversationContext {
  messages: ConversationMessage[];
  sessionId: string;
  metadata: Record<string, unknown>;
}

export interface CognitiveOrchestrator {
  generate(
    transcript: string,
    context: ConversationContext,
    signal?: AbortSignal,
  ): ReadableStream<string>;
}

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  sampleRate?: number;
  language?: string;
}

export interface TTSAdapter {
  synthesize(
    text: string,
    options: TTSOptions,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array>;
}

export interface VoicePipelineConfig {
  transport: TransportAdapter;
  vad: VADNodeConfig;
  stt: STTAdapter;
  orchestrator: CognitiveOrchestrator;
  tts: TTSAdapter;
  ttsOptions?: TTSOptions;
  chunkOnCommas?: boolean;
  maxChunkTokens?: number;
  outputBufferLookaheadMs?: number;
}

export class VoicePipeline extends EventTarget {
  private config: VoicePipelineConfig;
  private nodes: PipelineNode[] = [];
  private running = false;
  private abortController: AbortController;
  private bridgePromises: Promise<void>[] = [];

  constructor(config: VoicePipelineConfig) {
    super();
    this.config = config;
    this.abortController = new AbortController();
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Pipeline already running");
    }

    this.running = true;
    this.abortController = new AbortController();

    this.dispatchEvent(
      new CustomEvent("pipeline:start", {
        detail: { type: "pipeline:start", timestamp: Date.now() },
      }),
    );

    try {
      await this.config.transport.start();

      for (const node of this.nodes) {
        await node.setup();
      }

      const ingressStream = this.config.transport.createIngressStream();
      const egressStream = this.config.transport.createEgressStream();

      if (this.nodes.length === 0) {
        this.bridgePromises.push(
          ingressStream.pipeTo(egressStream, {
            signal: this.abortController.signal,
          }).catch((error: Error) => {
            if (error.name !== "AbortError") {
              this.emitNodeError("pipeline", error, false);
            }
          }),
        );
      } else {
        let current: ReadableStream<unknown> = ingressStream;

        for (const node of this.nodes) {
          const writable = node.getWritable() as WritableStream<unknown>;
          const readable = node.getReadable() as ReadableStream<unknown>;

          this.bridgePromises.push(
            current.pipeTo(writable, {
              signal: this.abortController.signal,
            }).catch((error: Error) => {
              if (error.name !== "AbortError") {
                this.emitNodeError(node.id, error, true);
              }
            }),
          );

          current = readable;
        }

        this.bridgePromises.push(
          (current as ReadableStream<Uint8Array>).pipeTo(egressStream, {
            signal: this.abortController.signal,
          }).catch((error: Error) => {
            if (error.name !== "AbortError") {
              this.emitNodeError("egress", error, false);
            }
          }),
        );
      }
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;
    this.abortController.abort();
    this.bridgePromises = [];

    for (const node of this.nodes) {
      node.destroy();
    }

    this.config.transport.stop().catch(() => {});

    this.dispatchEvent(
      new CustomEvent("pipeline:stop", {
        detail: { type: "pipeline:stop", timestamp: Date.now() },
      }),
    );
  }

  on<TResult>(
    eventType: PipelineEventType,
    listener: (event: CustomEvent<TResult>) => void,
  ): void {
    this.addEventListener(eventType, listener as EventListener);
  }

  off<TResult>(
    eventType: PipelineEventType,
    listener: (event: CustomEvent<TResult>) => void,
  ): void {
    this.removeEventListener(eventType, listener as EventListener);
  }

  setNodes(nodes: PipelineNode[]): void {
    this.nodes = nodes;
  }

  emitLatency(latency: Omit<LatencyEvent, "type" | "timestamp">): void {
    this.dispatchEvent(
      new CustomEvent("pipeline:latency", {
        detail: {
          type: "pipeline:latency",
          timestamp: Date.now(),
          ...latency,
        },
      }),
    );
  }

  private emitNodeError(nodeId: string, error: Error, recoverable: boolean): void {
    this.dispatchEvent(
      new CustomEvent("node:error", {
        detail: {
          type: "node:error",
          timestamp: Date.now(),
          nodeId,
          error,
          recoverable,
        },
      }),
    );
  }
}

export class VADError extends Error {
  constructor(
    public engine: "silero" | "webrtc",
    public reason: string,
  ) {
    super(`VAD error [${engine}]: ${reason}`);
    this.name = "VADError";
  }
}
