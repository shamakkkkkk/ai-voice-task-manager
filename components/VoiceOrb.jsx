'use client';
import { useEffect, useRef } from 'react';
import { IconMic, IconStop } from './Icons.jsx';

const SIZE = 320; // internal canvas units; CSS scales it
const BARS = 72;
const R0 = 92; // inner radius of the bars

/**
 * The hero of the app: a button surrounded by a radial spectrum.
 *  listening → real microphone spectrum (or a synthetic wave on touch devices)
 *  speaking  → the model's voice in Live mode, drawn in white
 *  thinking  → a highlight chasing around the ring
 *  idle      → a slow breathing ring
 */
export default function VoiceOrb({ phase, analyserRef, onClick, label, disabled }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

    const bins = new Uint8Array(64);
    const level = new Float32Array(BARS);
    const start = performance.now();
    let raf = 0;

    const frame = (now) => {
      const t = (now - start) / 1000;
      const phaseNow = phaseRef.current;
      const analyser = analyserRef.current;
      const audible = phaseNow === 'listening' || phaseNow === 'speaking';
      if (audible && analyser) analyser.getByteFrequencyData(bins);

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.4;
      let sum = 0;

      for (let i = 0; i < BARS; i++) {
        const pos = i / BARS;
        let target;
        if (audible) {
          if (analyser) {
            const mirrored = pos < 0.5 ? pos * 2 : (1 - pos) * 2; // symmetric spectrum
            const bin = Math.min(47, Math.floor(mirrored * 44) + 1);
            target = Math.min(1, (bins[bin] / 255) * 1.35);
          } else {
            target = 0.32 + 0.3 * Math.sin(t * 4.2 + i * 0.7) * Math.sin(t * 1.7 + i * 0.29);
          }
        } else if (phaseNow === 'thinking') {
          const head = (t * 0.9) % 1;
          const d = Math.cos((pos - head) * Math.PI * 2);
          target = 0.14 + 0.72 * Math.pow(Math.max(0, d), 5);
        } else {
          target = 0.07 + 0.05 * Math.sin(t * 1.1 + i * 0.42);
        }
        level[i] += (target - level[i]) * 0.34;
        sum += level[i];

        const a = pos * Math.PI * 2 - Math.PI / 2;
        const len = 5 + level[i] * 52;
        const cx = SIZE / 2;
        ctx.strokeStyle =
          phaseNow === 'listening' ? `rgba(255,216,74,${0.55 + level[i] * 0.45})` : `rgba(255,255,255,${0.35 + level[i] * 0.6})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R0, cx + Math.sin(a) * R0);
        ctx.lineTo(cx + Math.cos(a) * (R0 + len), cx + Math.sin(a) * (R0 + len));
        ctx.stroke();
      }
      wrap.style.setProperty('--lvl', audible ? (sum / BARS).toFixed(3) : '0');
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);

  return (
    <div className="orb" ref={wrapRef} data-phase={phase}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <button
        type="button"
        className="orb-btn"
        onClick={onClick}
        aria-pressed={phase === 'listening'}
        aria-label={label}
        disabled={disabled}
      >
        {phase === 'listening' ? <IconStop width={44} height={44} /> : <IconMic width={46} height={46} />}
      </button>
    </div>
  );
}
