export const NPM_PACKAGE_NAME = "@ringko-ai/rkh";
export const NPM_CLI_COMMAND = "rkh";

/** Match npm's entry point while retaining the standalone binary's command. */
export function cliCommand(entry: string | undefined = process.argv[1]): string {
  const name = (entry ?? "").replace(/\\/g, "/").split("/").pop()?.replace(/\.(mjs|cmd|exe)$/, "");
  return name === NPM_CLI_COMMAND ? NPM_CLI_COMMAND : "ringko";
}
