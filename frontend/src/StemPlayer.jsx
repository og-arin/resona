import { useEffect, useRef, useState } from "react";
import Fader from "./Fader";
import LevelMeter from "./LevelMeter";

export const STEM_COLORS = {
  vocals: "#ff2d95",
  drums: "#00f0ff",
  bass: "#b967ff",
  guitar: "#ff8c1a",
  piano: "#39ff14",
  other: "#d0d0ff",
};
const colorOf = (name) => STEM_COLORS[name] || "#888";

// same box as a stem channel-strip (.stem-card.mixer-strip), but for a
// master-bus control instead of a stem. The first placeholder is invisible
// (stands in for the ON/OFF slot a stem strip has, so heights still match);
// the second is a real reset button, styled exactly like a stem's download
// button, in that same slot.
function ControlStrip({ onReset, children }) {
  return (
    <div
      className="stem-card mixer-strip"
      style={{
        "--glow": "#ffffff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "14px 10px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.15)",
      }}
    >
      {children}
      <div className="toggle-pill" style={{ visibility: "hidden", padding: "6px 0", fontSize: 11, width: "100%" }}>
        —
      </div>
      <button
        onClick={onReset}
        className="toggle-pill"
        style={{
          background: "#111",
          border: "1px solid #333",
          color: "#aaa",
          borderRadius: 4,
          width: "100%",
          padding: "6px 0",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ↺
      </button>
    </div>
  );
}

export default function StemPlayer({ stems, apiBase, onAnalyserReady }) {
  const ctxRef = useRef(null);
  const buffersRef = useRef({});
  const gainsRef = useRef({});
  const sourcesRef = useRef({});
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const analysersRef = useRef({});
  const effectsRef = useRef(null); // { busIn, out, reverbWet, echoWet }

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);
  const [volume, setVolume] = useState({});
  const [masterVolume, setMasterVolume] = useState(1);
  const [enabled, setEnabled] = useState({});
  const [pitch, setPitchState] = useState(0); // cents, -1200..1200
  const [speed, setSpeedState] = useState(1); // playback-rate multiplier
  const [reverbMix, setReverbMixState] = useState(0);
  const [echoMix, setEchoMixState] = useState(0);
  const [filterValue, setFilterValueState] = useState(0); // -1 (closed lowpass) .. 0 (flat) .. 1 (closed highpass)

  const stemNames = Object.keys(stems);

  // detune and playbackRate both resample the source, so they compose into
  // one effective rate — needed to keep our own elapsed-time bookkeeping
  // (which Web Audio knows nothing about) in sync with what's actually
  // being heard.
  const getRate = (spd, cents) => spd * Math.pow(2, cents / 1200);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctxRef.current = ctx;

      // shared master bus: every stem feeds into this, then reverb/echo are
      // applied once to the combined mix instead of per stem
      const chain = buildEffectsChain(ctx, 0, 0, 0);
      chain.out.connect(ctx.destination);
      effectsRef.current = chain;

      await Promise.all(
        stemNames.map(async (name) => {
          const res = await fetch(`${apiBase}${stems[name]}`);
          const arrayBuffer = await res.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          if (cancelled) return;
          buffersRef.current[name] = audioBuffer;
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          gain.connect(analyser);
          analyser.connect(chain.busIn);
          gainsRef.current[name] = gain;
          analysersRef.current[name] = analyser;
          setVolume((v) => ({ ...v, [name]: 1 }));
          setEnabled((e) => ({ ...e, [name]: true }));
        })
      );

      if (!cancelled) {
        setDuration(Math.max(...Object.values(buffersRef.current).map((b) => b.duration)));
        setReady(true);
        // hand the per-stem analysers up so the background can react to
        // individual instruments (drums for the beat, bass for the swell,
        // vocals for the glow) instead of one blended signal.
        onAnalyserReady?.(analysersRef.current);
      }
    }
    load();
    return () => {
      cancelled = true;
      ctxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing) return;
    const rate = getRate(speed, pitch);
    const id = setInterval(() => {
      const ctx = ctxRef.current;
      const elapsed = offsetRef.current + (ctx.currentTime - startedAtRef.current) * rate;
      setDisplayTime(Math.min(elapsed, duration));
    }, 200);
    return () => clearInterval(id);
  }, [playing, duration, speed, pitch]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        playing ? pause() : play();
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= stemNames.length) toggleEnabled(stemNames[n - 1]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, enabled, volume, masterVolume]);

  function stopAllSources() {
    Object.values(sourcesRef.current).forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    sourcesRef.current = {};
  }

  function startFrom(offset) {
    const ctx = ctxRef.current;
    stopAllSources();
    const startTime = ctx.currentTime + 0.05;
    stemNames.forEach((name) => {
      const src = ctx.createBufferSource();
      src.buffer = buffersRef.current[name];
      src.playbackRate.value = speed;
      src.detune.value = pitch;
      src.connect(gainsRef.current[name]);
      src.start(startTime, offset);
      sourcesRef.current[name] = src;
    });
    offsetRef.current = offset;
    startedAtRef.current = startTime;
  }

  function play() {
    if (!ready) return;
    if (Object.keys(sourcesRef.current).length === 0) startFrom(offsetRef.current);
    else ctxRef.current.resume();
    setPlaying(true);
  }

  function pause() {
    offsetRef.current += (ctxRef.current.currentTime - startedAtRef.current) * getRate(speed, pitch);
    ctxRef.current.suspend();
    setPlaying(false);
  }

  function seek(newTime) {
    const wasPlaying = playing;
    stopAllSources();
    offsetRef.current = newTime;
    setDisplayTime(newTime);
    if (wasPlaying) startFrom(newTime);
  }

  function applyGains(volumeMap, enabledMap, master) {
    stemNames.forEach((name) => {
      const gain = gainsRef.current[name];
      if (!gain) return;
      const vol = volumeMap[name] ?? 1;
      const on = enabledMap[name] ?? true;
      gain.gain.value = on ? vol * master : 0;
    });
  }

  function setStemVolume(name, val) {
    setVolume((v) => {
      const next = { ...v, [name]: val };
      applyGains(next, enabled, masterVolume);
      return next;
    });
  }

  function setMaster(val) {
    setMasterVolume(val);
    applyGains(volume, enabled, val);
  }

  // changing playback rate or detune mid-playback changes how fast buffer
  // time is being consumed, so our own elapsed-time bookkeeping has to be
  // rebased against the *old* effective rate before the new one takes over
  // — otherwise the seek bar drifts out of sync with the audio.
  function rebaseOffset() {
    const ctx = ctxRef.current;
    if (Object.keys(sourcesRef.current).length === 0) return;
    offsetRef.current += (ctx.currentTime - startedAtRef.current) * getRate(speed, pitch);
    startedAtRef.current = ctx.currentTime;
  }

  function setPitch(cents) {
    rebaseOffset();
    setPitchState(cents);
    Object.values(sourcesRef.current).forEach((src) => { src.detune.value = cents; });
  }

  function setSpeed(rate) {
    rebaseOffset();
    setSpeedState(rate);
    Object.values(sourcesRef.current).forEach((src) => { src.playbackRate.value = rate; });
  }

  function setReverbMix(v) {
    setReverbMixState(v);
    if (effectsRef.current) effectsRef.current.reverbWet.gain.value = v;
  }

  function setEchoMix(v) {
    setEchoMixState(v);
    if (effectsRef.current) effectsRef.current.echoWet.gain.value = v;
  }

  function setFilterValue(v) {
    setFilterValueState(v);
    if (effectsRef.current) applyFilterValue(effectsRef.current.filter, v);
  }

  function toggleEnabled(name) {
    setEnabled((e) => {
      const next = { ...e, [name]: !e[name] };
      applyGains(volume, next, masterVolume);
      return next;
    });
  }

  const [exporting, setExporting] = useState(false);

  // renders exactly what you're hearing — current faders/mutes/pitch/speed/
  // reverb/echo baked in — to one WAV, entirely client-side via
  // OfflineAudioContext. No server round-trip, no new dependency for the
  // encode: WAV is a plain PCM header, cheap enough to write by hand.
  async function exportMix() {
    setExporting(true);
    try {
      const first = buffersRef.current[stemNames[0]];
      const rate = getRate(speed, pitch);
      const offline = new OfflineAudioContext(
        first.numberOfChannels,
        Math.ceil((duration / rate) * first.sampleRate),
        first.sampleRate
      );
      const chain = buildEffectsChain(offline, reverbMix, echoMix, filterValue);
      chain.out.connect(offline.destination);
      stemNames.forEach((name) => {
        if (enabled[name] === false) return;
        const src = offline.createBufferSource();
        src.buffer = buffersRef.current[name];
        src.playbackRate.value = speed;
        src.detune.value = pitch;
        const gain = offline.createGain();
        gain.gain.value = (volume[name] ?? 1) * masterVolume;
        src.connect(gain).connect(chain.busIn);
        src.start(0);
      });
      const rendered = await offline.startRendering();
      const blob = audioBufferToWav(rendered);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mix.wav";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (!ready) {
    return (
      <div className="panel" style={{ marginTop: 32, padding: "16px 24px" }}>
        <span style={{ color: "#888", fontSize: 13 }}>&gt; loading stems into one AudioContext</span>
        <span className="blink-cursor">_</span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 32 }}>
      {/* transport */}
      <div className="panel" style={{ padding: "20px 24px", display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
        <button
          onClick={playing ? pause : play}
          className="toggle-pill"
          style={{
            background: playing ? "#ff2d95" : "#111",
            border: "1px solid #ff2d95",
            color: playing ? "#000" : "#ff2d95",
            padding: "10px 20px",
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {playing ? "PAUSE" : "PLAY"}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={displayTime}
          onChange={(e) => seek(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "#ff2d95" }}
        />
        <span style={{ color: "#777", fontSize: 12, minWidth: 90, textAlign: "right" }}>
          {fmt(displayTime)} / {fmt(duration)}
        </span>
        <button
          onClick={exportMix}
          disabled={exporting}
          className="toggle-pill"
          style={{
            background: "#111",
            border: "1px solid #444",
            color: exporting ? "#555" : "#ccc",
            padding: "10px 16px",
            borderRadius: 4,
            cursor: exporting ? "default" : "pointer",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        >
          {exporting ? "rendering…" : "export mix"}
        </button>
      </div>

      {/* master controls — vol/pitch/speed/reverb/echo/filter, one row,
          above the per-stem strips since these apply to the whole mix, not
          one stem. Same box (.stem-card.mixer-strip) as the stem strips
          below, with hidden placeholder buttons standing in for the
          ON/OFF + download row those have — keeps every box identically
          sized instead of eyeballing a fixed height. */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <ControlStrip onReset={() => setMaster(1)}>
          <Fader value={masterVolume} onChange={setMaster} color="#ffffff" label="master" height={96} />
        </ControlStrip>
        <ControlStrip onReset={() => setPitch(0)}>
          <Fader
            value={pitch}
            onChange={setPitch}
            color="#ffffff"
            label="pitch"
            height={96}
            min={-1200}
            max={1200}
            format={(v) => `${v > 0 ? "+" : ""}${Math.round(v / 100)}st`}
          />
        </ControlStrip>
        <ControlStrip onReset={() => setSpeed(1)}>
          <Fader
            value={speed}
            onChange={setSpeed}
            color="#ffffff"
            label="speed"
            height={96}
            min={0.5}
            max={2}
            format={(v) => `${v.toFixed(2)}x`}
          />
        </ControlStrip>
        <ControlStrip onReset={() => setReverbMix(0)}>
          <Fader value={reverbMix} onChange={setReverbMix} color="#ffffff" label="reverb" height={96} />
        </ControlStrip>
        <ControlStrip onReset={() => setEchoMix(0)}>
          <Fader value={echoMix} onChange={setEchoMix} color="#ffffff" label="echo" height={96} />
        </ControlStrip>
        <ControlStrip onReset={() => setFilterValue(0)}>
          <Fader
            value={filterValue}
            onChange={setFilterValue}
            color="#ffffff"
            label="filter"
            height={96}
            min={-1}
            max={1}
            format={(v) => (v < -0.02 ? "lp" : v > 0.02 ? "hp" : "--")}
          />
        </ControlStrip>
      </div>

      {/* channel strips — DJ mixer style: one meter+fader strip per stem,
          all sized to fit instead of stretched */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        {stemNames.map((name) => {
          const c = colorOf(name);
          const on = enabled[name] !== false;
          return (
            <div
              key={name}
              className="stem-card mixer-strip"
              style={{
                "--glow": c,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "14px 10px",
                borderRadius: 6,
                background: `rgba(${hexToRgb(c)}, 0.05)`,
                border: `1px solid rgba(${hexToRgb(c)}, ${on ? 0.35 : 0.1})`,
                opacity: on ? 1 : 0.4,
              }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <LevelMeter analyser={analysersRef.current[name]} color={c} />
                <Fader value={volume[name] ?? 1} onChange={(v) => setStemVolume(name, v)} color={c} label={name} height={96} />
              </div>

              <button
                onClick={() => toggleEnabled(name)}
                className="toggle-pill"
                style={{
                  background: on ? c : "#151515",
                  color: on ? "#000" : "#666",
                  border: `1px solid ${c}`,
                  borderRadius: 4,
                  padding: "6px 0",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                {on ? "ON" : "OFF"}
              </button>

              <a href={`${apiBase}${stems[name]}`} download={`${name}.wav`} style={{ width: "100%" }}>
                <button
                  className="toggle-pill"
                  style={{
                    background: "#111",
                    border: "1px solid #333",
                    color: "#aaa",
                    borderRadius: 4,
                    width: "100%",
                    padding: "6px 0",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  ⬇
                </button>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// algorithmic reverb impulse response: exponentially-decaying white noise.
// Sounds like a plain room/hall, not a real captured space, but needs no
// audio asset file and no dependency.
function makeImpulseResponse(ctx, seconds = 2.2, decay = 2.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

// classic DJ-mixer filter knob: center = flat/bypassed, sweep left = lowpass
// closing in (cuts highs), sweep right = highpass opening up (cuts lows).
// One BiquadFilterNode, just retuned based on which side of center it's on.
function applyFilterValue(filter, v) {
  if (v < -0.02) {
    filter.type = "lowpass";
    filter.frequency.value = 150 * Math.pow(20000 / 150, v + 1); // v:-1..0 -> 150..20000Hz
  } else if (v > 0.02) {
    filter.type = "highpass";
    filter.frequency.value = 20 * Math.pow(8000 / 20, v); // v:0..1 -> 20..8000Hz
  } else {
    filter.type = "lowpass";
    filter.frequency.value = 20000; // wide open — effectively bypassed
  }
  filter.Q.value = 1;
}

// shared master-bus effects chain: busIn is where every stem's signal
// lands, out is what to connect to the destination. Reverb and echo are
// each a dry pass-through plus a wet send, summed — no separate dry gain
// node needed since the dry path is never attenuated. reverbWet/echoWet/
// filter are exposed so callers can adjust the mix live (or just leave it
// fixed, for the one-shot export render).
function buildEffectsChain(ctx, reverbMix, echoMix, filterValue = 0) {
  const busIn = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  applyFilterValue(filter, filterValue);
  busIn.connect(filter);

  const reverbOut = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = reverbMix;
  filter.connect(reverbOut);
  filter.connect(convolver);
  convolver.connect(reverbWet);
  reverbWet.connect(reverbOut);

  const echoOut = ctx.createGain();
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  delay.connect(feedback);
  feedback.connect(delay);
  const echoWet = ctx.createGain();
  echoWet.gain.value = echoMix;
  reverbOut.connect(echoOut);
  reverbOut.connect(delay);
  delay.connect(echoWet);
  echoWet.connect(echoOut);

  return { busIn, out: echoOut, reverbWet, echoWet, filter };
}

// minimal 16-bit PCM WAV encoder — an AudioBuffer is raw samples, this just
// writes the standard 44-byte RIFF header in front of them
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: numChannels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: "audio/wav" });
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}