# VS Code Electron Debug Launch ENOSPC

## Symptom

Launching the `Electron Main` VS Code debug configuration stopped during Electron Forge startup. The visible log reached `Building main process and preload bundles...`, then printed repeated debugger detach messages.

## Root Cause

Electron Forge's Vite dev server failed before Electron launch because the Linux inotify watcher quota was exhausted:

```text
Error: ENOSPC: System limit for number of file watchers reached, watch '/home/robertzeng/project/aiFetchly/.env'
```

VS Code debugger output obscured this error in the integrated terminal.

## Evidence

Running the launch command directly reproduced the failure:

```bash
env DISPLAY=:0 AICHAT_DEBUG_REQUEST=1 ./node_modules/.bin/electron-forge start --inspect-electron -- --disable-gpu --disable-software-rasterizer --no-sandbox
```

Running the same command with Chokidar polling got past the watcher failure and launched Electron:

```bash
env DISPLAY=:0 AICHAT_DEBUG_REQUEST=1 CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=1000 ./node_modules/.bin/electron-forge start --inspect-electron -- --disable-gpu --disable-software-rasterizer --no-sandbox
```

Forge reached:

```text
Built main process and preload bundles
Launched Electron app. Type rs in terminal to restart main process.
```

## Fix

The VS Code `Electron Main` launch configuration now sets:

```json
"CHOKIDAR_USEPOLLING": "1",
"CHOKIDAR_INTERVAL": "1000"
```

This keeps the workaround scoped to debug startup and avoids changing normal `yarn start` behavior.

## Status

DONE_WITH_CONCERNS: Debug startup was verified via the equivalent Forge command. Full interactive VS Code debugger attachment was not rerun from the VS Code UI in this terminal-only session.
