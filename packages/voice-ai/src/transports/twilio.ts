import type { TransportAdapter, TransportSession } from "../types/index.js";
import { mulawToPcm, pcmToMulaw, base64ToUint8Array, uint8ArrayToBase64 } from "./utils.js";

interface TwilioMessage {
  event: string;
  media?: { payload?: string; track?: string };
  start?: { callSid?: string; from?: string; to?: string };
  stop?: { callSid?: string };
}

export class TwilioTransportAdapter implements TransportAdapter {
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
      const data: TwilioMessage = JSON.parse(event.data);

      switch (data.event) {
        case "connected":
          break;
        case "start":
          self.sessionData = {
            callId: data.start?.callSid,
            callerNumber: data.start?.from,
            calleeNumber: data.start?.to,
            metadata: data.start ?? {},
          };
          break;
        case "media":
          if (data.media?.payload) {
            const mulawBytes = base64ToUint8Array(data.media.payload);
            const pcmData = mulawToPcm(mulawBytes);
            self.ingressController?.enqueue(new Uint8Array(pcmData.buffer));
          }
          break;
        case "stop":
          self.ingressController?.close();
          break;
        case "clear":
          break;
      }
    };

    ws.onclose = () => {
      self.ingressController?.close();
    };
  }

  private sendAudio(pcmData: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const int16Data = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
    const mulawData = pcmToMulaw(int16Data);
    const base64Payload = uint8ArrayToBase64(mulawData);

    this.ws.send(JSON.stringify({
      event: "media",
      streamSid: (this.sessionData.metadata as any)?.streamSid,
      media: { payload: base64Payload },
    }));
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ingressController?.close();
  }
}
