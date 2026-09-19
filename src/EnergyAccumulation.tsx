// Energy Accumulation Chart — shows whether the system pumps energy into the center.
// Plots cumulative energy over time for center nodes vs edge nodes.
// If center curve grows faster → energy is being pumped to the center.

import { useEffect, useRef } from 'react';

interface DataPoint {
  t: number;
  eCenter: number;  // cumulative energy at center (i=9,10)
  eEdge: number;    // cumulative energy at edges (i=0,1,2,17,18,19)
}

interface Props {
  history: DataPoint[];
  height?: number;
}

export default function EnergyAccumulation({ history, height = 220 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 20, right: 20, bottom: 30, left: 60 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    // Background
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#151530';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const y = pad.top + (i / 10) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = pad.left + (i / 10) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
    }

    if (history.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Start simulation to see energy accumulation', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Find max for scaling
    let maxE = 1e-10;
    for (const pt of history) {
      if (pt.eCenter > maxE) maxE = pt.eCenter;
      if (pt.eEdge > maxE) maxE = pt.eEdge;
    }
    maxE *= 1.1;

    const t0 = history[0].t;
    const t1 = history[history.length - 1].t;
    const tRange = Math.max(t1 - t0, 0.001);

    // Helper: data to canvas coords
    const toX = (t: number) => pad.left + ((t - t0) / tRange) * plotW;
    const toY = (e: number) => pad.top + plotH - (e / maxE) * plotH;

    // ── Draw edge energy (purple) ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(200, 100, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgb(200, 100, 255)';
    ctx.shadowBlur = 3;
    for (let i = 0; i < history.length; i++) {
      const x = toX(history[i].t);
      const y = toY(history[i].eEdge);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill under edge curve
    ctx.lineTo(toX(history[history.length - 1].t), pad.top + plotH);
    ctx.lineTo(toX(history[0].t), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(200, 100, 255, 0.08)';
    ctx.fill();

    // ── Draw center energy (yellow) ──
    ctx.beginPath();
    ctx.strokeStyle = 'rgb(255, 200, 0)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgb(255, 200, 0)';
    ctx.shadowBlur = 4;
    for (let i = 0; i < history.length; i++) {
      const x = toX(history[i].t);
      const y = toY(history[i].eCenter);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill under center curve
    ctx.lineTo(toX(history[history.length - 1].t), pad.top + plotH);
    ctx.lineTo(toX(history[0].t), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 200, 0, 0.1)';
    ctx.fill();

    // ── Current values at the end ──
    const lastPt = history[history.length - 1];
    const lastX = toX(lastPt.t);
    const lastYCenter = toY(lastPt.eCenter);
    const lastYEdge = toY(lastPt.eEdge);

    // Dots at current position
    ctx.fillStyle = 'rgb(255, 200, 0)';
    ctx.beginPath(); ctx.arc(lastX, lastYCenter, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.beginPath(); ctx.arc(lastX, lastYEdge, 5, 0, Math.PI * 2); ctx.fill();

    // ── Labels ──
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgb(255, 200, 0)';
    ctx.fillText(`CENTER: ${lastPt.eCenter.toExponential(2)}`, pad.left + 8, pad.top + 14);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText(`EDGES:  ${lastPt.eEdge.toExponential(2)}`, pad.left + 8, pad.top + 28);

    // Ratio
    const ratio = lastPt.eEdge > 1e-15 ? lastPt.eCenter / lastPt.eEdge : 1;
    ctx.fillStyle = ratio > 1.5 ? 'rgb(255, 100, 100)' : 'rgba(255,255,255,0.5)';
    ctx.fillText(`K = ${ratio.toFixed(2)}×`, pad.left + 8, pad.top + 42);

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText(`t=${t0.toFixed(1)}s`, pad.left, H - pad.bottom + 14);
    ctx.fillText(`t=${t1.toFixed(1)}s`, W - pad.right - 40, H - pad.bottom + 14);
    ctx.fillText(`E=${maxE.toExponential(1)}`, 2, pad.top + 4);

    // Y axis label
    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Cumulative Energy', 0, 0);
    ctx.restore();

    // X axis label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Time →', pad.left + plotW / 2, H - 4);
    ctx.textAlign = 'left';

  }, [history]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={height}
      className="w-full rounded-lg border border-gray-800"
      style={{ height: `${height}px` }}
    />
  );
}
