# @Slaabkit/voice-ai

Edge-native Voice AI pipeline framework for Bun/Node/Workers.

## Features

- WHATWG Streams-first pipeline orchestration
- Pluggable transports: Twilio, Vonage, Telnyx, Plivo, Daily, Cloudflare Calls
- VAD -> STT -> LLM Orchestrator -> Sentence Boundary -> TTS -> Output
- Abort-driven interruption handling
- Adapter-based cognitive orchestration (Vercel AI, Mastra, VoltAgent)

## Quick Start

```ts
import { createVoicePipeline } from "@Slaabkit/voice-ai";
import { TwilioTransportAdapter } from "@Slaabkit/voice-ai/transports/twilio";
import { DeepgramSTTAdapter } from "@Slaabkit/voice-ai/stt";
import { VercelAIOrchestrator } from "@Slaabkit/voice-ai/orchestrators/vercel-ai";
import { OpenAITTSAdapter } from "@Slaabkit/voice-ai/tts";

const pipeline = createVoicePipeline({
  transport: new TwilioTransportAdapter(),
  vad: { id: "vad", engine: "webrtc", threshold: 0.2 },
  stt: new DeepgramSTTAdapter(process.env.DEEPGRAM_API_KEY!),
  orchestrator: new VercelAIOrchestrator({
    model: "openai/gpt-4o-mini",
    streamText: ({ model, messages, abortSignal }) => {
      throw new Error("Provide ai SDK streamText implementation");
    },
  }),
  tts: new OpenAITTSAdapter(process.env.OPENAI_API_KEY!),
});

await pipeline.start();
```

## API Surface

- Core: `createVoicePipeline`, `VoicePipeline`, `PipelineNode`
- Types: `VoicePipelineConfig`, `TransportAdapter`, `STTAdapter`, `TTSAdapter`, `CognitiveOrchestrator`
- Sub-path adapters:
  - `@Slaabkit/voice-ai/transports/twilio`
  - `@Slaabkit/voice-ai/transports/vonage`
  - `@Slaabkit/voice-ai/transports/telnyx`
  - `@Slaabkit/voice-ai/transports/plivo`
  - `@Slaabkit/voice-ai/transports/daily`
  - `@Slaabkit/voice-ai/transports/cloudflare-calls`
  - `@Slaabkit/voice-ai/transports/browser-ws`

## Development

- Type check: `bun run -F @Slaabkit/voice-ai check-types`
- Build: `bun run -F @Slaabkit/voice-ai build`
- Test: `bun run -F @Slaabkit/voice-ai test`
