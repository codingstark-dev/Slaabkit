import { createSentenceBoundaryTransform } from "../sentence-boundary/index.js";
import { STTNode } from "../stt/index.js";
import { TTSNode } from "../tts/index.js";
import { VADNode } from "../vad/index.js";
import { OutputBufferNode } from "../output/index.js";
import { VoicePipeline, PipelineNode } from "../types/index.js";
import type {
  VoicePipelineConfig,
  TranscriptEvent,
  LatencyEvent,
  ConversationContext,
} from "../types/index.js";

class OrchestratorNode extends PipelineNode<TranscriptEvent, string> {
  private config: VoicePipelineConfig;
  private context: ConversationContext = {
    messages: [],
    sessionId: crypto.randomUUID(),
    metadata: {},
  };
  private onLatency?: (latency: Omit<LatencyEvent, "type" | "timestamp">) => void;

  constructor(config: VoicePipelineConfig, onLatency?: (latency: Omit<LatencyEvent, "type" | "timestamp">) => void) {
    super({ id: "orchestrator" });
    this.config = config;
    this.onLatency = onLatency;
  }

  async setup(): Promise<void> {
    let controllerRef: ReadableStreamDefaultController<string> | null = null;

    this.readable = new ReadableStream<string>({
      start(controller) {
        controllerRef = controller;
      },
    });

    this.writable = new WritableStream<TranscriptEvent>({
      write: async (event) => {
        if (!event.isFinal) {
          return;
        }

        const startTime = performance.now();
        const stream = this.config.orchestrator.generate(
          event.text,
          this.context,
          this.getSignal(),
        );
        const llmStart = performance.now();

        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            if (value && controllerRef) {
              controllerRef.enqueue(value);
            }
          }
        } finally {
          reader.releaseLock();
        }

        const llmEnd = performance.now();
        this.onLatency?.({
          sttLatency: 0,
          llmLatency: llmEnd - llmStart,
          ttsLatency: 0,
          totalLatency: llmEnd - startTime,
        });
      },
      close() {
        controllerRef?.close();
      },
      abort() {
        controllerRef?.close();
      },
    });
  }
}

class SentenceBoundaryNode extends PipelineNode<string, string> {
  private transform: ReturnType<typeof createSentenceBoundaryTransform>;

  constructor(chunkOnCommas: boolean, maxChunkTokens: number) {
    super({ id: "sentence-boundary" });
    this.transform = createSentenceBoundaryTransform({
      chunkOnCommas,
      maxChunkTokens,
      signal: this.getSignal(),
    });
  }

  async setup(): Promise<void> {
    this.readable = this.transform.getReadable();
    this.writable = this.transform.getWritable();
  }
}

export { VoicePipeline };

export type { VoicePipelineConfig };

export function createVoicePipeline(config: VoicePipelineConfig): VoicePipeline {
  const pipeline = new VoicePipeline(config);

  const vadNode = new VADNode({
    id: "vad",
    engine: config.vad.engine,
    threshold: config.vad.threshold,
    silenceDurationMs: config.vad.silenceDurationMs,
    speechProbabilityThreshold: config.vad.speechProbabilityThreshold,
  });

  const sttNode = new STTNode(config.stt);
  const orchestratorNode = new OrchestratorNode(config, (latency) => pipeline.emitLatency(latency));
  const sentenceBoundaryNode = new SentenceBoundaryNode(
    config.chunkOnCommas ?? false,
    config.maxChunkTokens ?? 50,
  );
  const ttsNode = new TTSNode(config.tts, config.ttsOptions);
  const outputNode = new OutputBufferNode({
    id: "output-buffer",
    lookaheadMs: config.outputBufferLookaheadMs ?? 100,
    transportAdapter: config.transport,
  });

  pipeline.setNodes([
    vadNode as unknown as PipelineNode,
    sttNode as unknown as PipelineNode,
    orchestratorNode as unknown as PipelineNode,
    sentenceBoundaryNode as unknown as PipelineNode,
    ttsNode as unknown as PipelineNode,
    outputNode as unknown as PipelineNode,
  ]);

  return pipeline;
}
