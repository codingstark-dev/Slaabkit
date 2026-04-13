import { describe, expect, it } from "vitest";
import { createVoicePipeline } from "./create-pipeline.js";
import type {
  CognitiveOrchestrator,
  STTAdapter,
  TranscriptEvent,
  TransportAdapter,
  TTSAdapter,
} from "../types/index.js";

class MockTransport implements TransportAdapter {
  readonly session = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private ingress = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.ingressController = controller;
    },
  });
  private egress = new WritableStream<Uint8Array>();
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  createIngressStream(): ReadableStream<Uint8Array> {
    return this.ingress;
  }
  createEgressStream(): WritableStream<Uint8Array> {
    return this.egress;
  }
  push(chunk: Uint8Array): void {
    this.ingressController?.enqueue(chunk);
  }
}

class MockSTT implements STTAdapter {
  private controller: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private stream = new ReadableStream<TranscriptEvent>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getTranscriptStream(): ReadableStream<TranscriptEvent> {
    return this.stream;
  }
  sendAudio(): void {
    this.controller?.enqueue({ text: "hello", isFinal: true, confidence: 1 });
  }
}

class MockOrchestrator implements CognitiveOrchestrator {
  generate(): ReadableStream<string> {
    return new ReadableStream<string>({
      start(controller) {
        controller.enqueue("hi.");
        controller.close();
      },
    });
  }
}

class MockTTS implements TTSAdapter {
  synthesize(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
  }
}

describe("createVoicePipeline", () => {
  it("creates pipeline and supports lifecycle", async () => {
    const transport = new MockTransport();
    const pipeline = createVoicePipeline({
      transport,
      vad: { id: "vad", engine: "webrtc" },
      stt: new MockSTT(),
      orchestrator: new MockOrchestrator(),
      tts: new MockTTS(),
    });

    let started = false;
    let stopped = false;
    pipeline.on("pipeline:start", () => {
      started = true;
    });
    pipeline.on("pipeline:stop", () => {
      stopped = true;
    });

    await pipeline.start();
    pipeline.stop();

    expect(started).toBe(true);
    expect(stopped).toBe(true);
  });
});
