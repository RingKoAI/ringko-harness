// Bun's programmatic compiler does not consistently set import.meta.main.
// An explicit entry keeps imported CLI/library modules free of side effects.
import { main } from "./cli.ts";
void main();
