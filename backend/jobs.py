import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

JOBS: dict[str, dict] = {}
EXECUTOR = ThreadPoolExecutor(max_workers=2)  # cap concurrent demucs runs, CPU-bound

MODEL = "htdemucs_6s"  # 6-stem: vocals, drums, bass, guitar, piano, other

# demucs prints lines like: " 87%|########  | 174.2/200.0 [00:42<00:06, 4.1s/it]"
PROGRESS_RE = re.compile(r"(\d{1,3})%\|")


def start_separation_job(job_id: str, src_path: Path, out_dir: Path):
    EXECUTOR.submit(_run_demucs, job_id, src_path, out_dir)


def start_link_job(job_id: str, url: str, upload_dir: Path, out_dir: Path):
    EXECUTOR.submit(_download_then_run, job_id, url, upload_dir, out_dir)


def _download_then_run(job_id: str, url: str, upload_dir: Path, out_dir: Path):
    JOBS[job_id]["status"] = "downloading"

    if "spotify.com" in url:
        JOBS[job_id].update(
            status="error",
            error="Spotify links aren't supported — paste a YouTube link for this song instead.",
        )
        return

    dest_template = str(upload_dir / f"{job_id}.%(ext)s")
    try:
        subprocess.run(
            ["yt-dlp", "-x", "--audio-format", "wav", "-o", dest_template, url],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as e:
        JOBS[job_id].update(status="error", error=f"yt-dlp failed: {e.stderr[-500:]}")
        return
    except FileNotFoundError:
        JOBS[job_id].update(status="error", error="yt-dlp not installed")
        return

    downloaded = next(upload_dir.glob(f"{job_id}.*"), None)
    if not downloaded:
        JOBS[job_id].update(status="error", error="yt-dlp produced no file")
        return

    _run_demucs(job_id, downloaded, out_dir)


def _run_demucs(job_id: str, src_path: Path, out_dir: Path):
    JOBS[job_id]["status"] = "processing"
    cmd = [
        "demucs", "-n", MODEL, "-o", str(out_dir), "--filename", "{track}/{stem}.{ext}",
        "--shifts", "1", "--overlap", "0.5", "--float32",
        str(src_path),
    ]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )

    tail = []
    for line in proc.stdout:
        print(f"[demucs {job_id[:8]}] {line}", end="")
        tail.append(line)
        tail = tail[-50:]
        match = PROGRESS_RE.search(line)
        if match:
            JOBS[job_id]["progress"] = int(match.group(1))

    proc.wait()

    if proc.returncode != 0:
        JOBS[job_id].update(status="error", error="".join(tail)[-2000:])
        return

    track_name = src_path.stem
    stem_dir = out_dir / MODEL / track_name

    stems = {f.stem: f"/stems/{MODEL}/{track_name}/{f.name}" for f in stem_dir.glob("*.wav")}
    JOBS[job_id].update(status="done", progress=100, stems=stems)