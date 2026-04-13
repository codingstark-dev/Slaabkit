import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import { TwilioTransportAdapter } from "@Slaabkit/voice-ai/transports/twilio";

const app = new Hono();

app.get("/", (c) => c.text("voice-twilio example running"));

app.get(
  "/twilio/ws",
  upgradeWebSocket(() => {
    const adapter = new TwilioTransportAdapter();
    return {
      onMessage(event, ws) {
        if (!adapter) return;
        if (!(adapter as any)._attached) {
          adapter.attachWebSocket(ws.raw as unknown as WebSocket);
          (adapter as any)._attached = true;
        }
        void event;
      },
      onClose() {},
      onError() {},
    };
  }),
);

export default app;
