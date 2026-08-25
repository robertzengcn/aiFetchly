import { expect } from "chai";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = path.resolve(
  __dirname,
  "../../scripts/generate-release-checksums.js"
);

function hash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function runChecksumScript(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("generate-release-checksums", (): void => {
  let tempRoot: string;

  beforeEach((): void => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "aifetchly-checksums-"));
  });

  afterEach((): void => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("writes GNU-style SHA-256 lines for Windows and macOS packages", (): void => {
    const windowsDir = path.join(tempRoot, "windows");
    const macosDir = path.join(tempRoot, "macos");
    mkdirSync(windowsDir, { recursive: true });
    mkdirSync(macosDir, { recursive: true });

    const exeContents = "windows-exe";
    const msiContents = "windows-msi";
    const dmgContents = "macos-dmg";
    const zipContents = "macos-zip";
    writeFileSync(path.join(windowsDir, "AiFetchlySetup.exe"), exeContents);
    writeFileSync(path.join(windowsDir, "AiFetchly.msi"), msiContents);
    writeFileSync(path.join(macosDir, "AiFetchly.dmg"), dmgContents);
    writeFileSync(path.join(macosDir, "AiFetchly.zip"), zipContents);
    writeFileSync(path.join(tempRoot, "SHA256SUMS-old.txt"), "stale");

    const output = path.join(tempRoot, "SHA256SUMS.txt");
    const notes = path.join(tempRoot, "notes.md");
    const result = runChecksumScript([
      "--root",
      tempRoot,
      "--output",
      output,
      "--notes-file",
      notes,
      "--title",
      "AiFetchly 1.0.99",
      "--preamble",
      "Draft release built from a push to master.",
    ]);

    expect(result.status, result.stderr).to.equal(0);

    const checksumText = readFileSync(output, "utf8");
    expect(checksumText).to.equal(
      [
        `${hash(dmgContents)}  AiFetchly.dmg`,
        `${hash(msiContents)}  AiFetchly.msi`,
        `${hash(zipContents)}  AiFetchly.zip`,
        `${hash(exeContents)}  AiFetchlySetup.exe`,
        "",
      ].join("\n")
    );
    expect(checksumText).to.not.include("SHA256SUMS");

    const notesText = readFileSync(notes, "utf8");
    expect(notesText).to.include("# AiFetchly 1.0.99");
    expect(notesText).to.include(
      "Draft release built from a push to master."
    );
    expect(notesText).to.include("## SHA-256 checksums");
    expect(notesText).to.include("`AiFetchlySetup.exe`");
    expect(notesText).to.include(`\`${hash(exeContents)}\``);
    expect(notesText).to.include("`AiFetchly.dmg`");
    expect(notesText).to.include(`\`${hash(dmgContents)}\``);
  });

  it("fails when the asset directory is empty", (): void => {
    const output = path.join(tempRoot, "SHA256SUMS.txt");
    const result = runChecksumScript(["--root", tempRoot, "--output", output]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include("No hashable release assets found");
  });

  it("fails when two assets share a basename", (): void => {
    mkdirSync(path.join(tempRoot, "a"), { recursive: true });
    mkdirSync(path.join(tempRoot, "b"), { recursive: true });
    writeFileSync(path.join(tempRoot, "a", "Setup.exe"), "one");
    writeFileSync(path.join(tempRoot, "b", "Setup.exe"), "two");

    const result = runChecksumScript([
      "--root",
      tempRoot,
      "--output",
      path.join(tempRoot, "SHA256SUMS.txt"),
    ]);
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('Duplicate release asset basename "Setup.exe"');
  });
});
