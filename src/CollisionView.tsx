// Collision View — shows V⁺ (rightward), V⁻ (leftward), and V⁺+V⁻ (total)

import { useEffect, useRef } from 'react';

interface Props {
  vRight: Float64Array;
  vLeft: Float64Array;
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

    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#151530';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const y = pad + (i / 10) * plotH;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#333366';
    ctx.lineWidth = 1;
    const zeroY = pad + plotH / 2;
    ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(W - pad, zeroY); ctx.stroke();

    // Center zone highlight
    const cIdx = Math.floor(N / 2);
    const cx = pad + (cIdx / (N - 1)) * plotW;
    ctx.fillStyle = 'rgba(255, 200, 0, 0.05)';
    ctx.fillRect(cx - 15, pad, 30, plotH);
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(cx, pad); ctx.lineTo(cx, H - pad); ctx.stroke();
    ctx.setLineDash([]);

    // Scale
    let maxV = 0.01;
    for (let i = 0; i < N; i++) {
      const vr = Number.isFinite(vRight[i]) ? Math.abs(vRight[i]) : 0;
      const vl = Number.isFinite(vLeft[i]) ? Math.abs(vLeft[i]) : 0;
      if (vr > maxV) maxV = vr;
      if (vl > maxV) maxV = vl;
      if (vr + vl > maxV) maxV = vr + vl;
    }
    maxV *= 1.1;

    const nodeX = (i: number) => pad + (i / (N - 1)) * plotW;
    const vToY = (v: number) => zeroY - (v / maxV) * (plotH / 2 - 5);

    // V⁺ (rightward) — cyan
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(0, 220, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgb(0, 220, 255)';
    ctx.shadowBlur = 3;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const v = Number.isFinite(vRight[i]) ? vRight[i] : 0;
      const y = vToY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // V⁻ (leftward) — purple
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(200, 100, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgb(200, 100, 255)';
    ctx.shadowBlur = 3;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const v = Number.isFinite(vLeft[i]) ? vLeft[i] : 0;
      const y = vToY(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // V⁺+V⁻ (total) — yellow
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(255, 200, 0)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgb(255, 200, 0)';
    ctx.shadowBlur = 5;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const vr = Number.isFinite(vRight[i]) ? vRight[i] : 0;
      const vl = Number.isFinite(vLeft[i]) ? vLeft[i] : 0;
      const y = vToY(vr + vl);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.fillText('V⁺ →', pad + 4, pad + 14);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText('← V⁻', W - pad - 40, pad + 14);
    ctx.fillStyle = 'rgb(255, 200, 0)';
    ctx.fillText('V⁺+V⁻', pad + 4, H - pad - 6);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('◀ SOURCE', pad, H - pad + 14);
    ctx.fillText('SOURCE ▶', W - pad - 55, H - pad + 14);
    ctx.fillText(`t = ${time.toFixed(2)}s`, W - pad - 60, pad - 6);

    // Arrows at boundaries
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.fillText('▶', pad - 16, zeroY + 5);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText('◀', W - pad + 6, zeroY + 5);

  }, [vRight, vLeft, N, time]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={250}
      className="w-full rounded-lg border border-gray-800"
      style={{ height: '250px' }}
    />
  );
}
