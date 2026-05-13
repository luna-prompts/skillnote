# typed: false
# frozen_string_literal: true

# Canonical Homebrew formula for SkillNote.
#
# This file lives in the SkillNote repo as the source of truth. On every
# `cli-v*` tag push, .github/workflows/homebrew-tap.yml mirrors it (with
# the version + sha256 bumped to match the new release) to the
# luna-prompts/homebrew-tap repository, where Homebrew actually reads it
# from when users run `brew install luna-prompts/tap/skillnote`.
#
# DO NOT manually edit the version or sha256 here for a release — the
# workflow does that on its own when the tag lands.
class Skillnote < Formula
  desc "Self-hosted skill registry for AI coding agents"
  homepage "https://github.com/luna-prompts/skillnote"
  url "https://registry.npmjs.org/skillnote/-/skillnote-0.5.3.tgz"
  sha256 "7970caff091bf92843c388af0017c302d47e08d16b234e85ccffa329a35e19db"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    # `skillnote --version` is a pure-Node command — no Docker required —
    # so this works in Homebrew's sandboxed test environment.
    assert_match version.to_s, shell_output("#{bin}/skillnote --version")
  end
end
