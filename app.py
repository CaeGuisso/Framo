import json
import re
import subprocess
import uuid
import zipfile
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

BASE = Path(__file__).parent
UPLOADS = BASE / "uploads"
EXPORTS = BASE / "exports"
UPLOADS.mkdir(exist_ok=True)
EXPORTS.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024**3  # limite de 4 GB por upload

ID_RE = re.compile(r"^[a-f0-9]{32}$")
EXPORT_RE = re.compile(r"^[a-f0-9]{32}\.(mp4|zip)$")
SIZES = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


def find_upload(media_id):
    """Acha o arquivo enviado pelo id. Valida o id para ninguém acessar outras pastas."""
    if not ID_RE.match(media_id):
        return None
    return next(UPLOADS.glob(media_id + ".*"), None)


def probe(path):
    """Usa o ffprobe para ler largura, altura e duração do vídeo."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    s = data["streams"][0]
    return {"width": s["width"], "height": s["height"],
            "duration": float(data["format"]["duration"])}


# ---------- Páginas do front-end (só estes 3 arquivos ficam públicos) ----------
@app.get("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.get("/<name>")
def static_files(name):
    if name not in ("style.css", "script.js"):
        abort(404)
    return send_from_directory(BASE, name)


# ---------- API ----------
@app.post("/api/upload")
def upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="Nenhum arquivo enviado."), 400
    media_id = uuid.uuid4().hex
    ext = Path(f.filename).suffix.lower() or ".mp4"
    path = UPLOADS / (media_id + ext)
    f.save(path)
    try:
        info = probe(path)
    except (subprocess.CalledProcessError, KeyError, IndexError):
        path.unlink(missing_ok=True)
        return jsonify(error="Arquivo de vídeo inválido."), 400
    return jsonify(id=media_id, name=f.filename, **info)


@app.post("/api/cut")
def cut():
    d = request.get_json(silent=True) or {}
    src = find_upload(str(d.get("id", "")))
    if not src:
        return jsonify(error="Vídeo não encontrado no servidor."), 404
    try:
        start, end = float(d["start"]), float(d["end"])
    except (KeyError, TypeError, ValueError):
        return jsonify(error="Intervalo inválido."), 400
    if not 0 <= start < end:
        return jsonify(error="O fim precisa ser depois do início."), 400
    fmt = d.get("format", "9:16")
    if fmt not in SIZES:
        return jsonify(error="Formato desconhecido."), 400

    q = 720 if d.get("quality") == 720 else 1080
    fps = d.get("fps") if d.get("fps") in (24, 30, 60) else 30
    w, h = (int(v * q / 1080) for v in SIZES[fmt])
    ratio = SIZES[fmt][0] / SIZES[fmt][1]
    # Corta o centro do vídeo na proporção pedida e depois ajusta a resolução.
    vf = (f"crop=w='if(gt(a,{ratio}),ih*{ratio},iw)':"
          f"h='if(gt(a,{ratio}),ih,iw/{ratio})',"
          f"scale={w}:{h},setsar=1,fps={fps}")

    out_name = uuid.uuid4().hex + ".mp4"
    cmd = ["ffmpeg", "-y", "-ss", str(start), "-i", str(src),
           "-t", str(end - start), "-vf", vf,
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
           str(EXPORTS / out_name)]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        app.logger.error(res.stderr[-800:])
        return jsonify(error="O FFmpeg não conseguiu gerar o corte."), 500
    return jsonify(url=f"/api/download/{out_name}", file=out_name)


def safe_name(s):
    return re.sub(r"[^\w\- ]", "", str(s or ""))[:60].strip() or "framo-corte"


@app.post("/api/zip")
def zip_cuts():
    items = (request.get_json(silent=True) or {}).get("items", [])
    if not items or len(items) > 60:
        return jsonify(error="Nada para compactar."), 400
    out_name = uuid.uuid4().hex + ".zip"
    with zipfile.ZipFile(EXPORTS / out_name, "w") as z:
        for i, it in enumerate(items, 1):
            f = str(it.get("file", ""))
            if f.endswith(".mp4") and EXPORT_RE.match(f) and (EXPORTS / f).exists():
                z.write(EXPORTS / f, f"{i:02d} - {safe_name(it.get('name'))}.mp4")
    return jsonify(url=f"/api/download/{out_name}?as=framo-cortes")


@app.get("/api/download/<name>")
def download(name):
    if not EXPORT_RE.match(name):
        abort(404)
    return send_from_directory(EXPORTS, name, as_attachment=True,
                               download_name=safe_name(request.args.get("as")) + Path(name).suffix)


if __name__ == "__main__":
    app.run(debug=True)