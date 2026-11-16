"""Reframe 16:9 → 9:16 by following faces per shot (OpenCV YuNet), with a blur-pad fallback."""

from __future__ import annotations

import statistics
import urllib.request
from pathlib import Path

from . import ffmpeg, scenes
from .config import settings

YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
    "face_detection_yunet_2023mar.onnx"
)
SAMPLE_EVERY_S = 0.5
MIN_FACE_COVERAGE = 0.3  # below this fraction of sampled frames with a face → blur layout


def _model_path() -> Path:
    path = settings.models_dir / "face_detection_yunet_2023mar.onnx"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(YUNET_URL, path)
    return path


def face_centers(video: Path, shots: list[tuple[float, float]]) -> tuple[list[float | None], float]:
    """Median face-center x (pixels) per shot, and overall face coverage ratio."""
    import cv2

    cap = cv2.VideoCapture(str(video))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    # Detect on a downscaled frame for speed.
    scale = 640 / w if w > 640 else 1.0
    dw, dh = int(w * scale), int(h * scale)
    detector = cv2.FaceDetectorYN.create(str(_model_path()), "", (dw, dh), score_threshold=0.7)

    centers: list[float | None] = []
    sampled = hits = 0
    for start, end in shots:
        xs = []
        t = start + min(0.1, (end - start) / 2)
        while t < end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, frame = cap.read()
            t += SAMPLE_EVERY_S
            if not ok:
                continue
            sampled += 1
            _, faces = detector.detect(cv2.resize(frame, (dw, dh)))
            if faces is None or len(faces) == 0:
                continue
            hits += 1
            # Largest face = most likely the active speaker.
            x, _, fw, _ = max(faces, key=lambda f: f[2] * f[3])[:4]
            xs.append((x + fw / 2) / scale)
        centers.append(statistics.median(xs) if xs else None)
    cap.release()
    return centers, (hits / sampled if sampled else 0.0)


def _crop_filter(w: int, h: int, shots: list[tuple[float, float]], centers: list[float | None]) -> str:
    out_w, out_h = settings.width, settings.height
    cw = int(h * out_w / out_h) // 2 * 2
    # Fill missing shots from neighbours, else frame center.
    filled: list[float] = []
    last = None
    for c in centers:
        last = c if c is not None else last
        filled.append(last if last is not None else w / 2)
    xs = [int(min(max(c - cw / 2, 0), w - cw)) for c in filled]

    # Nested if() over shot end times: if(lt(t,end0),x0,if(lt(t,end1),x1,...))
    expr = str(xs[-1])
    for (_, end), x in reversed(list(zip(shots[:-1], xs[:-1]))):
        expr = f"if(lt(t\\,{end:.3f})\\,{x}\\,{expr})"
    return f"[0:v]crop=w={cw}:h={h}:x='{expr}':y=0,scale={out_w}:{out_h},setsar=1[out]"


def _blur_filter() -> str:
    W, H = settings.width, settings.height
    return (
        f"[0:v]split[a][b];"
        f"[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=25:5[bg];"
        f"[b]scale={W}:-2[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[out]"
    )


def reframe(src: Path, dst: Path, work: Path) -> str:
    """Returns the layout used: 'face' | 'blur' | 'fill'."""
    w, h = ffmpeg.video_size(src)
    if w / h <= settings.width / settings.height + 0.01:
        # Already vertical: just fit to 1080x1920.
        W, H = settings.width, settings.height
        ffmpeg.crop_vertical(
            src, dst,
            f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[out]",
            settings.fps,
        )
        return "fill"

    duration = ffmpeg.duration(src)
    shot_list = scenes.scenes_within(scenes.detect(src, work / "clip_scenes.json"), 0.0, duration)
    centers, coverage = face_centers(src, shot_list)
    if coverage < MIN_FACE_COVERAGE:
        ffmpeg.crop_vertical(src, dst, _blur_filter(), settings.fps)
        return "blur"
    ffmpeg.crop_vertical(src, dst, _crop_filter(w, h, shot_list, centers), settings.fps)
    return "face"
