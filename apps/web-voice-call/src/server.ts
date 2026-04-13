import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import { createVoicePipeline } from "@Slaabkit/voice-ai";
import { BrowserWsTransportAdapter } from "@Slaabkit/voice-ai/transports/browser-ws";
import { OpenAITTSAdapter } from "@Slaabkit/voice-ai/tts";
import { DeepgramSTTAdapter } from "@Slaabkit/voice-ai/stt";
import { config as loadDotenv } from "dotenv";
import type {
  CognitiveOrchestrator,
  ConversationContext,
  STTAdapter,
  TranscriptEvent,
  TTSAdapter,
} from "@Slaabkit/voice-ai";

type AgentClientMessage =
  | { type: "audio"; audio: string }
  | { type: "text"; text: string }
  | { type: "start" }
  | { type: "stop" }
  | { type: "ping" };

type AgentServerMessage =
  | { type: "ready"; clientId: string }
  | { type: "status"; message: string }
  | { type: "transcript"; text: string }
  | { type: "assistant-text"; text: string }
  | { type: "audio"; audio: string }
  | { type: "clear" }
  | { type: "latency"; llmLatency: number; totalLatency: number }
  | { type: "pong" }
  | { type: "error"; message: string };

type AgentSession = {
  transport: BrowserWsTransportAdapter;
  stt: STTAdapter;
  pipeline: ReturnType<typeof createVoicePipeline>;
  started: boolean;
  sttMode: "deepgram" | "browser-text";
  llmMode: "openai" | "fallback";
  ttsMode: "openai" | "fallback";
};

const app = new Hono();

loadDotenv({ path: `${import.meta.dir}/../.env` });
loadDotenv({ path: `${import.meta.dir}/../../../.env` });

const publicDir = `${import.meta.dir}/../public`;
const sessions = new Map<string, AgentSession>();

const fallbackPort = 3010;
const rawPort = Number(process.env.PORT ?? Bun.env.PORT);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : fallbackPort;

const openAIApiKey = process.env.OPENAI_API_KEY?.trim() || Bun.env.OPENAI_API_KEY?.trim();
const openAIModel = process.env.OPENAI_MODEL?.trim() || Bun.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const openAIBaseUrl =
  process.env.OPENAI_BASE_URL?.trim() || Bun.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com";
const openAITTSVoice =
  process.env.OPENAI_TTS_VOICE?.trim() || Bun.env.OPENAI_TTS_VOICE?.trim() || "alloy";
const deepgramApiKey = process.env.DEEPGRAM_API_KEY?.trim() || Bun.env.DEEPGRAM_API_KEY?.trim();
const deepgramModel = process.env.DEEPGRAM_MODEL?.trim() || "nova-3";
const deepgramLanguage = process.env.DEEPGRAM_LANGUAGE?.trim() || "en-US";

function randomId() {
  return crypto.randomUUID();
}

function sendJson(ws: { send: (payload: string) => void }, payload: AgentServerMessage) {
  ws.send(JSON.stringify(payload));
}

function makeWsSender(ws: { send: (payload: string) => void }) {
  return (payload: AgentServerMessage) => sendJson(ws, payload);
}

async function getPublicFileResponse(path: string, contentType: string) {
  const file = Bun.file(`${publicDir}/${path}`);
  if (!(await file.exists())) {
    return null;
  }
  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}

class BrowserPassThroughSTTAdapter implements STTAdapter {
  private transcriptController: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private readonly transcriptStream: ReadableStream<TranscriptEvent>;
  private readonly onTranscript?: (text: string) => void;

  constructor(onTranscript?: (text: string) => void) {
    this.onTranscript = onTranscript;
    this.transcriptStream = new ReadableStream<TranscriptEvent>({
      start: (controller) => {
        this.transcriptController = controller;
      },
    });
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.transcriptController?.close();
    this.transcriptController = null;
  }

  getTranscriptStream(): ReadableStream<TranscriptEvent> {
    return this.transcriptStream;
  }

  sendAudio(_chunk: Uint8Array): void {
    // Intentionally no-op in this browser example.
    // Real STT in this demo comes from browser speech recognition via `text` events.
  }

  emitTextTranscript(text: string): void {
    const value = text.trim();
    if (value.length === 0) {
      return;
    }

    this.transcriptController?.enqueue({
      text: value,
      isFinal: true,
      confidence: 1,
    });

    this.onTranscript?.(value);
  }
}

class LocalEchoOrchestrator implements CognitiveOrchestrator {
  private readonly onAssistantText?: (text: string) => void;
  private readonly onUserText?: (text: string) => void;

  constructor(onAssistantText?: (text: string) => void, onUserText?: (text: string) => void) {
    this.onAssistantText = onAssistantText;
    this.onUserText = onUserText;
  }

  generate(transcript: string, context: ConversationContext): ReadableStream<string> {
    this.onUserText?.(transcript);
    const response = `Assistant heard: ${transcript}.`;

    context.messages.push({ role: "user", content: transcript });
    context.messages.push({ role: "assistant", content: response });
    this.onAssistantText?.(response);

    return new ReadableStream<string>({
      start(controller) {
        controller.enqueue(response);
        controller.close();
      },
    });
  }
}

