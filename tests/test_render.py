from clipper.render import to_captions
from clipper.sources import PermissionError_, Source, check_permission
from clipper.upload import build_description

import pytest


def test_to_captions_adds_leading_space_and_ms():
    caps = to_captions([{"word": "Hello", "start": 0.5, "end": 0.9, "score": 0.9}, {"word": " ", "start": 1, "end": 1}])
    assert caps == [{"text": " Hello", "startMs": 500, "endMs": 900, "timestampMs": 500, "confidence": 0.9}]


def test_permission_gate():
    check_permission(Source(id="a", owner="us", permission="own", path="x.mp4"))
    with pytest.raises(PermissionError_):
        check_permission(Source(id="b", owner="them", permission="none", url="u"))
    with pytest.raises(PermissionError_):
        check_permission(Source(id="c", owner="them", permission="granted", url="u"))  # no proof/credit


def test_description_has_shorts_tag_and_credit():
    d = build_description("Great moment.", "@creator", ["money tips", "finance"])
    assert "#Shorts" in d and "Original: @creator" in d and "#moneytips" in d
