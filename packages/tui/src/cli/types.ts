// Shared CLI types. Kept outside cli.ts so command modules can depend on the
// contract without importing the dispatcher.

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  config?: string;
  provider?: string;
  model?: string;
  workspace?: string;
  resume?: boolean;
  session?: string;
  sessionPicker?: boolean;
  server?: string;
  port?: number;
  shared?: boolean;
}
