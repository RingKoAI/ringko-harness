const SENSITIVE_NAME = /(token|key|secret|password|passwd|credential|authorization|auth|cookie)s?$/i;
const AGENT_ENVIRONMENT = new Set(["SSH_AUTH_SOCK", "SSH_AGENT_PID", "GPG_AGENT_INFO", "GIT_ASKPASS", "SSH_ASKPASS", "PSMODULEPATH"]);
const MAX_EXPLICIT_ENTRIES = 256;
const MAX_ENVIRONMENT_NAME = 128;
const LOADER_PREFIX = /^(LD_|DYLD_|COR_|CORECLR_|COMPLUS_|APPDOMAIN_MANAGER_)/i;
const LOADER_NAMES = new Set(["NODE_OPTIONS", "DEVPATH", "APP_CONFIG_FILE", "GCONV_PATH", "LOCPATH", "GLIBC_TUNABLES", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "DOTNET_SHARED_STORE"]);

function launcherOverride(name: string): boolean {
  return LOADER_PREFIX.test(name) || LOADER_NAMES.has(name.toUpperCase());
}

/** Ambient credentials are not tool inputs; explicit connector env is authorized configuration. */
export function sandboxEnvironment(temp: string, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!SENSITIVE_NAME.test(name) && !AGENT_ENVIRONMENT.has(name.toUpperCase()) && !launcherOverride(name)) environment[name] = value;
  }
  const entries = Object.entries(extra);
  if (entries.length > MAX_EXPLICIT_ENTRIES) throw new TypeError("Too many explicit sandbox environment entries.");
  for (const [name, value] of entries) {
    if (name.length > MAX_ENVIRONMENT_NAME || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || value.includes("\0")) {
      throw new TypeError("Invalid sandbox environment entry.");
    }
    if (launcherOverride(name)) throw new TypeError(`Sandbox launcher environment override is forbidden: ${name}. Set it inside an already-confined command instead.`);
    environment[name] = value;
  }
  return { ...environment, TMPDIR: temp, TMP: temp, TEMP: temp };
}
