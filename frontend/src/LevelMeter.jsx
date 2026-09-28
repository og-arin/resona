import { useEffect, useRef } from "react";

// Segmented LED-style VU meter for one stem — same rAF/analyser pattern the
// old Waveform.jsx used, just rendered as lit blocks instead of a line.
export default function LevelMeter({ analyser, color, segments = 8, width = 14, height = 96 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!analyser) return;
    let raf;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const data = new Uint8Array(analyser.fftSize);
    let smoothed = 0;

    function draw() {
      raf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i += 8) sum += Math.abs(data[i] / 128 - 1);
      const level = sum / (data.length / 8);
      smoothed += (level - smoothed) * (level > smoothed ? 0.5 : 0.1);

      ctx.clearRect(0, 0, width, height);
      const lit = Math.round(Math.min(smoothed * 3, 1) * segments);
      const gap = 3;
      const segH = (height - gap * (segments - 1)) / segments;
      for (let i = 0; i < segments; i++) {
        const y = height - (i + 1) * (segH + gap) + gap;
        ctx.fillStyle = i < lit ? color : "rgba(255,255,255,0.06)";
        ctx.fillRect(0, y, width, segH);
      }
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, color, segments, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ borderRadius: 2 }} />;
}
