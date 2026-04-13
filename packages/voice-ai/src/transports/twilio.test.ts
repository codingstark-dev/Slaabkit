import { describe, expect, it } from "vitest";
import { TwilioTransportAdapter } from "./twilio.js";
import { uint8ArrayToBase64 } from "./utils.js";

describe("TwilioTransportAdapter", () => {
  it("decodes inbound media payload", async () => {
    const adapter = new TwilioTransportAdapter();

    const sent: string[] = [];
    const fakeWs = {
      OPEN: 1,
      readyState: 1,
      onmessage: null as ((event: MessageEvent) => void) | null,
      onclose: null as (() => void) | null,
      send: (payload: string) => sent.push(payload),
      close: () => {},
    } as unknown as WebSocket;

    adapter.attachWebSocket(fakeWs);
    const reader = adapter.createIngressStream().getReader();

    const mulawPayload = uint8ArrayToBase64(new Uint8Array([255, 127, 0, 64]));
    fakeWs.onmessage?.({
      data: JSON.stringify({ event: "media", media: { payload: mulawPayload } }),
    } as MessageEvent);

    const { value } = await reader.read();
    expect(value).toBeInstanceOf(Uint8Array);
    expect((value as Uint8Array).byteLength).toBeGreaterThan(0);
  });
});
