import type { TransportAdapter, TransportSession } from "../types/index.js";

interface VonageConfig {
  websocketUrl: string;
}

export class VonageTransportAdapter implements TransportAdapter {
  private ws: WebSocket | null = null;
  private config: VonageConfig;
  private sessionData: TransportSession = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readable: ReadableStream<Uint8Array>;
  private writable: WritableStream<Uint8Array>;

  constructor(config: VonageConfig) {
    this.config = config;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => { this.ingressController = controller; },
    });
    this.writable = new WritableStream<Uint8Array>();
  }

  get session(): TransportSession {
    return this.sessionData;
  }

  createIngressStream(): ReadableStream<Uint8Array> {
    return this.readable;
  }

  createEgressStream(): WritableStream<Uint8Array> {
    const self = this;
    this.writable = new WritableStream<Uint8Array>({
      write(chunk) {
        self.sendAudio(chunk);
      },
    });
    return this.writable;
  }

  async start(): Promise<void> {
    this.ws = new WebSocket(this.config.websocketUrl);

    this.ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.call_id) {
            this.sessionData = {
              callId: msg.call_id,
              metadata: msg,
            };
          }
        } catch {}
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.ingressController?.enqueue(new Uint8Array(event.data));
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          this.ingressController?.enqueue(new Uint8Array(buf));
        });
      }
    };

    this.ws.onclose = () => {
      this.ingressController?.close();
    };

    await new Promise<void>((resolve) => {
      if (this.ws) {
        this.ws.onopen = () => resolve();
      }
    });
  }

  private sendAudio(pcmData: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcmData.buffer);
  }

  generateNCCO(_answerUrl: string): object[] {
    return [
      {
        action: "connect",
        endpoint: [
          { type: "websocket", uri: this.config.websocketUrl, content_type: "audio/l16;rate=16000" },
        ],
      },
    ];
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ingressController?.close();
  }
}
