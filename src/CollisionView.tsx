// Collision View — real-time spatial plot showing two counter-propagating waves
// and their sum. This is the key visualization: you see V⁺ traveling right,
// V⁻ traveling left, and V⁺+V⁻ with interference peaks at the center.

import { useEffect, useRef } from 'react';

interface Props {
  vRight: Float64Array;   // V⁺ at each node (rightward wave)
  vLeft: Float64Array;    // V⁻ at each node (leftward wave)
  N: number;
  time: number;
}

export default function CollisionView({ vRight, vLeft, N, time }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = 40;
    const plotW = W - 2 * pad;
    const plotH = H - 2 * pad;

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#151530';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const y = pad + (i / 10) * plotH;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    }
    for (let i = 0; i <= N; i++) {
      const x = pad + (i / N) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, H - pad); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#333366';
    ctx.lineWidth = 1;
    const zeroY = pad + plotH / 2;
    ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(W - pad, zeroY); ctx.stroke();

    // Center zone highlight
    const cIdx1 = Math.floor(N / 2) - 1;
    const cIdx2 = Math.floor(N / 2);
    const cx1 = pad + (cIdx1 / (N - 1)) * plotW;
    const cx2 = pad + (cIdx2 / (N - 1)) * plotW;
    ctx.fillStyle = 'rgba(255, 200, 0, 0.05)';
    ctx.fillRect(cx1 - 5, pad, cx2 - cx1 + 10, plotH);
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx1, pad); ctx.lineTo(cx1, H - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2, pad); ctx.lineTo(cx2, H - pad); ctx.stroke();
    ctx.setLineDash([]);

    // Find max for scaling
    let maxV = 0.01;
    for (let i = 0; i < N; i++) {
      const vr = Number.isFinite(vRight[i]) ? Math.abs(vRight[i]) : 0;
      const vl = Number.isFinite(vLeft[i]) ? Math.abs(vLeft[i]) : 0;
      const vt = vr + vl;
      if (vr > maxV) maxV = vr;
      if (vl > maxV) maxV = vl;
      if (vt > maxV) maxV = vt;
    }
    maxV *= 1.1;

    // Helper: node index to x coordinate
    const nodeX = (i: number) => pad + (i / (N - 1)) * plotW;
    // Helper: voltage to y coordinate
    const vToY = (v: number) => zeroY - (v / maxV) * (plotH / 2 - 5);

    // ── Draw V⁺ (rightward wave) — cyan ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(0, 220, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgb(0, 220, 255)';
    ctx.shadowBlur = 4;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const v = Number.isFinite(vRight[i]) ? vRight[i] : 0;
      const y = vToY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrow on V⁺ (pointing right)
    const arrowIdx1 = Math.floor(N * 0.25);
    const arrowX1 = nodeX(arrowIdx1);
    const arrowY1 = vToY(Number.isFinite(vRight[arrowIdx1]) ? vRight[arrowIdx1] : 0);
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.beginPath();
    ctx.moveTo(arrowX1 + 8, arrowY1);
    ctx.lineTo(arrowX1 - 4, arrowY1 - 5);
    ctx.lineTo(arrowX1 - 4, arrowY1 + 5);
    ctx.closePath();
    ctx.fill();

    // ── Draw V⁻ (leftward wave) — purple ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(200, 100, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgb(200, 100, 255)';
    ctx.shadowBlur = 4;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const v = Number.isFinite(vLeft[i]) ? vLeft[i] : 0;
      const y = vToY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Arrow on V⁻ (pointing left)
    const arrowIdx2 = Math.floor(N * 0.75);
    const arrowX2 = nodeX(arrowIdx2);
    const arrowY2 = vToY(Number.isFinite(vLeft[arrowIdx2]) ? vLeft[arrowIdx2] : 0);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.beginPath();
    ctx.moveTo(arrowX2 - 8, arrowY2);
    ctx.lineTo(arrowX2 + 4, arrowY2 - 5);
    ctx.lineTo(arrowX2 + 4, arrowY2 + 5);
    ctx.closePath();
    ctx.fill();

    // ── Draw V⁺ + V⁻ (total) — yellow, thick ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(255, 200, 0)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgb(255, 200, 0)';
    ctx.shadowBlur = 6;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const vr = Number.isFinite(vRight[i]) ? vRight[i] : 0;
      const vl = Number.isFinite(vLeft[i]) ? vLeft[i] : 0;
      const y = vToY(vr + vl);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── Mark peaks in V⁺+V⁻ at center ──
    for (let i = cIdx1 - 2; i <= cIdx2 + 2; i++) {
      if (i < 0 || i >= N) continue;
      const vr = Number.isFinite(vRight[i]) ? vRight[i] : 0;
      const vl = Number.isFinite(vLeft[i]) ? vLeft[i] : 0;
      const vt = vr + vl;
      const x = nodeX(i);
      const y = vToY(vt);
      ctx.fillStyle = 'rgb(255, 200, 0)';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Labels ──
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.fillText('V⁺ →', pad + 4, pad + 14);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText('← V⁻', W - pad - 40, pad + 14);
    ctx.fillStyle = 'rgb(255, 200, 0)';
    ctx.fillText('V⁺+V⁻ (peaks!)', pad + 4, H - pad - 6);

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('node 0', pad, H - pad + 14);
    ctx.fillText(`node ${N - 1}`, W - pad - 35, H - pad + 14);
    ctx.fillText(`t = ${time.toFixed(2)}s`, W - pad - 60, pad - 6);

    // Scale
    ctx.fillText(`±${maxV.toFixed(2)}`, pad - 35, pad + 4);

    // Direction indicators at boundaries
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.fillText('▶', pad - 16, zeroY + 4);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText('◀', W - pad + 6, zeroY + 4);

  }, [vRight, vLeft, N, time]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={300}
      className="w-full rounded-lg border border-gray-800"
      style={{ height: '300px' }}
    />
  );
}
