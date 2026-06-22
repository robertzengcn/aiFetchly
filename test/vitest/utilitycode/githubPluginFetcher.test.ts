import { describe, it, expect } from "vitest";
import { classifyGitHubUrl } from "@/service/pluginSources/GitHubPluginFetcher";

describe("classifyGitHubUrl", () => {
  it("classifies a plain repo URL as 'repo'", () => {
    expect(classifyGitHubUrl("https://github.com/owner/repo")).toEqual({
      type: "repo",
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips a trailing .git from repo URLs", () => {
    expect(classifyGitHubUrl("https://github.com/owner/repo.git")).toEqual({
      type: "repo",
      owner: "owner",
      repo: "repo",
    });
  });

  it("classifies a release asset URL as 'asset'", () => {
    expect(
      classifyGitHubUrl(
        "https://github.com/o/r/releases/download/v1/x.zip"
      )
    ).toEqual({
      type: "asset",
      owner: "o",
      repo: "r",
      tag: "v1",
      asset: "x.zip",
    });
  });

  it("classifies a releases/latest URL as 'latest'", () => {
    expect(classifyGitHubUrl("https://github.com/o/r/releases/latest")).toEqual({
      type: "latest",
      owner: "o",
      repo: "r",
    });
  });

  it("returns unknown for arbitrary URL", () => {
    expect(classifyGitHubUrl("https://example.com/x")).toEqual({
      type: "unknown",
    });
  });

  it("returns unknown for malformed input", () => {
    expect(classifyGitHubUrl("not a url")).toEqual({ type: "unknown" });
  });
});
