import { describe, expect, it } from "vitest";
import { VercelAIOrchestrator } from "./vercel-ai.js";

describe("VercelAIOrchestrator", () => {
  it("streams text and updates context", async () => {
    const orchestrator = new VercelAIOrchestrator({
      model: "fake",
      streamText: () => ({
        textStream: (async function* () {
          yield "hello";
          yield " world";
        })(),
      }),
    });

    const context = { messages: [], sessionId: "s1", metadata: {} };
    const stream = orchestrator.generate("hi", context);
    const reader = stream.getReader();
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += value;
    }

    expect(out).toBe("hello world");
    expect(context.messages.length).toBe(2);
  });
});
