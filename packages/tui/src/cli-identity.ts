/** Public npm package name; the published tarball keeps this identity. */
export const NPM_PACKAGE_NAME = "@ringko-ai/rkh";

/** The command every build exposes: source bin, standalone binary and npm tarball. */
export const CLI_COMMAND = "ringko";
export const NPM_CLI_COMMAND = CLI_COMMAND;

/** One command name for every build, whichever entry point was invoked. */
export function cliCommand(_entry: string | undefined = process.argv[1]): string {
  return CLI_COMMAND;
}
