export const IDE_LIMITS = {
  maxPromptChars: 65_536,
  maxSelectionChars: 24_000,
  maxDiagnosticsItems: 50,
  maxDiagnosticMessageChars: 500,
  maxQueueItems: 32,
  maxUploadFiles: 16,
  maxUploadFileBytes: 20 * 1024 * 1024,
  maxUploadBatchBytes: 28 * 1024 * 1024,
  maxBase64Chars: 28 * 1024 * 1024,
  maxReferenceChars: 2_048,
  maxIdChars: 128,
  backendProbeTimeoutMs: 1_500,
  backendStartTimeoutMs: 15_000,
  backendRetryMs: 200,
  backendStartRetryMs: 1_000,
  backendMaxStartAttempts: 3,
  staleRegistrationMs: 10_000,
  statusTimeoutMs: 5_000,
} as const;

export const DEFAULT_ATTACHMENT_PROMPTS = {
  en: "Please inspect the attached files.",
  "zh-CN": "请查看上传的附件。",
} as const;
