import { access, gate } from "@ringko-ai/harness";

const mode = access();
const decision = gate({ kind: "safe" });

process.stdout.write(
  `${mode.label}\n${mode.summary}\n` +
    `Proceed: ${String(decision.proceed)}\n` +
    `Approval required: ${String(decision.approvalRequired)}\n`,
);
