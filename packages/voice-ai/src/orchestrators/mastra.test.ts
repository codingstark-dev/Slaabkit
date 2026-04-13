import { describe, expect, it } from "vitest";
import { MastraOrchestrator } from "./mastra.js";

describe("MastraOrchestrator", () => {
  it("supports async iterable output", async () => {
    const orchestrator = new MastraOrchestrator({
      generate: async () => ({
        textStream: (async function* () {
          yield "a";
          yield "b";
        })(),
      }),
    });

    const stream = orchestrator.generate("hello", { messages: [], sessionId: "x", metadata: {} });
    const reader = stream.getReader();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
    }
    expect(text).toBe("ab");
  });
});
