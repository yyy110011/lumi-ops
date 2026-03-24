/**
 * Driver registry — resolves a DriverName to its DriverSpec implementation.
 */

import type { DriverName, DriverSpec } from './types';
import { claudeDriver } from './claude';
import { geminiDriver } from './gemini';

export type { DriverName, DriverSpec, LaunchOptions, AgentStatus, AgentStatusValue } from './types';
export { claudeDriver } from './claude';
export { geminiDriver } from './gemini';

const drivers: Record<DriverName, DriverSpec> = {
  claude: claudeDriver,
  gemini: geminiDriver,
};

/**
 * Get the DriverSpec for a given driver name.
 * Throws if the driver name is not recognized.
 */
export function getDriver(name: DriverName): DriverSpec {
  const driver = drivers[name];
  if (!driver) {
    throw new Error(`Unknown driver: "${name}". Supported drivers: ${Object.keys(drivers).join(', ')}`);
  }
  return driver;
}
