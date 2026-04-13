import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { pcmResample } from "./transports/utils.js";

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

describe("latency benchmarks", () => {
  it("reports p50/p95/p99 resample latency", () => {
    const input = new Int16Array(1600);
    const samples: number[] = [];

    for (let i = 0; i < 100; i++) {
      const s = performance.now();
      pcmResample(input, 16000, 8000);
      const e = performance.now();
      samples.push(e - s);
    }

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const p99 = percentile(samples, 99);

    const report = { p50, p95, p99 };
    expect(report.p50).toBeGreaterThanOrEqual(0);
    expect(report.p95).toBeGreaterThanOrEqual(report.p50);
    expect(report.p99).toBeGreaterThanOrEqual(report.p95);
  });
});
