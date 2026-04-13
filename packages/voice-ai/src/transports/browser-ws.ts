import type { TransportAdapter, TransportSession } from "../types/index.js";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./utils.js";

export type BrowserWsOutboundMessage =
  | { type: "audio"; audio: string }
  | { type: "clear" };

export interface BrowserWsTransportAdapterOptions {
  send: (message: BrowserWsOutboundMessage) => void;
  session?: Partial<TransportSession>;
}

export class BrowserWsTransportAdapter implements TransportAdapter {
  private readonly send: (message: BrowserWsOutboundMessage) => void;
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly ingress: ReadableStream<Uint8Array>;
  private egress: WritableStream<Uint8Array>;
  private started = false;
  private sessionData: TransportSession;

  constructor(options: BrowserWsTransportAdapterOptions) {
    this.send = options.send;
    this.sessionData = {
      callId: options.session?.callId,
      callerNumber: options.session?.callerNumber,
      calleeNumber: options.session?.calleeNumber,
      metadata: options.session?.metadata ?? {},
    };

    this.ingress = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.ingressController = controller;
      },
    });

    this.egress = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.send({
          type: "audio",
          audio: uint8ArrayToBase64(chunk),
        });
      },
    });
  }

  get session(): TransportSession {
    return this.sessionData;
  }

  createIngressStream(): ReadableStream<Uint8Array> {
    return this.ingress;
  }

  createEgressStream(): WritableStream<Uint8Array> {
    return this.egress;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.clearOutput();
    this.closeIngress();
  }

  clearOutput(): void {
    this.send({ type: "clear" });
  }

  pushAudioChunk(chunk: Uint8Array): void {
    if (!this.started || chunk.byteLength === 0) {
      return;
    }

    this.ingressController?.enqueue(chunk);
  }

  pushBase64Audio(base64Audio: string): void {
    this.pushAudioChunk(base64ToUint8Array(base64Audio));
  }

  closeIngress(): void {
    this.ingressController?.close();
    this.ingressController = null;
  }
}
