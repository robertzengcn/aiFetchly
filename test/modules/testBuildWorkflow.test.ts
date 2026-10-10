import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

interface WorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface WorkflowJob {
  steps?: WorkflowStep[];
}

interface BuildWorkflow {
  jobs?: Record<string, WorkflowJob>;
}

const projectRoot = path.resolve(__dirname, "../..");
const workflowPath = path.join(
  projectRoot,
  ".github",
  "workflows",
  "build.yml"
);

function readMacosJob(): WorkflowJob {
  const workflow = load(readFileSync(workflowPath, "utf8")) as BuildWorkflow;
  const job = workflow.jobs?.["build-macos"];
  expect(job, "missing build-macos job").to.not.equal(undefined);
  return job as WorkflowJob;
}

function findStep(job: WorkflowJob, name: string): WorkflowStep {
  const step = job?.steps?.find(
    (candidate: WorkflowStep): boolean => candidate.name === name
  );
  expect(step, `missing ${name} step`).to.not.equal(undefined);
  return step as WorkflowStep;
}

describe("test branch macOS build workflow", (): void => {
  it("guards packaging and runs makers without packaging a second time", (): void => {
    const job = readMacosJob();
    const step = findStep(job, "Build application");
    const run = step.run ?? "";
    const commands = run
      .split("\n")
      .map((line: string): string => line.trim())
      .filter(Boolean);
    const guardCommand =
      "node scripts/run-packaging-with-hang-guard.js --platform=darwin";
    const makeCommand =
      "yarn electron-forge make --skip-package --platform=darwin";
    const guardIndex = run.indexOf(guardCommand);
    const verifyIndex = run.indexOf("yarn verify-packaged-app");
    const makeIndex = run.indexOf(makeCommand);

    expect(step.env?.PACKAGE_GUARD_HARD_TIMEOUT_MS).to.equal("14400000");
    expect(step.env?.PACKAGE_GUARD_STALL_MS).to.equal("900000");
    expect(commands).to.include("set -euo pipefail");
    expect(commands).to.include("export MAKE_MAC_DMG=false");
    expect(commands.filter((line: string): boolean => line.includes(guardCommand)))
      .to.have.length(1);
    expect(commands.some((line: string): boolean =>
      /^(?:yarn\s+)?electron-forge\s+package(?:\s|$)/.test(line)
    )).to.equal(false);
    expect(guardIndex).to.be.greaterThan(-1);
    expect(verifyIndex).to.be.greaterThan(guardIndex);
    expect(makeIndex).to.be.greaterThan(verifyIndex);
    expect(run).to.include(`${guardCommand} 2>&1 | tee build.log`);
    expect(run).to.include("yarn verify-packaged-app 2>&1 | tee -a build.log");
    expect(run).to.include(`${makeCommand} 2>&1 | tee -a build.log`);
    expect(run).to.not.include("yarn make-mac:test");

    const uploadStep = findStep(job, "Upload artifact");
    expect(uploadStep.with?.path).to.include("out/make/**/*.zip");
    expect(uploadStep.with?.["if-no-files-found"]).to.equal("error");
  });
});
