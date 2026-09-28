import { useState, useCallback } from "react";
import StemPlayer from "./StemPlayer";
import HistoryPanel from "./HistoryPanel";
import useHistory from "./useHistory";
import SonicBackground from "./SonicBackground";

// Vercel env var VITE_API_URL should point at the backend's Tailscale
// Funnel HTTPS URL (e.g. https://laptop-name.tailnet-name.ts.net) —
// falls back to localhost for local dev.
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [stems, setStems] = useState(null);
  const [filename, setFilename] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [stemAnalysers, setStemAnalysers] = useState(null);

  const { history, addEntry, removeEntry } = useHistory();

  const poll = useCallback((id, name) => {
    const interval = setInterval(async () => {
      const res = await fetch(`${API}/status/${id}`);
      const data = await res.json();
      setStatus(data.status);
      setProgress(data.progress);
      if (data.status === "done") {
        clearInterval(interval);
        setStems(data.stems);
        setActiveId(id);
        addEntry({ id, filename: name, stems: data.stems });
      }
      if (data.status === "error") {
        clearInterval(interval);
        setError(data.error);
      }
    }, 1500);
  }, [addEntry]);

  const handleFile = async (file) => {
    setError(null);
    setStatus("uploading");
    setFilename(file.name);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/upload`, { method: "POST", body: form });
    const { job_id } = await res.json();
    setStatus("queued");
    poll(job_id, file.name);
  };

  const handleLink = async () => {
    if (!linkUrl.trim()) return;
    setError(null);
    setStatus("uploading");
    setFilename(linkUrl);
    const res = await fetch(`${API}/upload-link?url=${encodeURIComponent(linkUrl)}`, { method: "POST" });
    const { job_id } = await res.json();
    setStatus("queued");
    poll(job_id, linkUrl);
    setLinkUrl("");
  };

  // cheap 3D tilt: rotate toward the cursor via a direct style write, no
  // state/re-render needed since it's purely cosmetic per-frame feedback
  const onTilt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.style.transform = `perspective(600px) rotateX(${-py * 8}deg) rotateY(${px * 8}deg)`;
  };
  const resetTilt = (e) => {
    e.currentTarget.style.transform = "perspective(600px) rotateX(0) rotateY(0)";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const selectHistoryEntry = (entry) => {
    setStems(entry.stems);
    setActiveId(entry.id);
    setFilename(entry.filename);
    setStatus("done");
    setError(null);
  };

  const deleteHistoryEntry = (id) => {
    removeEntry(id);
    if (id === activeId) {
      setStems(null);
      setActiveId(null);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#eee", position: "relative" }}>
      <div className="mesh-glow" />
      <SonicBackground stemAnalysers={stemAnalysers} />
      <div className="scan-grid" />
      <div className="scan-grid-far" />
      <div className="noise-layer" />
      <div className="vignette" />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "56px 16px 80px", position: "relative", zIndex: 1 }}>

        {/* hero */}
        <div className="fade-in" style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span
              className="pulse-dot"
              style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff2d95" }}
            />
            <span style={{ color: "#555", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>
              Free · online · 6-stem
            </span>
          </div>
          <h1 style={{ color: "#fff", fontSize: 40, fontWeight: 800, letterSpacing: -1, margin: 0 }}>
            Resona
          </h1>
          <p style={{ color: "#666", fontSize: 14, marginTop: 8, maxWidth: 480 }}>
            Drop a track. Get vocals, drums, bass, guitar, piano and everything else — isolated, mixable, downloadable.
          </p>
        </div>

        {/* uploader */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={(e) => { setDragActive(false); resetTilt(e); }}
          onClick={() => document.getElementById("file-input").click()}
          onMouseMove={onTilt}
          onMouseLeave={resetTilt}
          className="fade-in glow-btn tilt-card"
          style={{
            border: `2px dashed ${dragActive ? "#ff2d95" : "#2a2a2a"}`,
            background: "rgba(10,10,10,0.6)",
            backdropFilter: "blur(6px)",
            borderRadius: 12,
            padding: 40,
            textAlign: "center",
            cursor: "pointer",
            color: dragActive ? "#ff2d95" : "#777",
            fontSize: 14,
            transition: "border-color 0.15s, color 0.15s, transform 0.08s ease-out",
          }}
        >
          <input
            id="file-input"
            type="file"
            accept=".mp3,.wav"
            hidden
            onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
          />
          {filename && status !== "done" ? filename : "> drop an mp3/wav here, or click to pick one"}
        </div>

        {/* link input */}
        <div className="fade-in" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            type="text"
            placeholder="or paste a youtube link"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLink()}
            style={{
              flex: 1,
              background: "rgba(10,10,10,0.6)",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#eee",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleLink}
            className="glow-btn"
            style={{
              background: "#0a0a0a",
              border: "1px solid #ff2d95",
              color: "#ff2d95",
              borderRadius: 4,
              padding: "10px 16px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            split
          </button>
        </div>

        {/* progress */}
        {status && status !== "done" && (
          <div className="fade-in" style={{ marginTop: 24 }}>
            <p style={{ color: "#666", fontSize: 13 }}>&gt; {status}</p>
            <div style={{ background: "#111", borderRadius: 8, height: 6 }}>
              <div
                style={{
                  width: `${progress}%`,
                  background: "#ff2d95",
                  height: "100%",
                  borderRadius: 8,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <p style={{ color: "#555", fontSize: 12 }}>{progress}%</p>
          </div>
        )}

        {error && (
          <div
            className="panel fade-in"
            style={{ marginTop: 16, padding: "14px 18px", borderColor: "#5c2020" }}
          >
            <div style={{ color: "#f75c5c", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
              &gt; fault
            </div>
            <pre style={{ color: "#f75c5c", whiteSpace: "pre-wrap", fontSize: 11, margin: 0 }}>{error}</pre>
          </div>
        )}

        {stems && (
          <div className="fade-in">
            <StemPlayer stems={stems} apiBase={API} onAnalyserReady={setStemAnalysers} />
          </div>
        )}

        <HistoryPanel
          history={history}
          onSelect={selectHistoryEntry}
          onDelete={deleteHistoryEntry}
          activeId={activeId}
        />
      </div>
    </div>
  );
}