import { describe, expect, it } from "vitest";
import { BrowserWsTransportAdapter } from "./browser-ws.js";
import { base64ToUint8Array } from "./utils.js";

describe("BrowserWsTransportAdapter", () => {
  it("bridges ingress and egress streams", async () => {
    const outbound: unknown[] = [];

    const adapter = new BrowserWsTransportAdapter({
      send: (message) => {
        outbound.push(message);
      },
      session: {
        callId: "call-1",
      },
    });

    await adapter.start();

    const ingressReader = adapter.createIngressStream().getReader();
    adapter.pushAudioChunk(new Uint8Array([1, 2, 3, 4]));

    const ingressResult = await ingressReader.read();
    expect(ingressResult.value).toBeInstanceOf(Uint8Array);
    expect(Array.from(ingressResult.value ?? [])).toEqual([1, 2, 3, 4]);

    const egressWriter = adapter.createEgressStream().getWriter();
    await egressWriter.write(new Uint8Array([9, 8, 7]));

    const audioMessage = outbound.find(
      (entry): entry is { type: "audio"; audio: string } =>
        typeof entry === "object" && entry !== null && (entry as { type?: string }).type === "audio",
    );

    expect(audioMessage).toBeDefined();
    expect(Array.from(base64ToUint8Array(audioMessage?.audio ?? ""))).toEqual([9, 8, 7]);

    await adapter.stop();

    const clearMessage = outbound.find(
      (entry): entry is { type: "clear" } =>
        typeof entry === "object" && entry !== null && (entry as { type?: string }).type === "clear",
    );

    expect(clearMessage).toBeDefined();

    const afterStop = await ingressReader.read();
    expect(afterStop.done).toBe(true);
  });

  it("supports base64 ingress and explicit clear", async () => {
    const outbound: unknown[] = [];

    const adapter = new BrowserWsTransportAdapter({
      send: (message) => {
        outbound.push(message);
      },
    });

    await adapter.start();

    const ingressReader = adapter.createIngressStream().getReader();
    adapter.pushBase64Audio("AQID");

    const ingressResult = await ingressReader.read();
    expect(Array.from(ingressResult.value ?? [])).toEqual([1, 2, 3]);

    adapter.clearOutput();
    expect(
      outbound.some(
        (entry) =>
          typeof entry === "object" && entry !== null && (entry as { type?: string }).type === "clear",
      ),
    ).toBe(true);

    await adapter.stop();
  });
});
