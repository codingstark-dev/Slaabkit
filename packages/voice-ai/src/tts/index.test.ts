import { describe, expect, it } from "vitest";
import { TTSNode } from "./index.js";
import type { TTSAdapter } from "../types/index.js";

class MockTTSAdapter implements TTSAdapter {
  synthesize(text: string): ReadableStream<Uint8Array> {
    const payload = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    });
  }
}

describe("TTSNode", () => {
  it("streams synthesized chunks", async () => {
    const node = new TTSNode(new MockTTSAdapter());
    await node.setup();
    const writer = node.getWritable().getWriter();
    const reader = node.getReadable().getReader();

    await writer.write("hello");
    await writer.close();

    const { value } = await reader.read();
    expect(value).toBeInstanceOf(Uint8Array);
    expect((value as Uint8Array).byteLength).toBeGreaterThan(0);
  });
});
