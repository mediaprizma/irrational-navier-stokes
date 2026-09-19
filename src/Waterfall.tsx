// Space-time waterfall plot: shows how voltage (or energy) evolves across nodes over time.
// Renders as a 2D heatmap image using ImageData for performance.

import { useEffect, useRef } from 'react';

interface Props {
  history: Float32Array[];  // Array of snapshots (each is Float32Array of length N)
  maxRows: number;          // How many time rows to keep
  N: number;                // Number of nodes (columns)
  mode: 'voltage' | 'energy';
}

export default function Waterfall({ history, maxRows, N, mode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    // Clear
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    if (history.length === 0) return;

    // Find global max for color scaling
    let gmax = 1e-10;
    for (const row of history) {
      for (let i = 0; i < N; i++) {
        const v = Number.isFinite(row[i]) ? row[i] : 0;
        const val = mode === 'energy' ? v * v : Math.abs(v);
        if (val > gmax) gmax = val;
      }
    }

    // Render using ImageData for speed
    const img = ctx.createImageData(W, H);
    const rows = history.length;
    const rowHeight = H / maxRows;

    for (let r = 0; r < rows; r++) {
      // Most recent row at top
      const histIdx = history.length - 1 - r;
      const row = history[histIdx];
      const y0 = Math.floor(r * rowHeight);
      const y1 = Math.floor((r + 1) * rowHeight);

      for (let x = 0; x < W; x++) {
        // Map x to node index
        const nodeFloat = (x / W) * (N - 1);
        const i0 = Math.floor(nodeFloat);
        const i1 = Math.min(i0 + 1, N - 1);
        const frac = nodeFloat - i0;

        const v0 = Number.isFinite(row[i0]) ? row[i0] : 0;
        const v1 = Number.isFinite(row[i1]) ? row[i1] : 0;
        const v = v0 * (1 - frac) + v1 * frac;
        const val = mode === 'energy' ? v * v : Math.abs(v);
        const t = Math.pow(Math.min(val / gmax, 1), 0.6);

        // Color ramp: black -> blue -> cyan -> yellow -> white
        let R: number, G: number, B: number;
        if (t < 0.25) {
          const s = t / 0.25;
          R = 0; G = Math.floor(10 + 30 * s); B = Math.floor(40 + 160 * s);
        } else if (t < 0.5) {
          const s = (t - 0.25) / 0.25;
          R = Math.floor(20 * s); G = Math.floor(40 + 160 * s); B = 200 + Math.floor(55 * s);
        } else if (t < 0.75) {
          const s = (t - 0.5) / 0.25;
          R = Math.floor(20 + 235 * s); G = 200 + Math.floor(55 * s); B = Math.floor(255 - 200 * s);
        } else {
          const s = (t - 0.75) / 0.25;
          R = 255; G = 255; B = Math.floor(55 + 200 * s);
        }

        for (let y = y0; y < y1; y++) {
          const idx = (y * W + x) * 4;
          img.data[idx] = R;
          img.data[idx + 1] = G;
          img.data[idx + 2] = B;
          img.data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);

    // Center markers
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const cx1 = (9 / (N - 1)) * W;
    const cx2 = (10 / (N - 1)) * W;
    ctx.beginPath(); ctx.moveTo(cx1, 0); ctx.lineTo(cx1, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2, 0); ctx.lineTo(cx2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '9px monospace';
    ctx.fillText('t ↑', 4, 12);
    ctx.fillText('node →', W - 45, H - 4);

  }, [history, maxRows, N, mode]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={200}
      className="w-full rounded border border-gray-800/50"
      style={{ height: '200px' }}
    />
  );
}
