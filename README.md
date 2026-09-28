# Resona

Local stem splitter. demucs does the heavy lifting, FastAPI wraps it, React plays it back.

## Run backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
First run downloads the demucs model (~/.cache/torch) — do this once with network on.

## Run frontend
```bash
cd frontend
npm install
npm run dev
```

## Notes
- 4-stem model (`htdemucs`) is the default in `jobs.py`. Swap to `htdemucs_6s` for piano/guitar stems too — just change the `cmd` list.
- CPU inference: expect ~1-2 min/song. Progress % comes from parsing demucs' own tqdm output, not a fake timer.
- YouTube path needs `yt-dlp` on PATH (pip install already gets you the binary via the `yt-dlp` package).
- Player never uses `<audio>` tags — one `AudioContext`, per-stem `GainNode`s, `ctx.suspend()/resume()` for pause so nothing drifts.
