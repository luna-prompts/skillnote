"""Tests for the cleanup functions in skillnote-pick.

Covers issue #27: shutil.rmtree raises OSError when called on a symlink-to-dir.
The check has existed in CPython since at least 3.3 (bug #1669) — not new in
3.14 as the reporter assumed — but the bug surfaces because skillnote-pick
calls rmtree() on any entry that os.path.isdir() reports True for, which
includes symlinks (since isdir follows them).
"""
import importlib.util
import json
import os
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

import pytest


def _fresh_module(project_dir: Path, home_dir: Path):
    """Reload skillnote-pick with PROJECT_DIR/HOME pointed at temp dirs.

    Module-level constants (PROJECT_DIR, CONFIG_PATH) are evaluated at import
    time, so we set the env vars before loading and import a fresh copy each
    time to avoid cross-test pollution.
    """
    os.environ["CLAUDE_PROJECT_DIR"] = str(project_dir)
    os.environ["HOME"] = str(home_dir)
    path = Path(__file__).resolve().parents[1] / "bin" / "skillnote-pick"
    loader = SourceFileLoader("skillnote_pick_clean", str(path))
    spec = importlib.util.spec_from_file_location(
        "skillnote_pick_clean", path, loader=loader
    )
    m = importlib.util.module_from_spec(spec)
    sys.modules["skillnote_pick_clean"] = m
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def env(tmp_path, monkeypatch):
    project = tmp_path / "project"
    home = tmp_path / "home"
    project.mkdir()
    home.mkdir()
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(project))
    monkeypatch.setenv("HOME", str(home))
    m = _fresh_module(project, home)
    return m, project, home


def _make_layout(skills_dir: Path, *, with_symlink_target: Path):
    """Build a skills dir containing every entry kind the cleanup must handle."""
    skills_dir.mkdir(parents=True, exist_ok=True)

    # (a) regular skill directory — should be removed
    real = skills_dir / "skillnote-real"
    real.mkdir()
    (real / "SKILL.md").write_text("# real")

    # (b) symlink to an external directory — must NOT be removed and target
    #     contents must remain intact
    target = with_symlink_target
    target.mkdir(parents=True, exist_ok=True)
    (target / "preserved.txt").write_text("do not delete me")
    link = skills_dir / "skillnote-linked"
    os.symlink(target, link)

    # (c) dangling symlink — must be tolerated, not crash
    dangling = skills_dir / "skillnote-dangling"
    os.symlink(skills_dir / "does-not-exist", dangling)

    # (d) manifest .json file — should be removed by global cleanup
    (skills_dir / ".skillnote-manifest.json").write_text("{}")

    # (e) unrelated dir without skillnote- prefix — global cleanup should
    #     leave it alone (only project cleanup wipes everything)
    other = skills_dir / "user-skill"
    other.mkdir()
    (other / "SKILL.md").write_text("# user")

    return {"real": real, "link": link, "target": target,
            "dangling": dangling, "other": other}


# ---------- _clean_skills_dir (project-level loop) ----------

def test_clean_skills_dir_project_skips_symlinks(env, tmp_path):
    m, project, _home = env
    skills = project / ".claude" / "skills"
    target = tmp_path / "external-target"
    layout = _make_layout(skills, with_symlink_target=target)

    m._clean_skills_dir()

    # The symlink itself must remain (or at minimum be unlinked, but never
    # rmtree'd). The target's contents must always be intact.
    assert (target / "preserved.txt").exists(), \
        "rmtree followed the symlink and deleted the external target's contents"
    assert not layout["real"].exists(), "regular skill dir should be removed"


def test_clean_skills_dir_project_removes_only_skillnote_owned(env, tmp_path):
    """After fix: only skillnote-* dirs and .skillnote-manifest.json removed.
    Foreign .json files and non-prefixed dirs must be preserved.
    """
    m, project, _home = env
    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    (skills / "skillnote-foo").mkdir()
    (skills / ".skillnote-manifest.json").write_text("{}")
    (skills / "config.json").write_text("{}")  # foreign — must survive
    (skills / "keep-me.txt").write_text("foreign — must survive")

    m._clean_skills_dir()

    assert not (skills / "skillnote-foo").exists()
    assert not (skills / ".skillnote-manifest.json").exists()
    assert (skills / "config.json").exists(), \
        "non-skillnote .json files must be preserved"
    assert (skills / "keep-me.txt").exists(), \
        "non-skillnote files must be preserved"


