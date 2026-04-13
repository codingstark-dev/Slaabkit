import { describe, expect, it } from "vitest";
import {
  base64ToUint8Array,
  float32ToPcm,
  mulawToPcm,
  pcmResample,
  pcmToFloat32,
  pcmToMulaw,
  uint8ArrayToBase64,
} from "./utils.js";

describe("transport utils", () => {
  it("base64 roundtrip", () => {
    const raw = new Uint8Array([1, 2, 3, 4, 250]);
    const b64 = uint8ArrayToBase64(raw);
    const decoded = base64ToUint8Array(b64);
    expect(Array.from(decoded)).toEqual(Array.from(raw));
  });

  it("pcm float conversions", () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const floats = pcmToFloat32(pcm);
    const back = float32ToPcm(floats);
    expect(back.length).toBe(pcm.length);
  });

  it("resamples pcm", () => {
    const pcm = new Int16Array(1600);
    const down = pcmResample(pcm, 16000, 8000);
    expect(down.length).toBeCloseTo(800, -1);
  });

  it("mu-law conversion path", () => {
    const pcm = new Int16Array(1600);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.sin(i / 20) * 12000) | 0;
    const mu = pcmToMulaw(pcm);
    const back = mulawToPcm(mu);
    expect(mu.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
  });
});
