import {
  PipelineNode,
  type TTSAdapter,
  type TTSOptions,
} from "../types/index.js";

export class TTSNode extends PipelineNode<string, Uint8Array> {
  private adapter: TTSAdapter;
  private options: TTSOptions;

  constructor(adapter: TTSAdapter, options?: TTSOptions) {
    super({ id: "tts" });
    this.adapter = adapter;
    this.options = options ?? {};
  }

  async setup(): Promise<void> {
    const self = this;
    let readableController: ReadableStreamDefaultController<Uint8Array> | null = null;

    this.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        readableController = controller;
      },
    });

    this.writable = new WritableStream<string>({
      async write(sentence) {
        try {
          const audioStream = await self.adapter.synthesize(
            sentence,
            self.options,
            self.getAbortController().signal,
          );
          const reader = audioStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (readableController) {
                readableController.enqueue(value);
              }
            }
          } finally {
            reader.releaseLock();
          }
        } catch (err: any) {
          if (err.name !== "AbortError") {
            readableController?.error(err);
          }
        }
      },
      close() {
        readableController?.close();
      },
      abort() {
        readableController?.close();
      },
    });
  }
}

export class CartesiaTTSAdapter implements TTSAdapter {
  private apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId = "sonic-2") {
    this.apiKey = apiKey;
    this.modelId = modelId;
  }

  synthesize(
    text: string,
    options: TTSOptions,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const ws = new WebSocket(
      `wss://api.cartesia.com/tts/websocket?api_key=${this.apiKey}&model_id=${this.modelId}`,
    );

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              model_id: options.modelId ?? this.modelId,
              voice: { voice_id: options.voiceId ?? "79a125e8-cd45-4a13-8a10-547b0967a7d3" },
              transcript: text,
              output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
            }),
          );
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(event.data));
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((buf) => controller.enqueue(new Uint8Array(buf))).catch((err) => controller.error(err));
          } else if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              if (msg.error) {
                controller.error(new Error(`Cartesia error: ${msg.error}`));
              }
            } catch {}
          }
        };

        ws.onclose = () => controller.close();
        ws.onerror = () => controller.error(new Error("Cartesia WebSocket error"));

        if (signal) {
          signal.addEventListener("abort", () => ws.close(), { once: true });
        }
      },
      cancel() {
        ws.close();
      },
    });
  }
}

export class ElevenLabsTTSAdapter implements TTSAdapter {
  private _apiKey: string;
  private modelId: string;

  constructor(apiKey: string, modelId = "eleven_multilingual_v2") {
    this._apiKey = apiKey;
    this.modelId = modelId;
  }

  synthesize(
    text: string,
    options: TTSOptions,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    const voiceId = options.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const ws = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=${this.modelId}`,
    );
    void this._apiKey;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        ws.onopen = () => {
          ws.send(JSON.stringify({
            text: text,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            output_format: "pcm_16000",
          }));
        };

        ws.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(event.data));
          } else if (event.data instanceof Blob) {
            event.data.arrayBuffer().then((buf) => controller.enqueue(new Uint8Array(buf))).catch((err) => controller.error(err));
          }
        };

        ws.onclose = () => controller.close();
        ws.onerror = () => controller.error(new Error("ElevenLabs WebSocket error"));

        if (signal) {
          signal.addEventListener("abort", () => ws.close(), { once: true });
        }
      },
      cancel() {
        ws.close();
      },
    });
  }
}

export class OpenAITTSAdapter implements TTSAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "tts-1") {
    this.apiKey = apiKey;
    this.model = model;
  }

  synthesize(
    text: string,
    options: TTSOptions,
    signal?: AbortSignal,
  ): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: options.modelId ?? this.model,
              input: text,
              voice: options.voiceId ?? "alloy",
              response_format: "pcm",
            }),
            signal,
          });

          if (!response.ok) {
            controller.error(new Error(`OpenAI TTS API error: ${response.status} ${response.statusText}`));
            return;
          }

          if (!response.body) {
            controller.error(new Error("OpenAI TTS API returned empty body"));
            return;
          }

          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              controller.enqueue(value as Uint8Array);
            }
          }
          controller.close();
        } catch (err: any) {
          if (err.name !== "AbortError") {
            controller.error(err);
          } else {
            controller.close();
          }
        }
      },
    });
  }
}
