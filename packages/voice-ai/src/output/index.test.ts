import { describe, expect, it } from "vitest";
import { OutputBufferNode } from "./index.js";

function makePcmChunk(samples: number): Uint8Array {
  const arr = new Int16Array(samples);
  for (let i = 0; i < samples; i++) arr[i] = Math.sin(i / 10) * 20000;
  return new Uint8Array(arr.buffer);
}

describe("OutputBufferNode", () => {
  it("queues and outputs sequentially", async () => {
    const node = new OutputBufferNode({ id: "out" });
    await node.setup();

    const writer = node.getWritable().getWriter();
    await writer.write(makePcmChunk(320));
    await writer.write(makePcmChunk(320));

    expect(node.queueLength).toBeGreaterThanOrEqual(1);
    expect(node.queuedBytes).toBeGreaterThan(0);
  });

  it("flushes queue on abort", async () => {
    const node = new OutputBufferNode({ id: "out" });
    await node.setup();

    const writer = node.getWritable().getWriter();
    await writer.write(makePcmChunk(640));
    node.getAbortController().abort();

    expect(node.queueLength).toBe(0);
    expect(node.queuedBytes).toBe(0);
    expect(node.playing).toBe(false);
  });
});
