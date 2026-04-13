import type { TransportAdapter, TransportSession } from "../types/index.js";
import { base64ToUint8Array } from "./utils.js";

interface TelnyxMessage {
  event: string;
  media?: { payload?: string; track?: string };
  call_details?: { from?: string; to?: string };
  payload?: string;
}

export class TelnyxTransportAdapter implements TransportAdapter {
  private ws: WebSocket | null = null;
  private sessionData: TransportSession = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readable: ReadableStream<Uint8Array>;
  private writable: WritableStream<Uint8Array>;

  constructor() {
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

  async start(): Promise<void> {}

  attachWebSocket(ws: WebSocket): void {
    this.ws = ws;
    const self = this;

    ws.onmessage = (event: MessageEvent) => {
      const data: TelnyxMessage = JSON.parse(event.data);

      switch (data.event) {
        case "start":
          if (data.call_details) {
            self.sessionData = {
              callerNumber: data.call_details.from,
              calleeNumber: data.call_details.to,
              metadata: data.call_details,
            };
          }
          break;
        case "media":
          if (data.media?.payload) {
            const audioBytes = base64ToUint8Array(data.media.payload);
            self.ingressController?.enqueue(audioBytes);
          } else if (data.payload) {
            const audioBytes = base64ToUint8Array(data.payload);
            self.ingressController?.enqueue(audioBytes);
          }
          break;
        case "stop":
          self.ingressController?.close();
          break;
      }
    };

    ws.onclose = () => {
      self.ingressController?.close();
    };
  }

  private sendAudio(pcmData: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const base64 = btoa(String.fromCharCode(...pcmData));
    this.ws.send(JSON.stringify({
      event: "media",
      media: { payload: base64 },
    }));
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ingressController?.close();
  }
}