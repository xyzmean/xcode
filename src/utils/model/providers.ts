import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
export type LegacyAPIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'
export type APIProvider = LegacyAPIProvider | 'openai'

export function getAPIProvider(): APIProvider {
  return 'openai'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function isFirstPartyAnthropicBaseUrl(): boolean {
  return false
}
