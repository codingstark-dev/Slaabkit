import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/transports/twilio.ts",
    "src/transports/vonage.ts",
    "src/transports/telnyx.ts",
    "src/transports/plivo.ts",
    "src/transports/daily.ts",
    "src/transports/cloudflare-calls.ts",
    "src/transports/browser-ws.ts",
    "src/vad/index.ts",
    "src/stt/index.ts",
    "src/orchestrators/vercel-ai.ts",
    "src/orchestrators/mastra.ts",
    "src/orchestrators/voltagent.ts",
    "src/tts/index.ts",
    "src/output/index.ts",
    "src/sentence-boundary/index.ts",
  ],
  format: "esm",
  dts: true,
  clean: true,
});
