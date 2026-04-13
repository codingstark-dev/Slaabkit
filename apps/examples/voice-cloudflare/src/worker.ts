import { CloudflareCallsTransportAdapter } from "@Slaabkit/voice-ai/transports/cloudflare-calls";

export default {
  async fetch(req: Request, env: Record<string, string>) {
    if (new URL(req.url).pathname === "/") {
      return new Response("voice-cloudflare example running");
    }

    if (new URL(req.url).pathname === "/calls/init") {
      const adapter = new CloudflareCallsTransportAdapter({
        appId: env.CLOUDFLARE_CALLS_APP_ID,
        token: env.CLOUDFLARE_CALLS_TOKEN,
      });
      return new Response(JSON.stringify({ ok: true, adapter: adapter.constructor.name }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
