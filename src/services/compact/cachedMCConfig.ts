export type CachedMCConfig = {
  enabled: boolean
  keepRecentToolResults: number
  minToolResultChars: number
}

export function getCachedMCConfig(): CachedMCConfig {
  return {
    enabled: true,
    keepRecentToolResults: 5,
    minToolResultChars: 2000,
  }
}
