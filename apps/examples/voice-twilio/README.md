# Voice Twilio Example

This example demonstrates Twilio Media Streams + STT/LLM/TTS orchestration using `@Slaabkit/voice-ai`.

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies from repo root: `bun install`.
3. Run: `bun run --watch src/server.ts`.
4. Point your Twilio `<Stream>` websocket URL to `/twilio/ws`.

## Notes

- This is a working scaffold intended for local testing.
- Set Twilio call webhook to your local tunnel URL.
