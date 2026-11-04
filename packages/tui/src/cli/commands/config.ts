import {
  getConfigValue,
  parseConfigValue,
  providerPath,
  saveConfig,
  setConfigValue,
  settingsPath,
  unsetConfigValue,
} from "@ringko-ai/config";
import { readConfig } from "../shared.ts";
import type { CliIo, ParsedArgs } from "../types.ts";

export function configCommand(parsed: ParsedArgs, io: CliIo): number {
  const [sub, key, value] = parsed.positionals;
  const config = readConfig(parsed, io);
  if (!config) return 2;

  switch (sub) {
    case undefined:
    case "show":
      io.out(settingsPath());
      io.out(providerPath());
      io.out(`${JSON.stringify(config, null, 2)}`);
      return 0;
    case "path":
      io.out(settingsPath());
      io.out(providerPath());
      return 0;
    case "get": {
      if (!key) {
        io.err("config get requires a key.");
        return 2;
      }
      const found = getConfigValue(config, key);
      io.out(found === undefined ? "" : JSON.stringify(found));
      return 0;
    }
    case "set": {
      if (!key || value === undefined) {
        io.err("config set requires a key and a value.");
        return 2;
      }
      const updated = setConfigValue(config, key, parseConfigValue(value));
      for (const path of saveConfig(updated)) io.out(path);
      return 0;
    }
    case "unset": {
      if (!key) {
        io.err("config unset requires a key.");
        return 2;
      }
      for (const path of saveConfig(unsetConfigValue(config, key))) io.out(path);
      return 0;
    }
    default:
      io.err(`Unknown config subcommand: ${sub}`);
      return 2;
  }
}
