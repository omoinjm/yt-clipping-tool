"""WhisperX transcription with word-level alignment (and optional diarization)."""

from __future__ import annotations

import gc
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import settings


def _device() -> str:
    if settings.whisper_device != "auto":
        return settings.whisper_device
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def _compute_type(device: str) -> str:
    if settings.whisper_compute_type:
        return settings.whisper_compute_type
    return "float16" if device == "cuda" else "int8"


@lru_cache(maxsize=1)
def _asr_model():
    import whisperx

    device = _device()
    return whisperx.load_model(
        settings.whisper_model,
        device,
        compute_type=_compute_type(device),
        language=settings.language,
    )


@lru_cache(maxsize=2)
def _align_model(language: str):
    import whisperx

    return whisperx.load_align_model(language_code=language, device=_device())


def _fill_missing_word_times(segments: list[dict[str, Any]]) -> None:
    """wav2vec2 can't align some tokens (digits, symbols); interpolate them from neighbours."""
    for seg in segments:
        words = seg.get("words", [])
        for i, w in enumerate(words):
            if "start" in w and "end" in w:
                continue
            prev_end = next((words[j]["end"] for j in range(i - 1, -1, -1) if "end" in words[j]), seg["start"])
            next_start = next(
                (words[j]["start"] for j in range(i + 1, len(words)) if "start" in words[j]), seg["end"]
            )
            w["start"], w["end"] = prev_end, max(prev_end, next_start)


def transcribe(
    audio_path: Path, out_path: Path, diarize: bool = False, language: str | None = None
) -> dict[str, Any]:
    import whisperx

    device = _device()
    audio = whisperx.load_audio(str(audio_path))
    result = _asr_model().transcribe(
        audio, batch_size=settings.whisper_batch_size, language=language or settings.language
    )
    language = result["language"]

    align_model, metadata = _align_model(language)
    aligned = whisperx.align(result["segments"], align_model, metadata, audio, device, return_char_alignments=False)

    if diarize:
        if not settings.hf_token:
            raise RuntimeError("diarization needs HF_TOKEN (accept pyannote model terms on Hugging Face)")
        try:
            from whisperx.diarize import DiarizationPipeline
        except ImportError:  # older whisperx
            from whisperx import DiarizationPipeline  # type: ignore[no-redef]
        diarizer = DiarizationPipeline(use_auth_token=settings.hf_token, device=device)
        aligned = whisperx.assign_word_speakers(diarizer(audio), aligned)
        del diarizer

    segments = [
        {
            "start": float(s["start"]),
            "end": float(s["end"]),
            "text": s["text"].strip(),
            "speaker": s.get("speaker"),
            "words": [
                {k: (float(v) if k in ("start", "end", "score") else v) for k, v in w.items()}
                for w in s.get("words", [])
            ],
        }
        for s in aligned["segments"]
    ]
    _fill_missing_word_times(segments)

    data = {"language": language, "segments": segments}
    out_path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    gc.collect()
    return data


def words(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    return [w for s in transcript["segments"] for w in s["words"]]
