import { describe, expect, it } from "vitest";
import { VoltAgentOrchestrator } from "./voltagent.js";

describe("VoltAgentOrchestrator", () => {
  it("supports non-stream response", async () => {
    const orchestrator = new VoltAgentOrchestrator({
      generate: async () => ({ text: "response" }),
    });

    const stream = orchestrator.generate("hello", { messages: [], sessionId: "x", metadata: {} });
    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toContain("response");
  });
});
