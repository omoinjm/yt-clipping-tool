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


from clipper.sources import is_cc_by


def test_cc_by_requires_url_and_credit():
    check_permission(Source(id="d", owner="them", permission="cc_by", url="u", credit="@them"))
    with pytest.raises(PermissionError_):
        check_permission(Source(id="e", owner="them", permission="cc_by", url="u"))  # no credit
    with pytest.raises(PermissionError_):
        check_permission(Source(id="f", owner="them", permission="cc_by", path="x.mp4", credit="@t"))  # no url


@pytest.mark.parametrize("text,ok", [
    ("Creative Commons Attribution license (reuse allowed)", True),
    ("CC BY 4.0", True),
    ("Creative Commons Attribution-NonCommercial 4.0", False),
    ("CC BY-ND 4.0", False),
    (None, False),
    ("Standard YouTube License", False),
])
def test_is_cc_by(text, ok):
    assert is_cc_by(text) is ok
