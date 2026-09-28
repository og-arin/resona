// Vertical channel fader — a native <input type="range"> rotated 90°
// instead of a custom drag widget, so dragging/keyboard/touch all come for
// free. Defaults to a plain 0..1 percentage control; pass min/max/format for
// other units (cents, playback-rate multiplier, etc).
export default function Fader({ value, onChange, color, label, height = 120, min = 0, max = 1, format }) {
  const readout = format ? format(value) : Math.round(value * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10, color: "#888" }}>{readout}</span>
      <div style={{ width: 30, height, position: "relative" }}>
        <input
          type="range"
          min={min}
          max={max}
          step={(max - min) / 200}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="fader"
          style={{
            "--fader-color": color,
            position: "absolute",
            top: "50%",
            left: "50%",
            width: height,
            transform: "translate(-50%, -50%) rotate(-90deg)",
          }}
        />
      </div>
      <span style={{ fontSize: 11, color: "#ccc", textTransform: "capitalize" }}>{label}</span>
    </div>
  );
}
