# Web Voice Call Example

Browser-to-agent voice demo using `@Slaabkit/voice-ai` with a WebSocket transport adapter.

## Run

From repo root:

```bash
bun install
bunx turbo -F web-voice-call dev
```

Optional custom port:

```bash
PORT=3020 bunx turbo -F web-voice-call dev
```

Open the shown URL (default `http://localhost:3010`), then:

1. Click **Join**.
2. Click **Start Call** to stream microphone audio.
3. Speak and watch transcript / assistant logs.
4. Click **Hang Up** to pause streaming.

## Quick sanity checks

If audio still does not work, verify these in order:

1. Server is running and healthy:

```bash
curl http://localhost:3010/health
```

2. WebSocket endpoint is reachable:

```bash
bun -e 'const ws=new WebSocket("ws://localhost:3010/ws/agent"); ws.onopen=()=>ws.send(JSON.stringify({type:"ping"})); ws.onmessage=(e)=>{const m=JSON.parse(String(e.data)); if(m.type==="pong"){console.log("ok"); process.exit(0)}}; setTimeout(()=>process.exit(1),2000)'
```

3. In browser, click **Join** and use **Send Text** first. This validates the full server pipeline even when microphone capture is blocked.

4. For mic streaming, run on `http://localhost` (not `file://`) and allow microphone permissions.

5. Voice transcripts in this demo require browser speech recognition support. If unsupported, use **Send Text**.

## How it is wired

- `src/server.ts` creates a pipeline with `createVoicePipeline(...)`
- Transport is `BrowserWsTransportAdapter` (`@Slaabkit/voice-ai/transports/browser-ws`)
- Browser sends base64 PCM frames over `/ws/agent`
- Pipeline output audio is streamed back to browser and played via Web Audio API

## Current behavior

- STT in this browser demo comes from browser speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`) and is sent to server as `text` events
- Orchestrator uses OpenAI chat completions when `OPENAI_API_KEY` is set; otherwise falls back to local echo mode
- TTS uses OpenAI speech when `OPENAI_API_KEY` is set; otherwise falls back to a local tone generator

This proves end-to-end framework integration. Replace STT/orchestrator/TTS adapters in `src/server.ts` with provider-backed adapters for production voice AI.

## Enable real AI responses

Set these env vars before starting dev server:

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_MODEL="gpt-4o-mini"
export OPENAI_TTS_VOICE="alloy"
export DEEPGRAM_API_KEY="your_deepgram_key_here"
export DEEPGRAM_MODEL="nova-3"
export DEEPGRAM_LANGUAGE="en-US"
```

Then run:

```bash
bunx turbo -F web-voice-call dev
```

When connected, logs should show `LLM mode: openai ...` instead of fallback echo mode.

For real microphone transcription, logs should show `STT mode: deepgram ...`.

## Files

- `src/server.ts`: pipeline + websocket session wiring
- `public/index.html`: UI
- `public/app.js`: mic capture + audio playback + socket protocol
- `public/styles.css`: styling
