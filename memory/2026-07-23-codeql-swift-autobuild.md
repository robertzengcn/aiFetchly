# CodeQL Swift Autobuild Failure

## Symptom

GitHub CodeQL reported:

```text
Detected build command failed
autobuild failed to run the build command:
/usr/bin/swift build --package-path /Users/runner/work/aiFetchly/aiFetchly/.claude/skills/gstack/ios-qa/scripts/gen-accessors-tool
```

## Root Cause

The repository contains checked-in agent/tooling files under `.claude/`, including Swift packages such as `.claude/skills/gstack/ios-qa/scripts/gen-accessors-tool/Package.swift`. GitHub CodeQL language detection can treat those files as Swift code and run Swift autobuild, even though AiFetchly is a TypeScript/Electron project.

The committed `.github/workflows/codeql.yml` only analyzes `javascript-typescript`, so a Swift autobuild failure is likely from GitHub CodeQL default setup or another generated CodeQL configuration in repository settings.

## Fix

Added `.github/codeql/codeql-config.yml` and wired `.github/workflows/codeql.yml` to use it. The config excludes local agent/tooling and build output directories from CodeQL analysis.

## Verification

Validated YAML parsing for both CodeQL files with Ruby's YAML parser.

## Follow-Up

In GitHub repository settings, ensure CodeQL default setup is not separately enabled for Swift. Use the committed advanced workflow for JavaScript/TypeScript analysis.
