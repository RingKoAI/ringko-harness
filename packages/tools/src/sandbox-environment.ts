const SENSITIVE_NAME = /(token|key|secret|password|passwd|credential|authorization|auth|cookie)s?$/i;
const AGENT_ENVIRONMENT = new Set(["SSH_AUTH_SOCK", "SSH_AGENT_PID", "GPG_AGENT_INFO", "GIT_ASKPASS", "SSH_ASKPASS", "PSMODULEPATH"]);
const MAX_EXPLICIT_ENTRIES = 256;
const MAX_ENVIRONMENT_NAME = 128;
const LOADER_PREFIX = /^(LD_|DYLD_|COR_|CORECLR_|COMPLUS_|APPDOMAIN_MANAGER_)/i;
const LOADER_NAMES = new Set(["NODE_OPTIONS", "DEVPATH", "APP_CONFIG_FILE", "GCONV_PATH", "LOCPATH", "GLIBC_TUNABLES", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS", "DOTNET_SHARED_STORE"]);
const EXTERNAL_AMBIENT = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "OS", "HOME", "USERPROFILE", "USER", "USERNAME", "LOGNAME", "HOMEDRIVE", "HOMEPATH", "USERDOMAIN",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)",
  "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "TZ", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "RINGKO_HOME", "AGENTS_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
]);

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

/** External agents keep OS/profile/proxy setup, not arbitrary ambient secrets.
 * Explicit env and inherited names are trusted host configuration. Loader
 * overrides remain forbidden so a CLI shim cannot acquire surprise startup code.
 */
export function externalProcessEnvironment(extra: NodeJS.ProcessEnv = {}, inherit: readonly string[] = []): NodeJS.ProcessEnv {
  if (!Array.isArray(inherit) || inherit.length > MAX_EXPLICIT_ENTRIES || inherit.some(name => typeof name !== "string" || name.length > MAX_ENVIRONMENT_NAME || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || launcherOverride(name))) throw new TypeError("Invalid inherited subagent environment names.");
  const key = (name: string) => process.platform === "win32" ? name.toUpperCase() : name;
  const selected = new Set(inherit.map(key));
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (EXTERNAL_AMBIENT.has(name.toUpperCase()) || /^LC_[A-Z_]+$/i.test(name) || selected.has(key(name))) environment[name] = value;
  }
  for (const name of inherit) if (!Object.keys(process.env).some(candidate => key(candidate) === key(name) && process.env[candidate] !== undefined)) throw new Error(`Configured subagent environment variable ${name} is missing.`);
  const entries = Object.entries(extra);
  if (entries.length > MAX_EXPLICIT_ENTRIES) throw new TypeError("Too many explicit subagent environment entries.");
  for (const [name, value] of entries) {
    if (name.length > MAX_ENVIRONMENT_NAME || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (value !== undefined && (typeof value !== "string" || value.includes("\0"))) || launcherOverride(name)) throw new TypeError("Invalid explicit subagent environment entry.");
    if (process.platform === "win32") for (const existing of Object.keys(environment)) if (key(existing) === key(name)) delete environment[existing];
    environment[name] = value;
  }
  return environment;
}
