import { useEffect, useRef } from 'react';

interface Props {
  irrHistory: { t: number; peak: number }[];
  harmHistory: { t: number; peak: number }[];
  irrMax: number;
  harmMax: number;
}

export default function PeakComparisonChart({ irrHistory, harmHistory, irrMax, harmMax }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 30, right: 20, bottom: 40, left: 60 };
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
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = pad.left + (i / 10) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, H - pad.bottom);
      ctx.stroke();
    }

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Center Peak Pressure Over Time (Acoustic Waves)', W / 2, 20);

    if (irrHistory.length < 2 && harmHistory.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '12px monospace';
      ctx.fillText('Start simulation to see comparison', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Find max for scaling
    const maxPeak = Math.max(irrMax, harmMax, 1e-10) * 1.1;

    // Time range
    const t0 = Math.min(
      irrHistory.length > 0 ? irrHistory[0].t : Infinity,
      harmHistory.length > 0 ? harmHistory[0].t : Infinity
    );
    const t1 = Math.max(
      irrHistory.length > 0 ? irrHistory[irrHistory.length - 1].t : 0,
      harmHistory.length > 0 ? harmHistory[harmHistory.length - 1].t : 0
    );
    const tRange = Math.max(t1 - t0, 0.001);

    const toX = (t: number) => pad.left + ((t - t0) / tRange) * plotW;
    const toY = (peak: number) => pad.top + plotH - (peak / maxPeak) * plotH;

    // Draw irrational peaks (cyan)
    if (irrHistory.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgb(0, 220, 255)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgb(0, 220, 255)';
      ctx.shadowBlur = 3;
      for (let i = 0; i < irrHistory.length; i++) {
        const x = toX(irrHistory[i].t);
        const y = toY(irrHistory[i].peak);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill under curve
      ctx.lineTo(toX(irrHistory[irrHistory.length - 1].t), pad.top + plotH);
      ctx.lineTo(toX(irrHistory[0].t), pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 220, 255, 0.08)';
      ctx.fill();
    }

    // Draw harmonic peaks (purple)
    if (harmHistory.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgb(200, 100, 255)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgb(200, 100, 255)';
      ctx.shadowBlur = 3;
      for (let i = 0; i < harmHistory.length; i++) {
        const x = toX(harmHistory[i].t);
        const y = toY(harmHistory[i].peak);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Fill under curve
      ctx.lineTo(toX(harmHistory[harmHistory.length - 1].t), pad.top + plotH);
      ctx.lineTo(toX(harmHistory[0].t), pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(200, 100, 255, 0.08)';
      ctx.fill();
    }

    // Current values
    const lastIrr = irrHistory[irrHistory.length - 1];
    const lastHarm = harmHistory[harmHistory.length - 1];

    if (lastIrr) {
      ctx.fillStyle = 'rgb(0, 220, 255)';
      ctx.beginPath();
      ctx.arc(toX(lastIrr.t), toY(lastIrr.peak), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (lastHarm) {
      ctx.fillStyle = 'rgb(200, 100, 255)';
      ctx.beginPath();
      ctx.arc(toX(lastHarm.t), toY(lastHarm.peak), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgb(0, 220, 255)';
    ctx.textAlign = 'left';
    ctx.fillText(`IRRATIONAL: ${irrMax.toExponential(2)} Pa`, pad.left + 8, pad.top + 14);
    ctx.fillStyle = 'rgb(200, 100, 255)';
    ctx.fillText(`HARMONIC: ${harmMax.toExponential(2)} Pa`, pad.left + 8, pad.top + 28);

    // Ratio
    const ratio = harmMax > 1e-15 ? irrMax / harmMax : 1;
    ctx.fillStyle = ratio > 1.2 ? 'rgb(0, 220, 255)' : ratio < 0.8 ? 'rgb(200, 100, 255)' : 'rgba(255,255,255,0.5)';
    ctx.fillText(`Ratio: ${ratio.toFixed(2)}×`, pad.left + 8, pad.top + 42);

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`t=${(t0*1000).toFixed(1)}ms`, pad.left, H - pad.bottom + 14);
    ctx.fillText(`t=${(t1*1000).toFixed(1)}ms`, W - pad.right - 20, H - pad.bottom + 14);
    ctx.fillText('Time (milliseconds) →', pad.left + plotW / 2, H - 8);

    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Peak Pressure (Pa)', 0, 0);
    ctx.restore();

    ctx.textAlign = 'left';

  }, [irrHistory, harmHistory, irrMax, harmMax]);

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={280}
      className="w-full rounded-lg border border-gray-800"
      style={{ height: '280px' }}
    />
  );
}