class OpenAIChatOrchestrator implements CognitiveOrchestrator {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly onAssistantText?: (text: string) => void;
  private readonly onUserText?: (text: string) => void;

  constructor(config: {
    apiKey: string;
    model: string;
    baseUrl: string;
    onAssistantText?: (text: string) => void;
    onUserText?: (text: string) => void;
  }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.onAssistantText = config.onAssistantText;
    this.onUserText = config.onUserText;
  }

  generate(transcript: string, context: ConversationContext, signal?: AbortSignal): ReadableStream<string> {
    this.onUserText?.(transcript);
    return new ReadableStream<string>({
      start: async (controller) => {
        try {
          const messages = [
            {
              role: "system",
              content:
                "You are a helpful realtime voice assistant. Give concise responses unless asked for detail.",
            },
            ...context.messages,
            { role: "user", content: transcript },
          ];

          const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.model,
              messages,
              temperature: 0.4,
            }),
            signal,
          });

          if (!response.ok) {
            controller.error(
              new Error(`OpenAI chat error: ${response.status} ${response.statusText}`),
            );
            return;
          }

          const data = (await response.json()) as {
            choices?: Array<{
              message?: {
                content?: string;
              };
            }>;
          };

          const text = data.choices?.[0]?.message?.content?.trim() || "I heard you, but I have no answer yet.";

          context.messages.push({ role: "user", content: transcript });
          context.messages.push({ role: "assistant", content: text });
          this.onAssistantText?.(text);

          const chunks = text.split(/(\s+)/).filter((chunk) => chunk.length > 0);
          for (const chunk of chunks) {
            if (signal?.aborted) {
              controller.close();
              return;
            }
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            controller.close();
            return;
          }
          controller.error(error);
        }
      },
    });
  }
}

class BrowserToneTTSAdapter implements TTSAdapter {
  synthesize(text: string): ReadableStream<Uint8Array> {
    const pcm = buildPcmToneForText(text);

    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pcm);
        controller.close();
      },
    });
  }
}

function buildPcmToneForText(text: string): Uint8Array {
  const sampleRate = 16000;
  const seconds = Math.min(2, Math.max(0.35, text.length * 0.03));
  const totalSamples = Math.floor(sampleRate * seconds);
  const pcm = new Int16Array(totalSamples);

  const baseFrequency = 220;
  const amplitude = 0.18;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, i / 200) * Math.min(1, (totalSamples - i) / 200);
    const sample =
      Math.sin(2 * Math.PI * baseFrequency * t) +
      0.35 * Math.sin(2 * Math.PI * (baseFrequency * 2) * t);

    pcm[i] = Math.round(sample * envelope * amplitude * 32767);
  }

  return new Uint8Array(pcm.buffer);
}

function createAgentSession(
  clientId: string,
  sendToClient: (payload: AgentServerMessage) => void,
): AgentSession {
  const transport = new BrowserWsTransportAdapter({
    send: (message) => {
      if (message.type === "audio") {
        sendToClient({ type: "audio", audio: message.audio });
        return;
      }

      if (message.type === "clear") {
        sendToClient({ type: "clear" });
      }
    },
    session: {
      callId: clientId,
      metadata: {
        channel: "web-voice-call",
      },
    },
  });

  const stt: STTAdapter = deepgramApiKey
    ? new DeepgramSTTAdapter(deepgramApiKey, {
      model: deepgramModel,
      language: deepgramLanguage,
      punctuate: "true",
      smart_format: "true",
      interim_results: "false",
    })
    : new BrowserPassThroughSTTAdapter((text) => {
      sendToClient({ type: "transcript", text });
    });

  const orchestrator: CognitiveOrchestrator = openAIApiKey
    ? new OpenAIChatOrchestrator({
      apiKey: openAIApiKey,
      model: openAIModel,
      baseUrl: openAIBaseUrl,
      onAssistantText: (text) => {
        sendToClient({ type: "assistant-text", text });
      },
      onUserText: deepgramApiKey
        ? (text) => {
          sendToClient({ type: "transcript", text });
        }
        : undefined,
    })
    : new LocalEchoOrchestrator(
      (text) => {
        sendToClient({ type: "assistant-text", text });
      },
      deepgramApiKey
        ? (text) => {
          sendToClient({ type: "transcript", text });
        }
        : undefined,
    );

  const tts = openAIApiKey
    ? new OpenAITTSAdapter(openAIApiKey)
    : new BrowserToneTTSAdapter();

  const pipeline = createVoicePipeline({
    transport,
    vad: {
      id: "vad",
      engine: "webrtc",
      threshold: 0.12,
      speechProbabilityThreshold: 0.12,
      silenceDurationMs: 120,
    },
    stt,
    orchestrator,
    tts,
    ttsOptions: {
      sampleRate: 16000,
      voiceId: openAIApiKey ? openAITTSVoice : "browser-tone",
    },
    chunkOnCommas: true,
    maxChunkTokens: 18,
    outputBufferLookaheadMs: 24,
  });

  pipeline.on("node:error", (event) => {
    const detail = (event as CustomEvent<{ error: Error; nodeId: string }>).detail;
    sendToClient({
      type: "error",
      message: `Pipeline node error (${detail.nodeId}): ${detail.error.message}`,
    });
  });

  pipeline.on("pipeline:latency", (event) => {
    const detail = (event as CustomEvent<{ llmLatency: number; totalLatency: number }>).detail;
    sendToClient({
      type: "latency",
      llmLatency: detail.llmLatency,
      totalLatency: detail.totalLatency,
    });
  });

  return {
    transport,
    stt,
    pipeline,
    started: false,
    sttMode: deepgramApiKey ? "deepgram" : "browser-text",
    llmMode: openAIApiKey ? "openai" : "fallback",
    ttsMode: openAIApiKey ? "openai" : "fallback",
  };
}

