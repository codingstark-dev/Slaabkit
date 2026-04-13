import { describe, expect, it } from "vitest";
import { createSentenceBoundaryTransform } from "./index.js";

async function collect(readable: ReadableStream<string>): Promise<string[]> {
  const reader = readable.getReader();
  const out: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("SentenceBoundaryTransform", () => {
  it("chunks on sentence punctuation", async () => {
    const transform = createSentenceBoundaryTransform();
    const writer = transform.getWritable().getWriter();
    await writer.write("Hello");
    await writer.write(" there.");
    await writer.write(" How are");
    await writer.write(" you?");
    await writer.close();

    const chunks = await collect(transform.getReadable());
    expect(chunks).toEqual(["Hello there.", "How are you?"]);
  });

  it("chunks on commas when enabled", async () => {
    const transform = createSentenceBoundaryTransform({ chunkOnCommas: true });
    const writer = transform.getWritable().getWriter();
    await writer.write("Actually,");
    await writer.write(" let me check.");
    await writer.close();

    const chunks = await collect(transform.getReadable());
    expect(chunks).toEqual(["Actually,", "let me check."]);
  });

  it("forces chunk by max token count", async () => {
    const transform = createSentenceBoundaryTransform({ maxChunkTokens: 3 });
    const writer = transform.getWritable().getWriter();
    await writer.write("one");
    await writer.write(" two");
    await writer.write(" three");
    await writer.write(" four");
    await writer.close();

    const chunks = await collect(transform.getReadable());
    expect(chunks[0]).toContain("one two three");
    expect(chunks[chunks.length - 1]).toContain("four");
  });

  it("flushes buffered text on abort", async () => {
    const ac = new AbortController();
    const transform = createSentenceBoundaryTransform({ signal: ac.signal });
    const writer = transform.getWritable().getWriter();
    await writer.write("partial sentence");
    ac.abort();
    await writer.close().catch(() => {});

    const chunks = await collect(transform.getReadable());
    expect(chunks).toContain("partial sentence");
  });
});
