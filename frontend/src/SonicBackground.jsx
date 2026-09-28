import { useEffect, useRef } from "react";
import { STEM_COLORS } from "./StemPlayer";

const STEM_ORDER = ["vocals", "bass", "drums", "guitar", "other", "piano"];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Full-screen spectrum visualizer, mirrored symmetrically around the vertical
// center. Each bar pools every stem's energy at that frequency bin and is
// colored by whichever stem dominates it there — so a bass-heavy bar tints
// purple, a vocal-heavy one tints pink, etc. Drums also drive a beat-flash
// pulse. A slow-tracked "mood" (bright+energetic vs dark+mellow) hue-rotates
// the whole palette — a cheap heuristic, not real emotion detection: it reads
// spectral centroid (brightness) and overall loudness (energy) off the
// combined spectrum, not genre or lyrics. With no stems loaded it falls back
// to a gentle idle drift.
export default function SonicBackground({ stemAnalysers }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let dpr = 1, w = 0, h = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    };
    resize();
    window.addEventListener("resize", resize);

    const stemNames = stemAnalysers
      ? Object.keys(stemAnalysers).sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b))
      : [];
    const stemRgb = Object.fromEntries(stemNames.map((n) => [n, hexToRgb(STEM_COLORS[n] || "#888888")]));
    const freqData = {};
    stemNames.forEach((name) => {
      freqData[name] = new Uint8Array(stemAnalysers[name].frequencyBinCount);
    });

    // drums get an attack-fast/release-slow envelope + baseline so beat
    // hits can be detected as a real spike, not just raw jitter
    const drumsEnv = { value: 0, avg: 0, flash: 0, lastFlashAt: -Infinity };
    function trackDrums(raw, t) {
      drumsEnv.value += (raw - drumsEnv.value) * (raw > drumsEnv.value ? 0.6 : 0.08);
      drumsEnv.avg += (raw - drumsEnv.avg) * 0.015;
      if (raw > drumsEnv.avg * 1.35 && raw > 0.12 && t - drumsEnv.lastFlashAt > 180) {
        drumsEnv.flash = 1;
        drumsEnv.lastFlashAt = t;
      }
      drumsEnv.flash *= 0.9;
    }

    const barCount = 96;
    const idlePhases = Array.from({ length: barCount }, () => Math.random() * Math.PI * 2);

    // mood tracker: spectral centroid (brightness) + overall loudness
    // (energy), each smoothed over a couple seconds so the palette drifts
    // with the song's vibe instead of flickering every frame
    const mood = { hue: 0, sat: 1 };

    function draw(t) {
      // a translucent wipe (instead of a hard clear) would leave nice bar
      // trails, but it also asymptotically paints over the mesh-glow layer
      // sitting behind this canvas — so a real clear it is.
      ctx.clearRect(0, 0, w, h);

      const playing = stemNames.length > 0;
      if (playing) {
        stemNames.forEach((name) => stemAnalysers[name].getByteFrequencyData(freqData[name]));
        const drums = freqData.drums;
        let drumsRaw = 0;
        if (drums) {
          for (let i = 0; i < 8; i++) drumsRaw += drums[i] / 255;
          drumsRaw /= 8;
        }
        trackDrums(drumsRaw, t);

        // "mood": spectral centroid = brightness (dark/bassy vs bright/airy),
        // mean level = energy (mellow vs loud/energetic). Rough proxies, not
        // real emotion detection — but they do separate a moody ballad from
        // an upbeat bright track reasonably well.
        const binCount = freqData[stemNames[0]].length;
        let weightedSum = 0, energySum = 0;
        for (let bin = 0; bin < binCount; bin++) {
          let binTotal = 0;
          for (let s = 0; s < stemNames.length; s++) binTotal += freqData[stemNames[s]][bin];
          energySum += binTotal;
          weightedSum += binTotal * bin;
        }
        const brightness = energySum > 0 ? weightedSum / energySum / binCount : 0.3;
        const energy = energySum / (binCount * 255 * stemNames.length);

        // discrete mood buckets instead of one continuous formula — easier
        // to reason about and to retune by ear than a single blended curve
        let targetHue, targetSat;
        if (energy > 0.32 && brightness > 0.35) {
          // loud + bright/airy: reads as upbeat — warm, saturated
          targetHue = 35;
          targetSat = 1.3;
        } else if (energy > 0.32 && brightness <= 0.35) {
          // loud + bass-heavy/dark: reads as intense, not necessarily happy
          targetHue = -30;
          targetSat = 1.1;
        } else if (energy <= 0.32 && brightness <= 0.35) {
          // quiet + dark: reads as moody/depressing — cool, desaturated
          targetHue = -90;
          targetSat = 0.55;
        } else {
          // quiet + bright: reads as mellow/dreamy
          targetHue = 15;
          targetSat = 0.9;
        }
        mood.hue += (targetHue - mood.hue) * 0.01;
        mood.sat += (targetSat - mood.sat) * 0.01;
        canvas.style.filter = `hue-rotate(${mood.hue.toFixed(1)}deg) saturate(${mood.sat.toFixed(2)})`;
      } else {
        mood.hue *= 0.98;
        mood.sat += (1 - mood.sat) * 0.02;
        canvas.style.filter = mood.hue ? `hue-rotate(${mood.hue.toFixed(1)}deg)` : "none";
      }

      const centerY = h / 2;
      const maxBarH = h * 0.42;
      const barW = w / barCount;
      const binCount = playing ? freqData[stemNames[0]].length : 0;

      for (let i = 0; i < barCount; i++) {
        let amp, r, g, b;
        if (playing) {
          // low bins carry almost all the energy, so mapping bar index
          // straight to bin index piles all the height at the left edge.
          // Mirror outward from center instead: loudest (lowest) frequencies
          // sit in the middle, quieter highs taper off toward both edges —
          // keeps it visually centered instead of left-heavy.
          const dist = Math.abs(i - barCount / 2) / (barCount / 2);
          const bin = Math.floor(Math.pow(dist, 1.5) * (binCount - 1));
          let total = 0, rSum = 0, gSum = 0, bSum = 0;
          stemNames.forEach((name) => {
            const v = freqData[name][bin] / 255;
            total += v;
            const [sr, sg, sb] = stemRgb[name];
            rSum += sr * v; gSum += sg * v; bSum += sb * v;
          });
          amp = Math.min(total / stemNames.length, 1);
          if (total > 0.02) { r = rSum / total; g = gSum / total; b = bSum / total; }
          else { r = 255; g = 255; b = 255; }
        } else {
          amp = (Math.sin(t * 0.0008 + idlePhases[i]) * 0.5 + 0.5) * 0.35;
          r = 255; g = 45; b = 149;
        }

        const barH = Math.max(amp * maxBarH, h * 0.003);
        const alpha = playing ? 0.25 + amp * 0.55 : 0.15 + amp * 0.2;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
        const x = i * barW;
        // mirrored evenly above and below dead-center
        ctx.fillRect(x, centerY - barH, barW * 0.72, barH);
        ctx.fillRect(x, centerY, barW * 0.72, barH);
      }

      // brief white-hot flash from center on a detected drum hit
      if (drumsEnv.flash > 0.03) {
        const grad = ctx.createRadialGradient(w / 2, centerY, 0, w / 2, centerY, w * 0.5);
        grad.addColorStop(0, `rgba(255,255,255,${drumsEnv.flash * 0.08})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
    }

    // no point burning CPU/battery drawing a backdrop nobody can see
    let frame = null;
    function loop(t) {
      draw(t);
      frame = requestAnimationFrame(loop);
    }
    function handleVisibility() {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = null;
      } else if (!frame) {
        frame = requestAnimationFrame(loop);
      }
    }
    if (!document.hidden) frame = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [stemAnalysers]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}
    />
  );
}
