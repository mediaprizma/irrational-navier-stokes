// Real-time spectrum analyzer — computes magnitude spectrum of a voltage buffer
// using a simple DFT (fast enough for buffers of ~512 samples at 60fps).

import { useEffect, useRef } from 'react';

interface Props {
  buffer: Float32Array;
  writeIdx: number;
  length: number;
  sampleRate: number;   // samples per second (simulation time)
  label: string;
  color: string;
  height?: number;
}

export default function Spectrum({ buffer, writeIdx, length, sampleRate, label, color, height = 140 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<Float32Array>(new Float32Array(128));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#151530';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      const y = (i / 8) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    if (length < 16) return;

    // ── Compute DFT magnitudes ──
    // We compute |X(k)| for k = 0..Nspec-1 using the sliding buffer.
    // Apply Hann window to reduce spectral leakage.
    const Nspec = spectrumRef.current.length;
    const spectrum = spectrumRef.current;

    // Extract samples in chronological order with Hann window
    const startIdx = (writeIdx - length + buffer.length) % buffer.length;
    const windowed = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const bufIdx = (startIdx + i) % buffer.length;
      const v = Number.isFinite(buffer[bufIdx]) ? buffer[bufIdx] : 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
      windowed[i] = v * w;
    }

    // DFT — only compute Nspec bins, each bin k maps to frequency f_k = k * sampleRate / length
    // We only care about positive frequencies, so k goes from 0 to length/2
    // But we want to display Nspec bins spread across the visible range.
    const maxK = Math.floor(length / 2);
    let maxMag = 1e-10;

    for (let k = 0; k < Nspec; k++) {
      // Map bin index to DFT index
      const dftIdx = Math.floor((k / Nspec) * maxK);
      if (dftIdx >= maxK) break;

      let re = 0, im = 0;
      const omega = (2 * Math.PI * dftIdx) / length;
      for (let n = 0; n < length; n++) {
        re += windowed[n] * Math.cos(omega * n);
        im -= windowed[n] * Math.sin(omega * n);
      }
      const mag = Math.sqrt(re * re + im * im) / length;
      spectrum[k] = mag;
      if (mag > maxMag) maxMag = mag;
    }

    // Normalize to log scale (dB-like)
    const logMax = Math.log10(maxMag + 1e-12);

    // Draw spectrum
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;

    for (let k = 0; k < Nspec; k++) {
      const x = (k / (Nspec - 1)) * W;
      const mag = spectrum[k];
      const logMag = Math.log10(mag + 1e-12);
      const norm = Math.max(0, (logMag - (logMax - 3)) / 3); // 30 dB range
      const y = H - 10 - norm * (H - 20);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Filled area
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    // Parse rgb(r,g,b) -> rgba(r,g,b,0.15)
    const rgbaFill = color.replace('rgb(', 'rgba(').replace(')', ',0.15)');
    ctx.fillStyle = rgbaFill;
    ctx.fill();

    // Frequency axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    const fMax = sampleRate / 2;
    ctx.fillText('0', 2, H - 2);
    ctx.fillText(`${(fMax / 2).toFixed(0)}`, W / 2 - 10, H - 2);
    ctx.fillText(`${fMax.toFixed(0)} Hz`, W - 55, H - 2);

    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(label, 4, 12);

  }, [buffer, writeIdx, length, sampleRate, label, color]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={height}
      className="w-full rounded border border-gray-800/50"
      style={{ height: `${height}px` }}
    />
  );
}
