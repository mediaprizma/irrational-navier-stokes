// Real-time oscilloscope component — shows voltage waveform in a sliding time window.
// Used to visualize the complex irrational sum-of-sines at any node.

import { useEffect, useRef } from 'react';

interface Props {
  buffer: Float32Array;   // Circular buffer of voltage samples
  writeIdx: number;       // Current write position
  length: number;         // Number of valid samples
  label: string;
  color: string;
  height?: number;
}

export default function Oscilloscope({ buffer, writeIdx, length, label, color, height = 140 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#151530';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 8; i++) {
      const y = (i / 8) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 1; i < 16; i++) {
      const x = (i / 16) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#2a2a55';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    if (length < 2) return;

    // Find max for scaling
    let maxV = 0.01;
    for (let i = 0; i < length; i++) {
      const v = Math.abs(buffer[i]);
      if (Number.isFinite(v) && v > maxV) maxV = v;
    }

    // Draw waveform — read in chronological order (from writeIdx forward)
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;

    const startIdx = (writeIdx - length + buffer.length) % buffer.length;
    for (let i = 0; i < length; i++) {
      const bufIdx = (startIdx + i) % buffer.length;
      const v = Number.isFinite(buffer[bufIdx]) ? buffer[bufIdx] : 0;
      const x = (i / (length - 1)) * w;
      const y = h / 2 - (v / maxV) * (h / 2 - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Scale labels
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.font = '9px monospace';
    ctx.fillText(`±${maxV.toFixed(2)}`, 4, 10);
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(label, 4, h - 6);

  }, [buffer, writeIdx, length, label, color]);

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
