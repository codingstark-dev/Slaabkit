import type { TransportAdapter, TransportSession, DTMFEvent } from "../types/index.js";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./utils.js";

interface PlivoMessage {
  event: string;
  media?: { payload?: string; contentType?: string; sampleRate?: string; track?: string };
  digit?: string;
  start?: { callId?: string; from?: string; to?: string };
  streamId?: string;
}

export class PlivoTransportAdapter implements TransportAdapter {
  private ws: WebSocket | null = null;
  private _streamId = "";
  private sessionData: TransportSession = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private eventTarget: EventTarget = new EventTarget();
  private readable: ReadableStream<Uint8Array>;
  private writable: WritableStream<Uint8Array>;
  private outputSampleRate = 8000;
  private outputContentType = "audio/x-l16";

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
      const data: PlivoMessage = JSON.parse(event.data);

      switch (data.event) {
        case "start":
          self._streamId = data.streamId ?? "";
          self.sessionData.metadata.streamId = self._streamId;
          if (data.start) {
            self.sessionData = {
              callId: data.start.callId,
              callerNumber: data.start.from,
              calleeNumber: data.start.to,
              metadata: data.start,
            };
          }
          break;
        case "media":
          if (data.media?.payload) {
            const audioBytes = base64ToUint8Array(data.media.payload);
            self.ingressController?.enqueue(audioBytes);
          }
          break;
        case "dtmf":
          if (data.digit) {
            const dtmfEvent: DTMFEvent = {
              type: "transport:dtmf",
              timestamp: Date.now(),
              digit: data.digit,
            };
            self.eventTarget.dispatchEvent(
              new CustomEvent("dtmf", { detail: dtmfEvent }),
            );
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

  onDTMF(listener: (event: CustomEvent<DTMFEvent>) => void): void {
    this.eventTarget.addEventListener("dtmf", listener as EventListener);
  }

  private sendAudio(pcmData: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const base64 = uint8ArrayToBase64(pcmData);
    this.ws.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: this.outputContentType,
        sampleRate: String(this.outputSampleRate),
        payload: base64,
      },
    }));
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ingressController?.close();
  }
}
