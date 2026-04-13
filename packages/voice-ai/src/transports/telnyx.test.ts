import { describe, expect, it } from "vitest";
import { TelnyxTransportAdapter } from "./telnyx.js";

describe("TelnyxTransportAdapter", () => {
  it("extracts caller metadata on start event", () => {
    const adapter = new TelnyxTransportAdapter();
    const fakeWs = {
      OPEN: 1,
      readyState: 1,
      onmessage: null as ((event: MessageEvent) => void) | null,
      onclose: null as (() => void) | null,
      send: () => {},
      close: () => {},
    } as unknown as WebSocket;

    adapter.attachWebSocket(fakeWs);
    fakeWs.onmessage?.({
      data: JSON.stringify({
        event: "start",
        call_details: { from: "+123", to: "+456" },
      }),
    } as MessageEvent);

    expect(adapter.session.callerNumber).toBe("+123");
    expect(adapter.session.calleeNumber).toBe("+456");
  });
});