def test_clean_skills_dir_project_does_not_raise_on_symlink(env, tmp_path):
    """Regression test for #27: must not raise OSError."""
    m, project, _home = env
    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    target = tmp_path / "ext"
    target.mkdir()
    os.symlink(target, skills / "wiki-update")

    # Should not raise — current code raises OSError
    m._clean_skills_dir()


# ---------- _clean_skills_dir (global skillnote-* loop) ----------

def test_clean_skills_dir_global_skips_symlinks(env, tmp_path):
    m, project, home = env
    gsd = home / ".claude" / "skills"
    target = tmp_path / "ext-global"
    _make_layout(gsd, with_symlink_target=target)

    m._clean_skills_dir()

    assert (target / "preserved.txt").exists(), \
        "global cleanup followed symlink and clobbered external target"
    assert (gsd / "user-skill").exists(), \
        "global cleanup must only touch skillnote-* prefixed entries"


# ---------- _clean_stale_global_skills (runs on every startup) ----------

def test_clean_stale_global_skills_skips_symlinks(env, tmp_path):
    m, _project, home = env
    gsd = home / ".claude" / "skills"
    target = tmp_path / "ext-stale"
    _make_layout(gsd, with_symlink_target=target)

    # Should not raise and must not touch the symlink target
    m._clean_stale_global_skills()

    assert (target / "preserved.txt").exists()
    assert (gsd / "user-skill").exists(), \
        "non-skillnote- entries must be left untouched"


def test_clean_stale_global_skills_removes_real_skillnote_dirs(env):
    m, _project, home = env
    gsd = home / ".claude" / "skills"
    gsd.mkdir(parents=True)
    (gsd / "skillnote-foo").mkdir()
    (gsd / "skillnote-bar").mkdir()
    (gsd / ".skillnote-manifest.json").write_text("{}")

    m._clean_stale_global_skills()

    assert not (gsd / "skillnote-foo").exists()
    assert not (gsd / "skillnote-bar").exists()
    assert not (gsd / ".skillnote-manifest.json").exists()


# ---------- _clean_orphan_project_skills (silently swallows; verify behavior) ----------

# ---------- Adversarial cases ----------

def test_project_cleanup_wipes_user_authored_skills(env):
    """Bug: _clean_skills_dir's project loop has no skillnote- prefix filter.

    The global loop (line 369) correctly filters with `if e.startswith("skillnote-")`,
    but the project loop (line 359) wipes EVERY directory under
    .claude/skills/. Hand-written skills, skills from other tools, or anything
    a user puts there is silently destroyed on every collection switch.
    """
    m, project, _home = env
    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    user_skill = skills / "my-handwritten-skill"
    user_skill.mkdir()
    (user_skill / "SKILL.md").write_text("# my own work")
    other_tool = skills / "cursor-managed-thing"
    other_tool.mkdir()
    (other_tool / "data").write_text("important")
    skillnote_managed = skills / "skillnote-foo"
    skillnote_managed.mkdir()

    m._clean_skills_dir()

    assert (user_skill / "SKILL.md").exists(), \
        "BUG: user's hand-written skill was deleted by collection switch"
    assert (other_tool / "data").exists(), \
        "BUG: another tool's skill was deleted by collection switch"
    assert not skillnote_managed.exists(), "skillnote-managed dir should be removed"


def test_dangling_symlink_does_not_crash(env, tmp_path):
    """Dangling symlink (target removed) must not crash any cleanup function."""
    m, project, home = env
    project_skills = project / ".claude" / "skills"
    global_skills = home / ".claude" / "skills"
    project_skills.mkdir(parents=True)
    global_skills.mkdir(parents=True)
    nowhere = tmp_path / "vanished"  # never created
    os.symlink(nowhere, project_skills / "skillnote-dangling")
    os.symlink(nowhere, global_skills / "skillnote-dangling")

    m._clean_skills_dir()
    m._clean_stale_global_skills()


