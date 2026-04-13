export interface SentenceBoundaryOptions {
  chunkOnCommas?: boolean;
  maxChunkTokens?: number;
  signal?: AbortSignal;
}

const SENTENCE_END_RE = /[.!?]/;
const COMMA_RE = /[,;:—–]/;

export class SentenceBoundaryTransform {
  private buffer = "";
  private tokenCount = 0;
  private options: Required<Pick<SentenceBoundaryOptions, "chunkOnCommas" | "maxChunkTokens">>;
  private signal: AbortSignal | undefined;
  private controller: ReadableStreamDefaultController<string> | null = null;
  private readable: ReadableStream<string>;
  private writable: WritableStream<string>;

  constructor(options?: SentenceBoundaryOptions) {
    this.options = {
      chunkOnCommas: options?.chunkOnCommas ?? false,
      maxChunkTokens: options?.maxChunkTokens ?? 50,
    };
    this.signal = options?.signal;

    const self = this;

    this.readable = new ReadableStream<string>({
      start(controller) {
        self.controller = controller;
        if (self.signal) {
          self.signal.addEventListener("abort", () => {
            if (self.buffer.length > 0) {
              controller.enqueue(self.buffer);
              self.buffer = "";
            }
            controller.close();
          }, { once: true });
        }
      },
    });

    this.writable = new WritableStream<string>({
      write(token) {
        self.buffer += token;
        self.tokenCount++;

        let emitted = false;
        for (let i = 0; i < token.length; i++) {
          const char = token[i];
          if (!char) continue;
          if (SENTENCE_END_RE.test(char)) {
            const chunk = self.flush();
            if (chunk && self.controller) {
              self.controller.enqueue(chunk);
              emitted = true;
            }
          } else if (self.options.chunkOnCommas && COMMA_RE.test(char)) {
            const chunk = self.flush();
            if (chunk && self.controller) {
              self.controller.enqueue(chunk);
              emitted = true;
            }
          }
        }

        if (!emitted && self.tokenCount >= self.options.maxChunkTokens) {
          const chunk = self.flush();
          if (chunk && self.controller) {
            self.controller.enqueue(chunk);
          }
        }
      },
      close() {
        if (self.buffer.length > 0 && self.controller) {
          self.controller.enqueue(self.buffer);
          self.buffer = "";
        }
        self.controller?.close();
      },
    });
  }

  private flush(): string | null {
    const chunk = this.buffer.trim();
    this.buffer = "";
    this.tokenCount = 0;
    return chunk.length > 0 ? chunk : null;
  }

  getReadable(): ReadableStream<string> {
    return this.readable;
  }

  getWritable(): WritableStream<string> {
    return this.writable;
  }
}

export function createSentenceBoundaryTransform(options?: SentenceBoundaryOptions): SentenceBoundaryTransform {
  return new SentenceBoundaryTransform(options);
}
