import { useEffect, useRef } from 'react';
import { AcousticState, AcousticParams, pressureToDb } from './acousticSimulation';

interface Props {
  state: AcousticState;
  params: AcousticParams;
}

export default function AcousticView({ state, params }: Props) {
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
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(W - pad, y);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#333366';
    ctx.lineWidth = 1;
    const zeroY = pad + plotH / 2;
    ctx.beginPath();
    ctx.moveTo(pad, zeroY);
    ctx.lineTo(W - pad, zeroY);
    ctx.stroke();

    // Center zone highlight
    const N = state.pressure.length;
    const cIdx = Math.floor(N / 2);
    const cx = pad + (cIdx / (N - 1)) * plotW;
    ctx.fillStyle = 'rgba(255, 200, 0, 0.05)';
    ctx.fillRect(cx - 15, pad, 30, plotH);
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, pad);
    ctx.lineTo(cx, H - pad);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scale
    let maxP = 0.01;
    for (let i = 0; i < N; i++) {
      const p = Math.abs(state.pressure[i]);
      if (p > maxP) maxP = p;
    }
    maxP *= 1.1;

    const nodeX = (i: number) => pad + (i / (N - 1)) * plotW;
    const pToY = (p: number) => zeroY - (p / maxP) * (plotH / 2 - 5);

    // Pressure wave
    ctx.beginPath();
    ctx.strokeStyle = params.mode === 'irrational' ? 'rgb(0, 220, 255)' : 'rgb(200, 100, 255)';
    ctx.lineWidth = 2;
    ctx.shadowColor = params.mode === 'irrational' ? 'rgb(0, 220, 255)' : 'rgb(200, 100, 255)';
    ctx.shadowBlur = 3;
    for (let i = 0; i < N; i++) {
      const x = nodeX(i);
      const p = state.pressure[i];
      const y = pToY(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Labels
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = params.mode === 'irrational' ? 'rgb(0, 220, 255)' : 'rgb(200, 100, 255)';
    ctx.fillText('Pressure (Pa)', pad + 4, pad + 14);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px monospace';
    ctx.fillText('◀ Speaker 1', pad, H - pad + 14);
    ctx.fillText('Speaker 2 ▶', W - pad - 60, H - pad + 14);
    ctx.fillText(`t = ${(state.time*1000).toFixed(2)} ms`, W - pad - 80, pad - 6);

    // Scale markers
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText(`+${maxP.toFixed(1)} Pa`, W - pad - 50, pad + 20);
    ctx.fillText(`-${maxP.toFixed(1)} Pa`, W - pad - 50, H - pad - 10);

    // Center dB
    const centerP = Math.abs(state.pressure[cIdx]);
    const centerDb = pressureToDb(centerP);
    ctx.fillStyle = 'rgb(255, 200, 0)';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`Center: ${centerDb.toFixed(1)} dB`, cx - 30, pad + 30);

  }, [state, params]);

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
