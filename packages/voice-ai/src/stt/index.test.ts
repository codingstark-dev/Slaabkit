import { describe, expect, it } from "vitest";
import { STTNode } from "./index.js";
import type { STTAdapter, TranscriptEvent } from "../types/index.js";

class MockSTTAdapter implements STTAdapter {
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
    this.controller?.enqueue({ text: "partial", isFinal: false, confidence: 0.5 });
    this.controller?.enqueue({ text: "final", isFinal: true, confidence: 0.9 });
  }
}

describe("STTNode", () => {
  it("routes interim and final transcripts", async () => {
    const node = new STTNode(new MockSTTAdapter());
    await node.setup();

    const finalReader = node.getReadable().getReader();
    const interimReader = node.getInterimStream().getReader();
    const writer = node.getWritable().getWriter();

    await writer.write(new Uint8Array([1, 2, 3]));

    const interim = await interimReader.read();
    const final = await finalReader.read();

    expect(interim.value?.isFinal).toBe(false);
    expect(final.value?.isFinal).toBe(true);
  });
});
