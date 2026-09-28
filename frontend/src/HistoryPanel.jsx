export default function HistoryPanel({ history, onSelect, onDelete, activeId }) {
  if (history.length === 0) return null;

  return (
    <div style={{ marginTop: 40 }}>
      <h3 style={{ color: "#555", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
        recent splits
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {history.map((entry) => {
          const active = activeId === entry.id;
          return (
            <div
              key={entry.id}
              onClick={() => onSelect(entry)}
              className="stem-card"
              style={{
                "--glow": "#ff2d95",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 18px",
                borderRadius: 6,
                background: active ? "rgba(255,45,149,0.05)" : "linear-gradient(180deg, #161616, #0d0d0d)",
                border: `1px solid ${active ? "#ff2d95" : "#2a2a2a"}`,
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ color: "#eee", fontSize: 13 }}>{entry.filename}</div>
                <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>
                  {new Date(entry.ts).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(entry.id);
                }}
                style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}