def test_symlink_loop_does_not_hang(env, tmp_path):
    """Symlink loop (a → b → a) must not cause infinite recursion."""
    m, project, _home = env
    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    a = skills / "skillnote-a"
    b = skills / "skillnote-b"
    os.symlink(b, a)
    os.symlink(a, b)

    m._clean_skills_dir()  # must return promptly


def test_symlink_pointing_into_cleanup_root(env, tmp_path):
    """Symlink whose target is the cleanup directory itself.

    rmtree following this would walk recursively into the very dir being cleaned.
    """
    m, project, _home = env
    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    real = skills / "skillnote-real"
    real.mkdir()
    (real / "important.md").write_text("don't lose me")
    # Symlink pointing at the parent skills dir
    os.symlink(skills, skills / "skillnote-self")

    m._clean_skills_dir()
    # The 'real' dir gets removed (it's a managed directory) — that's fine.
    # The point is: no crash, no infinite walk.


def test_file_masquerading_as_skillnote_dir(env):
    """A regular file named 'skillnote-foo' must not crash global cleanup."""
    m, _project, home = env
    gsd = home / ".claude" / "skills"
    gsd.mkdir(parents=True)
    (gsd / "skillnote-fake").write_text("I am a file, not a directory")

    m._clean_stale_global_skills()  # must not crash; file is left alone


def test_broken_config_does_not_crash_orphan_cleanup(env, tmp_path, monkeypatch):
    """Broken JSON in .skillnote.json must not crash the orphan cleanup."""
    m, project, _home = env
    (project / ".skillnote.json").write_text("{not valid json")

    # Should swallow JSONDecodeError and return cleanly
    m._clean_orphan_project_skills()


def test_project_dir_is_symlink(env, tmp_path):
    """If .claude/skills/ itself is a symlink, the cleanup code's behavior
    should be predictable: either skip entirely or operate on the target.

    Currently os.path.isdir() follows the symlink, so listdir() lists the
    target's contents — meaning we'd start nuking entries inside whatever
    .claude/skills points to. Test documents this risk.
    """
    m, project, _home = env
    real_skills = tmp_path / "real-skills"
    real_skills.mkdir()
    (real_skills / "SKILL.md").write_text("not even a skill dir, just a file")
    (project / ".claude").mkdir()
    os.symlink(real_skills, project / ".claude" / "skills")

    # Cleanup walks the symlinked dir. The .json file gets deleted (matches
    # the .json branch). Document the behavior so we notice if it changes.
    m._clean_skills_dir()


def test_clean_orphan_project_skills_skips_symlinks(env, tmp_path, monkeypatch):
    m, project, _home = env
    # Write a config so the function proceeds past the early return
    (project / ".skillnote.json").write_text(
        json.dumps({"collections": ["frontend"]})
    )

    # Stub the API call so the function thinks "skillnote-keep" is expected
    import urllib.request
    fake_payload = json.dumps([{"slug": "keep"}]).encode()

    class _Resp:
        def read(self):
            return fake_payload

    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **kw: _Resp())

    skills = project / ".claude" / "skills"
    skills.mkdir(parents=True)
    target = tmp_path / "ext-orphan"
    target.mkdir()
    (target / "preserved.txt").write_text("do not delete")
    # Orphan symlink (not in expected set, has skillnote- prefix → would be
    # rmtree'd by current code)
    os.symlink(target, skills / "skillnote-orphan-symlink")
    # Orphan real dir → should be removed
    (skills / "skillnote-orphan-real").mkdir()
    # Expected dir → should be kept
    (skills / "skillnote-keep").mkdir()

    m._clean_orphan_project_skills()

    assert (target / "preserved.txt").exists(), \
        "orphan symlink should not have its target wiped"
    assert not (skills / "skillnote-orphan-real").exists(), \
        "orphan real dir should be removed"
    assert (skills / "skillnote-keep").exists(), \
        "expected skill must be preserved"
