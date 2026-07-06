# Slaabkit

Slaabkit is a Bun-first TypeScript toolkit for building realtime voice AI agents. It combines a composable voice pipeline with transport adapters for telephony, WebRTC, and browser WebSockets so teams can prototype and test spoken AI experiences without wiring every audio stage from scratch.

The core package is `@Slaabkit/voice-ai`, an edge-oriented pipeline that connects:

- voice activity detection
- speech-to-text
- LLM orchestration
- sentence boundary chunking
- text-to-speech
- output buffering and playback

## Features

- **Streaming pipeline**: WHATWG Streams connect each voice stage and keep the runtime portable.
- **Pluggable transports**: Twilio, Vonage, Telnyx, Plivo, Daily, Cloudflare Calls, and browser WebSocket adapters.
- **Interruptible sessions**: Abort-signal based interruption handling for realtime voice conversations.
- **Provider adapters**: OpenAI TTS, Deepgram STT, Vercel AI, Mastra, and VoltAgent integration points.
- **Bun-native workspace**: Bun, TypeScript, Hono, Turborepo, and focused example apps.

## Repository Layout

```txt
Slaabkit/
|-- apps/
|   |-- server/              # Hono API scaffold
|   |-- web-voice-call/      # Browser voice-call demo
|   `-- examples/            # Provider and transport examples
|-- packages/
|   |-- config/              # Shared TypeScript config
|   |-- env/                 # Shared environment validation helpers
|   `-- voice-ai/            # Core voice AI pipeline package
|-- package.json
`-- turbo.json
```

## Quick Start

Install dependencies:

```bash
bun install
```

Run all development targets:

```bash
bun run dev
```

Run the browser voice-call demo:

```bash
bunx turbo -F web-voice-call dev
```

Open the local URL printed by the command, then join the call and send text or microphone audio through the demo pipeline.

## Browser Voice Demo

`apps/web-voice-call` shows the framework running through a browser WebSocket transport.

- Browser speech recognition can provide transcripts when supported.
- OpenAI chat and speech are used when `OPENAI_API_KEY` is set.
- Without provider keys, the demo falls back to local echo responses and generated tones.
- Deepgram STT can be enabled with `DEEPGRAM_API_KEY`.

See [apps/web-voice-call/README.md](apps/web-voice-call/README.md) for setup details and sanity checks.

## Provider Examples

The `apps/examples` directory contains transport-specific scaffolds:

- [Twilio Media Streams](apps/examples/voice-twilio/README.md)
- [Vonage Voice API](apps/examples/voice-vonage/README.md)
- [Daily WebRTC](apps/examples/voice-daily/README.md)
- [Cloudflare Calls](apps/examples/voice-cloudflare/README.md)

These examples are intended as integration starting points for local testing and provider-backed voice agents.

## Core Package

The voice pipeline lives in `packages/voice-ai`.

```ts
import { createVoicePipeline } from "@Slaabkit/voice-ai";
import { BrowserWsTransportAdapter } from "@Slaabkit/voice-ai/transports/browser-ws";
```

Core exports include:

- `createVoicePipeline`
- `VoicePipeline`
- `PipelineNode`
- `TransportAdapter`
- `STTAdapter`
- `TTSAdapter`
- `CognitiveOrchestrator`

See [packages/voice-ai/README.md](packages/voice-ai/README.md) for the package API surface and adapter imports.

## Useful Commands

```bash
bun run dev
bun run build
bun run check-types
bun run dev:server
bunx turbo -F @Slaabkit/voice-ai test
bunx turbo -F web-voice-call dev
```

## Status

Slaabkit is an early-stage voice AI toolkit. The repository includes a working browser demo, core pipeline tests, and transport scaffolds that are ready to adapt for production providers.
