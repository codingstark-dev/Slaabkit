import { describe, expect, it } from "vitest";
import { createVoicePipeline } from "./core/create-pipeline.js";
import type { STTAdapter, TranscriptEvent, TransportAdapter, TTSAdapter, CognitiveOrchestrator } from "./types/index.js";

class IntTransport implements TransportAdapter {
  readonly session = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private ingress = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.ingressController = controller;
    },
  });
  private egressChunks: Uint8Array[] = [];
  private egress = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.egressChunks.push(chunk);
    },
  });
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  createIngressStream(): ReadableStream<Uint8Array> { return this.ingress; }
  createEgressStream(): WritableStream<Uint8Array> { return this.egress; }
  push(chunk: Uint8Array): void { this.ingressController?.enqueue(chunk); }
  get outputCount(): number { return this.egressChunks.length; }
}

class IntSTT implements STTAdapter {
  private controller: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private stream = new ReadableStream<TranscriptEvent>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getTranscriptStream(): ReadableStream<TranscriptEvent> { return this.stream; }
  sendAudio(): void {
    this.controller?.enqueue({ text: "hello", isFinal: true, confidence: 1 });
  }
}

class IntOrchestrator implements CognitiveOrchestrator {
  generate(): ReadableStream<string> {
    return new ReadableStream<string>({
      start(controller) {
        controller.enqueue("Hello.");
        controller.close();
      },
    });
  }
}

class IntTTS implements TTSAdapter {
  synthesize(text: string): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }
}

describe("voice pipeline integration", () => {
  it("runs full chain and emits lifecycle", async () => {
    const transport = new IntTransport();
    const pipeline = createVoicePipeline({
      transport,
      vad: { id: "vad", engine: "webrtc", threshold: 0.2, silenceDurationMs: 10 },
      stt: new IntSTT(),
      orchestrator: new IntOrchestrator(),
      tts: new IntTTS(),
    });

    let startSeen = false;
    let stopSeen = false;
    pipeline.on("pipeline:start", () => { startSeen = true; });
    pipeline.on("pipeline:stop", () => { stopSeen = true; });

    await pipeline.start();
    transport.push(new Uint8Array(new Int16Array(480).buffer));
    await new Promise((r) => setTimeout(r, 50));
    pipeline.stop();

    expect(startSeen).toBe(true);
    expect(stopSeen).toBe(true);
  });
});
