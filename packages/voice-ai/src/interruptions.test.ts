import { describe, expect, it } from "vitest";
import { VADNode } from "./vad/index.js";
import { OutputBufferNode } from "./output/index.js";

function pcmChunk(amplitude: number, samples = 480): Uint8Array {
  const data = new Int16Array(samples);
  for (let i = 0; i < samples; i++) data[i] = (Math.sin(i / 8) * amplitude) | 0;
  return new Uint8Array(data.buffer);
}

describe("interruption cascade behavior", () => {
  it("signals interruption when user speech detected during playback", async () => {
    const vad = new VADNode({ id: "vad", engine: "webrtc", threshold: 0.2, silenceDurationMs: 10 });
    await vad.setup();

    const output = new OutputBufferNode({ id: "out" });
    await output.setup();

    let interrupted = false;
    vad.onInterruption(() => {
      interrupted = true;
      output.getAbortController().abort();
    });

    vad.setAgentSpeaking(true);
    const writer = vad.getWritable().getWriter();
    await writer.write(pcmChunk(20000));
    await new Promise((r) => setTimeout(r, 20));

    expect(interrupted).toBe(true);
    expect(output.queueLength).toBe(0);
  });
});
