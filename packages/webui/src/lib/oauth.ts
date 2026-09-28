/** Provider types that authenticate with an OAuth2 credential instead of an API key. */
export const OAUTH_PROVIDER_TYPES = ['openai-oauth', 'github-copilot', 'xai-oauth', 'anthropic-oauth', 'google-gemini-cli'] as const

export function isOAuthProviderType(type: string | null | undefined): boolean {
  const value = (type ?? '').toLowerCase()
  return value === 'openai-oauth' || value === 'oauth' || value === 'chatgpt'
    || value === 'github-copilot' || value === 'copilot'
    || value === 'xai-oauth' || value === 'xai' || value === 'grok'
    || value === 'anthropic-oauth' || value === 'claude-oauth'
    || value === 'google-gemini-cli' || value === 'google-oauth'
}
