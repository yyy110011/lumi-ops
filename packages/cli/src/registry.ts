import * as path from 'path';
import * as fs from 'fs-extra';
import { getLumiOpsHome } from './constants';

const REGISTRY_FILE = '.registry.json';

export interface RegisteredRepo {
  name: string;
  rootDir: string;
}

/**
 * Get the path to the global registry file.
 */
export function getRegistryPath(): string {
  return path.join(getLumiOpsHome(), REGISTRY_FILE);
}

/**
 * Read the registry from disk.
 */
function readRegistry(): Record<string, string> {
  const registryPath = getRegistryPath();
  try {
    return fs.readJSONSync(registryPath);
  } catch {
    return {};
  }
}

/**
 * Write the registry to disk.
 */
function writeRegistry(registry: Record<string, string>): void {
  const registryPath = getRegistryPath();
  fs.ensureDirSync(path.dirname(registryPath));
  fs.writeJSONSync(registryPath, registry, { spaces: 2 });
}

/**
 * Register (or update) a repo in the global registry.
 * @param repoName - Display name for the repo (typically `path.basename(rootDir)`)
 * @param rootDir  - Absolute path to the repo root
 */
export function registerRepo(repoName: string, rootDir: string): void {
  const registry = readRegistry();
  registry[repoName] = path.resolve(rootDir);
  writeRegistry(registry);
}

/**
 * Remove a repo from the global registry.
 */
export function unregisterRepo(repoName: string): void {
  const registry = readRegistry();
  delete registry[repoName];
  writeRegistry(registry);
}

/**
 * List all repos in the global registry.
 */
export function listRegisteredRepos(): RegisteredRepo[] {
  const registry = readRegistry();
  return Object.entries(registry).map(([name, rootDir]) => ({ name, rootDir }));
}
