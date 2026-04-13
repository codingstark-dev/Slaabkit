import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { VonageTransportAdapter } from "@Slaabkit/voice-ai/transports/vonage";

const app = new Hono();

app.get("/", (c) => c.text("voice-vonage example running"));

app.get("/vonage/ncco", (c) => {
  const wsUrl = process.env.VONAGE_WEBSOCKET_URL ?? "wss://example.com/vonage/ws";
  const adapter = new VonageTransportAdapter({ websocketUrl: wsUrl });
  return c.json(adapter.generateNCCO(""));
});

app.get(
  "/vonage/ws",
  upgradeWebSocket(() => {
    const adapter = new VonageTransportAdapter({
      websocketUrl: process.env.VONAGE_WEBSOCKET_URL ?? "wss://example.com/vonage/ws",
    });
    return {
      onOpen(_event, ws) {
        (adapter as any).ws = ws.raw as unknown as WebSocket;
      },
      onMessage() {},
      onClose() {},
      onError() {},
    };
  }),
);

export default app;
