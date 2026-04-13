import type { ConversationContext } from "../types/index.js";

export class MastraOrchestrator {
  private agent: any;

  constructor(agent: any) {
    this.agent = agent;
  }

  generate(
    transcript: string,
    context: ConversationContext,
    signal?: AbortSignal,
  ): ReadableStream<string> {
    return new ReadableStream<string>({
      start: async (controller) => {
        try {
          const result = await this.agent.generate({
            prompt: transcript,
            context: context.metadata,
            messages: context.messages,
          });

          const stream = result?.textStream ?? result?.stream ?? result;
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
            const text = typeof result === "string" ? result : (result?.text ?? JSON.stringify(result));
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
        if (typeof this.agent?.abort === "function") {
          this.agent.abort();
        }
      },
    });
  }
}
