import { describe, expect, it } from "vitest";
import { VonageTransportAdapter } from "./vonage.js";

describe("VonageTransportAdapter", () => {
  it("generates NCCO websocket endpoint", () => {
    const adapter = new VonageTransportAdapter({ websocketUrl: "wss://example.com/vonage" });
    const ncco = adapter.generateNCCO("https://example.com/answer");
    expect(Array.isArray(ncco)).toBe(true);
    expect((ncco[0] as any).action).toBe("connect");
  });
});
