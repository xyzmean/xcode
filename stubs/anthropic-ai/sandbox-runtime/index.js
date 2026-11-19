import { spawnSync } from 'node:child_process';

const violationStore = {
  getViolations() { return []; },
  addViolation() {},
  clear() {},
  subscribe() { return () => {}; },
};

let cachedPlatformSupport = null;
function detectSandboxBinary() {
  if (cachedPlatformSupport !== null) return cachedPlatformSupport;
  if (process.platform === 'linux') {
    const res = spawnSync('which', ['bwrap'], { encoding: 'utf8' });
    cachedPlatformSupport = res.status === 0 ? 'bwrap' : '';
  } else if (process.platform === 'darwin') {
    const res = spawnSync('which', ['sandbox-exec'], { encoding: 'utf8' });
    cachedPlatformSupport = res.status === 0 ? 'sandbox-exec' : '';
  } else {
    cachedPlatformSupport = '';
  }
  return cachedPlatformSupport;
}

let activeConfig = null;

function shellQuote(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

export class SandboxManager {
  constructor() {}
  start() { return Promise.resolve(); }
  stop() { return Promise.resolve(); }
  static isSupportedPlatform() { return detectSandboxBinary() !== ''; }
  static initialize(config) {
    activeConfig = config ?? null;
    return Promise.resolve();
  }
  static updateConfig(config) {
    activeConfig = config ?? activeConfig;
  }
  static reset() {
    activeConfig = null;
    return Promise.resolve();
  }
  static wrapWithSandbox(command) {
    const bin = detectSandboxBinary();
    if (!bin || !activeConfig) return Promise.resolve(command);
    if (bin === 'bwrap') {
      const cwd = process.cwd();
      const args = [
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        '--bind', cwd, cwd,
        '--die-with-parent',
        'bash', '-lc', command,
      ];
      return Promise.resolve(`bwrap ${args.map(shellQuote).join(' ')}`);
    }
    return Promise.resolve(command);
  }
  static checkDependencies() {
    const bin = detectSandboxBinary();
    return bin
      ? { errors: [], warnings: [] }
      : { errors: [], warnings: ['bwrap/sandbox-exec not found on PATH; running without OS sandbox'] };
  }
  static getFsReadConfig() { return { denyOnly: [] }; }
  static getFsWriteConfig() { return { allowOnly: [], denyWithinAllow: [] }; }
  static getNetworkRestrictionConfig() { return {}; }
  static getIgnoreViolations() { return {}; }
  static getAllowUnixSockets() { return []; }
  static getAllowLocalBinding() { return false; }
  static getEnableWeakerNestedSandbox() { return false; }
  static getProxyPort() { return undefined; }
  static getSocksProxyPort() { return undefined; }
  static getLinuxHttpSocketPath() { return undefined; }
  static getLinuxSocksSocketPath() { return undefined; }
  static waitForNetworkInitialization() { return Promise.resolve(); }
  static getSandboxViolationStore() { return violationStore; }
  static annotateStderrWithSandboxFailures(_cmd, stderr) { return stderr; }
  static cleanupAfterCommand() {}
}
export const SandboxRuntimeConfigSchema = {};
export class SandboxViolationStore {
  constructor() {}
  getViolations() { return []; }
}
