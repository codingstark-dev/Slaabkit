const BIAS = 0x84;
const CLIP = 32635;

function pcmToMulawSample(sample: number): number {
  let sign = 0;
  let pcm = sample;

  if (pcm < 0) {
    pcm = -pcm;
    sign = 0x80;
  }

  pcm = Math.min(CLIP, pcm) + BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--) {
    expMask >>= 1;
  }

  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulaw;
}

function mulawToPcmSample(mulaw: number): number {
  const uVal = ~mulaw & 0xff;
  const sign = uVal & 0x80;
  const exponent = (uVal >> 4) & 0x07;
  const mantissa = uVal & 0x0f;
  const sample = ((mantissa << 3) + BIAS) << exponent;
  return sign ? -sample : sample;
}

export function pcmResample(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) {
    return pcm;
  }

  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(pcm.length / ratio));
  const output = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const low = Math.floor(srcPos);
    const high = Math.min(low + 1, pcm.length - 1);
    const frac = srcPos - low;
    const lowSample = pcm[low] ?? 0;
    const highSample = pcm[high] ?? lowSample;
    output[i] = Math.round(lowSample * (1 - frac) + highSample * frac);
  }

  return output;
}

export function mulawToPcm(mulawBytes: Uint8Array): Int16Array {
  const decoded8k = new Int16Array(mulawBytes.length);
  for (let i = 0; i < mulawBytes.length; i++) {
    decoded8k[i] = mulawToPcmSample(mulawBytes[i] ?? 0);
  }
  return pcmResample(decoded8k, 8000, 16000);
}

export function pcmToMulaw(pcm: Int16Array): Uint8Array {
  const downsampled = pcmResample(pcm, 16000, 8000);
  const output = new Uint8Array(downsampled.length);
  for (let i = 0; i < downsampled.length; i++) {
    output[i] = pcmToMulawSample(downsampled[i] ?? 0);
  }
  return output;
}

export function g722ToPcm(_g722Bytes: Uint8Array): Int16Array {
  throw new Error("G.722 decoding not yet implemented");
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    const code = binary.charCodeAt(i);
    bytes[i] = code;
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

export function pcmToFloat32(pcm: Int16Array): Float32Array {
  const floats = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const sample = pcm[i] ?? 0;
    floats[i] = sample / 32768;
  }
  return floats;
}

export function float32ToPcm(floats: Float32Array): Int16Array {
  const pcm = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const sample = floats[i] ?? 0;
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
  }
  return pcm;
}
