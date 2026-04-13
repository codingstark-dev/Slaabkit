import { describe, expect, it } from "vitest";
import { VADNode } from "./index.js";

function pcmChunk(amplitude: number, samples = 480): Uint8Array {
  const data = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    data[i] = (Math.sin(i / 8) * amplitude) | 0;
  }
  return new Uint8Array(data.buffer);
}

describe("VADNode", () => {
  it("emits speech events", async () => {
    const node = new VADNode({ id: "vad", engine: "webrtc", threshold: 0.2, silenceDurationMs: 10 });
    await node.setup();

    let started = 0;
    let ended = 0;
    node.onSpeechStart(() => started++);
    node.onSpeechEnd(() => ended++);

    const writer = node.getWritable().getWriter();
    await writer.write(pcmChunk(20000));
    await new Promise((r) => setTimeout(r, 20));
    await writer.write(pcmChunk(0));
    await new Promise((r) => setTimeout(r, 20));

    expect(started).toBeGreaterThanOrEqual(1);
    expect(ended).toBeGreaterThanOrEqual(1);
  });
});
