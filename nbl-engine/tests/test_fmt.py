from nbl_engine.evidence.fmt import box_rank, ordinal


def test_ordinal():
    assert ordinal(1) == "1st"
    assert ordinal(2) == "2nd"
    assert ordinal(3) == "3rd"
    assert ordinal(4) == "4th"
    assert ordinal(11) == "11th"
    assert ordinal(12) == "12th"
    assert ordinal(13) == "13th"
    assert ordinal(21) == "21st"


def test_box_rank_is_not_hash_notation():
    text = box_rank(1, 10, "PTS allowed")
    assert text == "1st of 10 for PTS allowed (box score, not a shot-chart zone rank)"
    assert "#" not in text


def test_hits_vs_d_text_is_not_an_auto_under():
    from nbl_engine.evidence.builder import _hits_vs_d_text

    text = _hits_vs_d_text("PTS", 1, 1, 2, 3, 0, 0, 3, 8)
    assert "over in 1 of 1 vs the hardest 3" in text
    assert "over in 2 of 3 vs mid-table PTS D" in text
    assert "over in 3 of 4 when the D was not easy" in text
    assert "not an automatic under" in text
    assert "not an automatic over" in text
