"use strict";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Runtime configuration for Transformers.js inside the local embedding worker.
 * Kept separate from the worker so endpoint/cache behavior can be tested
 * without importing @xenova/transformers.
 */
export interface LocalTransformersConfig {
  cacheDir: string;
  localModelPath: string | null;
  remoteHosts: string[];
  allowRemoteModels: boolean;
}

type EnvMap = Record<string, string | undefined>;

const DEFAULT_REMOTE_HOSTS = [
  "https://huggingface.co/",
  "https://hf-mirror.com/",
];

export function resolveLocalTransformersConfig(
  env: EnvMap = process.env,
  homeDir: string = os.homedir()
): LocalTransformersConfig {
  const cacheDir =
    firstEnv(env, ["AIFETCHLY_TRANSFORMERS_CACHE", "TRANSFORMERS_CACHE"]) ??
    defaultCacheDir(env, homeDir);
  const localModelPath = firstEnv(env, [
    "AIFETCHLY_TRANSFORMERS_LOCAL_MODEL_PATH",
    "TRANSFORMERS_LOCAL_MODEL_PATH",
  ]);
  const explicitRemoteHosts = remoteHostsFromEnv(env);
  const allowRemoteModels = !isTruthy(
    firstEnv(env, [
      "AIFETCHLY_TRANSFORMERS_OFFLINE",
      "TRANSFORMERS_OFFLINE",
      "HF_HUB_OFFLINE",
    ])
  );

  return {
    cacheDir,
    localModelPath,
    remoteHosts:
      explicitRemoteHosts.length > 0
        ? explicitRemoteHosts
        : DEFAULT_REMOTE_HOSTS,
    allowRemoteModels,
  };
}

function firstEnv(env: EnvMap, names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function defaultCacheDir(env: EnvMap, homeDir: string): string {
  const xdgCacheHome = env.XDG_CACHE_HOME?.trim();
  if (xdgCacheHome) {
    return path.join(xdgCacheHome, "aifetchly", "transformers");
  }
  return path.join(homeDir, ".cache", "aifetchly", "transformers");
}

function remoteHostsFromEnv(env: EnvMap): string[] {
  const hosts: string[] = [];
  const hostList = firstEnv(env, ["AIFETCHLY_TRANSFORMERS_REMOTE_HOSTS"]);
  if (hostList) {
    for (const host of hostList.split(",")) {
      pushHost(hosts, host);
    }
  }

  for (const host of [
    firstEnv(env, ["AIFETCHLY_TRANSFORMERS_REMOTE_HOST"]),
    firstEnv(env, ["TRANSFORMERS_REMOTE_HOST"]),
    firstEnv(env, ["HF_ENDPOINT"]),
  ]) {
    if (host) {
      pushHost(hosts, host);
    }
  }

  return hosts;
}

function pushHost(hosts: string[], rawHost: string): void {
  const normalized = normalizeRemoteHost(rawHost);
  if (normalized && !hosts.includes(normalized)) {
    hosts.push(normalized);
  }
}

function normalizeRemoteHost(rawHost: string): string | null {
  const trimmed = rawHost.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function isTruthy(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
