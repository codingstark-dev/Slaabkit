import type { ConversationContext } from "../types/index.js";

export class VoltAgentOrchestrator {
  private supervisor: any;

  constructor(supervisor: any) {
    this.supervisor = supervisor;
  }

  generate(
    transcript: string,
    context: ConversationContext,
    signal?: AbortSignal,
  ): ReadableStream<string> {
    return new ReadableStream<string>({
      start: async (controller) => {
        try {
          const result = await this.supervisor.generate({
            input: transcript,
            context: {
              messages: context.messages,
              sessionId: context.sessionId,
              metadata: context.metadata,
            },
          });

          const stream = result?.stream ?? result?.textStream ?? result;
          if (stream && typeof stream[Symbol.asyncIterator] === "function") {
            for await (const chunk of stream) {
              if (signal?.aborted) {
                controller.close();
                return;
              }
              const text = typeof chunk === "string" ? chunk : (chunk?.text ?? String(chunk));
              controller.enqueue(text);
            }
          } else {
            const text = typeof stream === "string" ? stream : (stream?.text ?? JSON.stringify(stream));
            controller.enqueue(text);
          }
          controller.close();
        } catch (err: any) {
          if (err?.name === "AbortError") {
            controller.close();
            return;
          }
          controller.error(err);
        }
      },
      cancel: () => {
        if (typeof this.supervisor?.abort === "function") {
          this.supervisor.abort();
        }
      },
    });
  }
}
