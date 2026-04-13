import { DailyTransportAdapter } from "@Slaabkit/voice-ai/transports/daily";

export function createDailyExample(roomUrl: string, token: string) {
  return new DailyTransportAdapter({ roomUrl, token, botName: "slaabkit-bot" });
}
