import type { TransportAdapter, TransportSession } from "../types/index.js";

export interface DailyTransportConfig {
  roomUrl: string;
  token: string;
  botName?: string;
}

export class DailyTransportAdapter implements TransportAdapter {
  private _config: DailyTransportConfig;
  private sessionData: TransportSession = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readable: ReadableStream<Uint8Array>;
  private writable: WritableStream<Uint8Array>;

  constructor(config: DailyTransportConfig) {
    this._config = config;
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
    return this.writable;
  }

  async start(): Promise<void> {
    void this._config;
    throw new Error(
      "DailyTransportAdapter requires the @daily-co/daily-js package. " +
      "Install it and use Daily.callFrame() to set up the WebRTC connection, " +
      "then pipe audio tracks through this adapter."
    );
  }

  async stop(): Promise<void> {
    this.ingressController?.close();
  }
}