async function startSession(session: AgentSession, sendToClient: (payload: AgentServerMessage) => void) {
  if (session.started) {
    return;
  }

  await session.pipeline.start();
  session.started = true;

  sendToClient({ type: "status", message: "Agent pipeline started" });
}

function destroySession(session: AgentSession | undefined) {
  if (!session) {
    return;
  }

  if (session.started) {
    session.pipeline.stop();
    session.started = false;
  }

  void session.stt.stop();
  void session.transport.stop();
}

function clearSessionOutput(session: AgentSession | undefined) {
  if (!session || !session.started) {
    return;
  }

  session.transport.clearOutput();
}

app.get("/", async (c) => {
  const response = await getPublicFileResponse("index.html", "text/html; charset=utf-8");
  return response ?? c.text("index.html not found", 404);
});

app.get("/app.js", async (c) => {
  const response = await getPublicFileResponse("app.js", "text/javascript; charset=utf-8");
  return response ?? c.text("app.js not found", 404);
});

app.get("/styles.css", async (c) => {
  const response = await getPublicFileResponse("styles.css", "text/css; charset=utf-8");
  return response ?? c.text("styles.css not found", 404);
});

app.get("/health", (c) => {
  return c.json({
    ok: true,
    sessions: sessions.size,
    port,
  });
});

app.get(
  "/ws/agent",
  upgradeWebSocket(() => {
    const clientId = randomId();

    return {
      async onOpen(_event: unknown, ws: { send: (payload: string) => void }) {
        const sendToClient = makeWsSender(ws);
        const session = createAgentSession(clientId, sendToClient);
        sessions.set(clientId, session);

        sendToClient({ type: "ready", clientId });
        sendToClient({ type: "status", message: "Streaming mic audio will trigger agent responses" });
        sendToClient({
          type: "status",
          message:
            session.sttMode === "deepgram"
              ? `STT mode: deepgram (${deepgramModel}, ${deepgramLanguage})`
              : "STT mode: browser speech recognition / Send Text fallback",
        });

        if (session.llmMode === "fallback") {
          sendToClient({
            type: "status",
            message:
              "OPENAI_API_KEY is missing. Running fallback echo mode. Set OPENAI_API_KEY to enable real AI responses.",
          });
        } else {
          sendToClient({
            type: "status",
            message: `LLM mode: openai (${openAIModel}), TTS mode: ${session.ttsMode}`,
          });
        }

        try {
          await startSession(session, sendToClient);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendToClient({ type: "error", message: `Failed to start pipeline: ${message}` });
        }
      },
      async onMessage(event: { data: unknown }, ws: { send: (payload: string) => void }) {
        const sendToClient = makeWsSender(ws);
        const session = sessions.get(clientId);
        if (!session) {
          sendToClient({ type: "error", message: "Session not found" });
          return;
        }

        let msg: AgentClientMessage;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          sendToClient({ type: "error", message: "Invalid JSON" });
          return;
        }

        if (msg.type === "ping") {
          sendToClient({ type: "pong" });
          return;
        }

        if (msg.type === "start") {
          sendToClient({ type: "status", message: "Ready to receive microphone audio" });
          return;
        }

        if (msg.type === "stop") {
          clearSessionOutput(session);
          sendToClient({ type: "status", message: "Audio stream paused" });
          return;
        }

        if (msg.type === "audio") {
          if (!session.started) {
            sendToClient({ type: "error", message: "Pipeline is not running" });
            return;
          }

          session.transport.pushBase64Audio(msg.audio);
          return;
        }

        if (msg.type === "text") {
          if (!session.started) {
            sendToClient({ type: "error", message: "Pipeline is not running" });
            return;
          }

          if (session.sttMode === "browser-text") {
            (session.stt as BrowserPassThroughSTTAdapter).emitTextTranscript(msg.text);
            return;
          }

          sendToClient({ type: "status", message: "Ignoring text event while Deepgram STT is active" });
          return;
        }

        sendToClient({ type: "error", message: "Unsupported message type" });
      },
      async onClose() {
        const session = sessions.get(clientId);
        sessions.delete(clientId);
        destroySession(session);
      },
      async onError() {
        const session = sessions.get(clientId);
        sessions.delete(clientId);
        destroySession(session);
      },
    };
  }),
);

export default {
  fetch: app.fetch,
  websocket,
  port,
};
