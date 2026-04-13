import { PipelineNode } from "../types/index.js";
import type {
  STTAdapter,
  TranscriptEvent,
  NodeErrorEvent,
} from "../types/index.js";

type EventMap = {
  nodeError: CustomEvent<NodeErrorEvent>;
};

export class STTNode extends PipelineNode<Uint8Array, TranscriptEvent> {
  private adapter: STTAdapter;
  private reconnectionAttempts = 0;
  private maxReconnectionAttempts = 5;
  private initialBackoffMs = 1000;
  private maxBackoffMs = 30000;
  private interimStreamController: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private interimStream: ReadableStream<TranscriptEvent>;
  private events = new EventTarget();

  constructor(adapter: STTAdapter) {
    super({ id: "stt" });
    this.adapter = adapter;
    this.interimStream = new ReadableStream<TranscriptEvent>({
      start: (controller) => {
        this.interimStreamController = controller;
      },
    });
  }

  async setup(): Promise<void> {
    await this.connectWithBackoff();

    const adapterStream = this.adapter.getTranscriptStream();

    this.readable = new ReadableStream<TranscriptEvent>({
      start: (controller) => {
        const reader = adapterStream.getReader();
        const loop = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value.isFinal) {
                controller.enqueue(value);
              } else {
                this.interimStreamController?.enqueue(value);
              }
            }
            controller.close();
          } catch (err) {
            controller.error(err);
            this.emitNodeError(err instanceof Error ? err : new Error(String(err)), true);
          }
        };
        loop().catch((err) => controller.error(err));
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.adapter.sendAudio(chunk);
      },
    });
  }

  private async connectWithBackoff(): Promise<void> {
    while (this.reconnectionAttempts < this.maxReconnectionAttempts) {
      try {
        await this.adapter.start();
        this.reconnectionAttempts = 0;
        return;
      } catch (error) {
        this.reconnectionAttempts += 1;
        const err = error instanceof Error ? error : new Error(String(error));
        this.emitNodeError(err, this.reconnectionAttempts < this.maxReconnectionAttempts);

        if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
          throw err;
        }

        const backoff = Math.min(
          this.initialBackoffMs * Math.pow(2, this.reconnectionAttempts - 1),
          this.maxBackoffMs,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  getInterimStream(): ReadableStream<TranscriptEvent> {
    return this.interimStream;
  }

  onNodeError(listener: (event: EventMap["nodeError"]) => void): void {
    this.events.addEventListener("nodeError", listener as EventListener);
  }

  private emitNodeError(error: Error, recoverable: boolean): void {
    const detail: NodeErrorEvent = {
      type: "node:error",
      timestamp: Date.now(),
      nodeId: this.id,
      error,
      recoverable,
    };
    this.events.dispatchEvent(new CustomEvent("nodeError", { detail }));
  }

  destroy(): void {
    this.adapter.stop().catch(() => {});
    this.interimStreamController?.close();
    super.destroy();
  }
}

export class DeepgramSTTAdapter implements STTAdapter {
  private ws: WebSocket | null = null;
  private transcriptController: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private transcriptStream: ReadableStream<TranscriptEvent>;
  private apiKey: string;
  private options: Record<string, string>;

  constructor(apiKey: string, options?: Record<string, string>) {
    this.apiKey = apiKey;
    this.options = options ?? { model: "nova-3", language: "en-US" };
    this.transcriptStream = new ReadableStream<TranscriptEvent>({
      start: (controller) => {
        this.transcriptController = controller;
      },
    });
  }

  async start(): Promise<void> {
    const params = new URLSearchParams({
      ...this.options,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    this.ws = new WebSocket(url, ["token", this.apiKey]);

    this.ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data)) as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
      };

      if (data.type !== "Results") {
        return;
      }

      const alternative = data.channel?.alternatives?.[0];
      if (!alternative?.transcript) {
        return;
      }

      this.transcriptController?.enqueue({
        text: alternative.transcript,
        isFinal: Boolean(data.is_final),
        confidence: alternative.confidence ?? 0,
      });
    };

    this.ws.onclose = () => {
      this.transcriptController?.close();
    };

    this.ws.onerror = () => {
      this.transcriptController?.error(new Error("Deepgram WebSocket error"));
    };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket connection failed"));
    });
  }

  async stop(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  getTranscriptStream(): ReadableStream<TranscriptEvent> {
    return this.transcriptStream;
  }

  sendAudio(chunk: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }
}

export class AssemblyAIAdapter implements STTAdapter {
  private ws: WebSocket | null = null;
  private transcriptController: ReadableStreamDefaultController<TranscriptEvent> | null = null;
  private transcriptStream: ReadableStream<TranscriptEvent>;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.transcriptStream = new ReadableStream<TranscriptEvent>({
      start: (controller) => {
        this.transcriptController = controller;
      },
    });
  }

  async start(): Promise<void> {
    this.ws = new WebSocket("wss://api.assemblyai.com/v2/realtime/ws");

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ token: this.apiKey }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(String(event.data)) as {
        message_type?: string;
        text?: string;
        confidence?: number;
      };

      if (data.message_type === "PartialTranscript") {
        this.transcriptController?.enqueue({
          text: data.text ?? "",
          isFinal: false,
          confidence: data.confidence ?? 0,
        });
      }

      if (data.message_type === "FinalTranscript") {
        this.transcriptController?.enqueue({
          text: data.text ?? "",
          isFinal: true,
          confidence: data.confidence ?? 1,
        });
      }
    };

    this.ws.onclose = () => {
      this.transcriptController?.close();
    };

    this.ws.onerror = () => {
      this.transcriptController?.error(new Error("AssemblyAI WebSocket error"));
    };

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error("WebSocket not initialized"));
        return;
      }
      const socket = this.ws;
      const previousOnOpen = socket.onopen;
      socket.onopen = (ev) => {
        previousOnOpen?.call(socket, ev);
        resolve();
      };
    });
  }

  async stop(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ terminate: true }));
      this.ws.close();
    }
  }

  getTranscriptStream(): ReadableStream<TranscriptEvent> {
    return this.transcriptStream;
  }

  sendAudio(chunk: Uint8Array): void {
    const base64 = btoa(String.fromCharCode(...chunk));
    this.ws?.send(JSON.stringify({ audio: base64 }));
  }
}
