"""Unit tests for pure helpers in skillnote-pick."""
import importlib.util
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path


def _load_module():
    path = Path(__file__).resolve().parents[1] / "bin" / "skillnote-pick"
    # skillnote-pick has no .py extension, so pass an explicit loader
    loader = SourceFileLoader("skillnote_pick", str(path))
    spec = importlib.util.spec_from_file_location("skillnote_pick", path, loader=loader)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_slugify_lowercases():
    m = _load_module()
    assert m._slugify("Frontend") == "frontend"


def test_slugify_replaces_spaces():
    m = _load_module()
    assert m._slugify("My App") == "my-app"


def test_slugify_collapses_and_strips():
    m = _load_module()
    assert m._slugify("  --My!!!App-- ") == "my-app"


def test_slugify_returns_empty_for_all_invalid():
    m = _load_module()
    assert m._slugify("!!!") == ""


def test_is_valid_slug():
    m = _load_module()
    assert m._is_valid_slug("frontend") is True
    assert m._is_valid_slug("my-app_2") is True
    assert m._is_valid_slug("My App") is False
    assert m._is_valid_slug("") is False
    assert m._is_valid_slug("claude-stuff") is False  # reserved word


def test_resolve_recommendation_match():
    m = _load_module()
    existing = [("frontend", 5, []), ("backend", 3, [])]
    assert m._resolve_recommendation("Frontend", existing) == ("pick", 0)


def test_resolve_recommendation_create():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("My App", existing) == ("create", "my-app")


def test_resolve_recommendation_none():
    m = _load_module()
    existing = [("frontend", 5, [])]
    assert m._resolve_recommendation("!!!", existing) == ("none", None)


def test_wrap_strips_embedded_newlines():
    """Garrytan-gstack regression: descriptions with literal \\n in them
    were passed straight to curses.addstr(), which moves the cursor to col 0
    and overwrites the adjacent pane. Wrap output must be control-char free.
    """
    m = _load_module()
    desc = "Performance regression detection.\nBaselines for page loads,\nCore Web Vitals."
    out = m._wrap(desc, 40)
    for line in out:
        assert "\n" not in line
        assert "\r" not in line
        assert "\t" not in line
        # No other ASCII control chars either
        assert all(c >= " " for c in line), f"control char in {line!r}"


def test_wrap_handles_carriage_returns_and_tabs():
    m = _load_module()
    out = m._wrap("a\tb\rc\fd\ve", 80)
    assert out == ["a b c d e"]


def test_wrap_collapses_internal_whitespace():
    m = _load_module()
    out = m._wrap("a   b  \n\n  c", 80)
    assert out == ["a b c"]


def test_wrap_caps_at_four_lines():
    m = _load_module()
    long = " ".join(["word"] * 200)
    out = m._wrap(long, 20)
    assert len(out) <= 4


# ---------- _safe_text: defense-in-depth for every text→curses path ----------

def test_safe_text_strips_ansi_csi():
    """ANSI color escapes (\\x1b[31m...) would change the pane's color and
    leak across cells. Strip the ESC; the trailing letters become harmless
    text."""
    m = _load_module()
    out = m._safe_text("\x1b[31mred\x1b[0mnormal")
    assert out == "[31mred[0mnormal"
    assert "\x1b" not in out


def test_safe_text_strips_ansi_osc():
    """Some payloads include OSC sequences ending in BEL (\\x07) that retitle
    the terminal — an ESC + BEL combo would corrupt both color and the
    terminal title bar."""
    m = _load_module()
    out = m._safe_text("\x1b]0;evil-title\x07after")
    assert "\x1b" not in out and "\x07" not in out


def test_safe_text_strips_all_c0_controls():
    m = _load_module()
    # Every byte 0x00-0x1F except none should survive
    for code in range(0x00, 0x20):
        c = chr(code)
        assert c not in m._safe_text(f"a{c}b"), f"control 0x{code:02x} leaked through"


def test_safe_text_strips_del_byte():
    m = _load_module()
    assert "\x7f" not in m._safe_text("a\x7fb")


def test_safe_text_preserves_box_drawing_and_emoji():
    m = _load_module()
    box = "╭─┤├╯╰│"
    emoji = "✦ × ❯ ↵"
    assert m._safe_text(box) == box
    assert m._safe_text(emoji) == emoji
    assert m._safe_text("ñöü 中文 한글") == "ñöü 中文 한글"


def test_safe_text_handles_none_and_non_str():
    m = _load_module()
    assert m._safe_text(None) == ""
    assert m._safe_text(42) == "42"
    # bytes path: str(bytes) gives "b'...'" — at minimum no crash
    out = m._safe_text(b"hello")
    assert isinstance(out, str)


def test_safe_text_real_world_corruption_examples():
    """Concrete payloads observed (or plausibly observable) in skill data."""
    m = _load_module()
    # YAML literal-block description that landed via | preservation
    out = m._safe_text("Performance regression detection.\nBaselines for page loads.\rMore.")
    assert "\n" not in out and "\r" not in out
    # Description copied from a terminal session retaining ANSI
    out = m._safe_text("Use \x1b[1mbold\x1b[0m carefully")
    assert "\x1b" not in out
    # NULs from a corrupted upload
    out = m._safe_text("hello\x00world\x00")
    assert "\x00" not in out
    # All-control input degrades to empty rather than crashing
    out = m._safe_text("\x00\x01\x02\x03\x07\x08\x0b\x0c\x1b\x7f")
    assert out == ""


def test_safe_text_then_truncate_does_not_re_introduce_controls():
    """Combination test: sanitize then slice (mimicking what s() does)."""
    m = _load_module()
    payload = "valid\x1bbad" + "x" * 100
    sanitized = m._safe_text(payload)
    truncated = sanitized[:20]
    assert "\x1b" not in truncated
    assert "\n" not in truncated


def test_wrap_input_with_ansi_escapes_does_not_leak():
    """Even though _safe_text catches it at the s() layer, _wrap also runs
    earlier in the pipeline. ANSI sequences in descriptions must not survive
    through _wrap into addstr."""
    m = _load_module()
    out = m._wrap("normal \x1b[31mred\x1b[0m text", 80)
    for line in out:
        assert "\x1b" not in line
        assert all(c >= " " for c in line)


def test_wrap_strips_del_byte():
    m = _load_module()
    out = m._wrap("x\x7fy\x7fz", 80)
    for line in out:
        assert "\x7f" not in line


def test_wrap_full_adversarial_battery():
    """Run every common terminal-corruption payload through _wrap and assert
    the output is render-safe (no C0 control + no DEL)."""
    m = _load_module()
    payloads = [
        "Innocent\x1b[31m TURNS RED \x1b[0m text",      # ANSI color
        "before\x1b[2A overwrites lines",                # ANSI cursor
        "\x1b[2J wipes terminal",                        # ANSI clear screen
        "\x1b]0;PWNED\x07normal",                        # OSC title
        "line1\nline2\nline3",                           # newlines
        "good\rEVIL",                                    # CR overwrite
        "\x07\x07ding",                                  # BEL
        "real\b\bfake",                                  # backspace
        "a\x0bb\x0cc",                                   # VT + FF
        "before\x00after",                               # NUL
        "x\x7fy",                                        # DEL
        "\x1b[1;31m\x07\x00\nmixed\rattack\x7f",         # combo
    ]
    for p in payloads:
        for line in m._wrap(p, 80):
            assert all(c >= " " and c != "\x7f" for c in line), \
                f"_wrap leaked control chars from {p!r}: {line!r}"
