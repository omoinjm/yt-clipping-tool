from clipper.select import format_transcript, overlap, postprocess, snap


def _transcript():
    # 10 sentences, 6s each, words 1s apart; each sentence ends with "."
    segs = []
    for i in range(10):
        start = i * 6.0
        words = [{"word": f"w{j}", "start": start + j, "end": start + j + 0.8} for j in range(6)]
        words[-1]["word"] += "."
        segs.append({"start": start, "end": start + 5.8, "text": " ".join(w["word"] for w in words), "words": words})
    return {"language": "en", "segments": segs}


def test_snap_moves_edges_to_sentence_bounds():
    out = snap({"start": 6.9, "end": 34.5}, _transcript(), cuts=[], min_s=10, max_s=60)
    assert out["start"] == 6.0
    assert out["end"] == 35.8


def test_snap_prefers_scene_cut_just_before_start():
    out = snap({"start": 12.2, "end": 40.0}, _transcript(), cuts=[11.8], min_s=10, max_s=60)
    assert out["start"] == 11.8


def test_snap_trims_too_long_clip_to_last_fitting_sentence():
    out = snap({"start": 0.0, "end": 59.8}, _transcript(), cuts=[], min_s=10, max_s=30)
    assert out["end"] - out["start"] <= 30
    assert out["end"] == 29.8


def test_snap_rejects_too_short():
    assert snap({"start": 0.0, "end": 5.8}, _transcript(), cuts=[], min_s=10, max_s=60) is None


def test_postprocess_dedupes_overlaps_and_respects_n():
    cands = [
        {"start": 0.0, "end": 23.8, "score": 90},
        {"start": 6.0, "end": 29.8, "score": 80},   # overlaps first heavily
        {"start": 30.0, "end": 53.8, "score": 70},
        {"start": 500.0, "end": 530.0, "score": 99},  # outside video
    ]
    kept = postprocess(cands, _transcript(), [], duration=60, n=5, min_s=10, max_s=60)
    assert [c["score"] for c in kept] == [90, 70]


def test_overlap_ratio():
    assert overlap({"start": 0, "end": 10}, {"start": 5, "end": 20}) == 0.5


def test_format_transcript_includes_speaker():
    t = {"segments": [{"start": 1.0, "end": 2.0, "text": "hi", "speaker": "SPEAKER_00", "words": []}]}
    assert format_transcript(t) == "[1.0-2.0] SPEAKER_00: hi"
