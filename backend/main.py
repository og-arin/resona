import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from jobs import JOBS, start_separation_job, start_link_job

BASE = Path(__file__).parent
UPLOADS = BASE / "uploads"
SEPARATED = BASE / "separated"
UPLOADS.mkdir(exist_ok=True)
SEPARATED.mkdir(exist_ok=True)

app = FastAPI(title="Resona")

# comma-separated list, e.g. "https://resona.vercel.app,http://localhost:5173"
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# stems served as static files -> /stems/<model>/<track>/<stem>.wav
app.mount("/stems", StaticFiles(directory=SEPARATED), name="stems")


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".mp3"
    dest = UPLOADS / f"{job_id}{ext}"

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    JOBS[job_id] = {"status": "queued", "progress": 0, "stems": None, "error": None}
    start_separation_job(job_id, dest, SEPARATED)
    return {"job_id": job_id}


@app.post("/upload-link")
async def upload_link(url: str):
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "queued", "progress": 0, "stems": None, "error": None}
    start_link_job(job_id, url, UPLOADS, SEPARATED)
    return {"job_id": job_id}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job_id")
    return job