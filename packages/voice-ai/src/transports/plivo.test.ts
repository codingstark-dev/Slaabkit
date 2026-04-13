import { describe, expect, it } from "vitest";
import { PlivoTransportAdapter } from "./plivo.js";

describe("PlivoTransportAdapter", () => {
  it("captures dtmf events", async () => {
    const adapter = new PlivoTransportAdapter();
    const fakeWs = {
      OPEN: 1,
      readyState: 1,
      onmessage: null as ((event: MessageEvent) => void) | null,
      onclose: null as (() => void) | null,
      send: () => {},
      close: () => {},
    } as unknown as WebSocket;

    let digit = "";
    adapter.onDTMF((event) => {
      digit = event.detail.digit;
    });

    adapter.attachWebSocket(fakeWs);
    fakeWs.onmessage?.({
      data: JSON.stringify({ event: "dtmf", digit: "5" }),
    } as MessageEvent);

    expect(digit).toBe("5");
  });
});
