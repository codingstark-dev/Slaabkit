import type { TransportAdapter, TransportSession } from "../types/index.js";

export interface CloudflareCallsConfig {
  appId: string;
  token: string;
  endpoint?: string;
}

export class CloudflareCallsTransportAdapter implements TransportAdapter {
  private _config: CloudflareCallsConfig;
  private sessionData: TransportSession = { metadata: {} };
  private ingressController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readable: ReadableStream<Uint8Array>;
  private writable: WritableStream<Uint8Array>;

  constructor(config: CloudflareCallsConfig) {
    this._config = config;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.ingressController = controller;
      },
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
      "CloudflareCallsTransportAdapter requires Cloudflare Calls SDK/runtime bindings. " +
      "Install the Cloudflare Calls client and wire incoming/outgoing RTP/Opus tracks to this adapter.",
    );
  }

  async stop(): Promise<void> {
    this.ingressController?.close();
  }
}
