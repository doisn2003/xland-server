export interface GeoapifyConfig { enabled: boolean; apiKey: string; dailyCredits: number }
export function geoapifyConfig(env: NodeJS.ProcessEnv): GeoapifyConfig {
  const apiKey = env.MAPS_GEOAPIFY_API_KEY?.trim() ?? '';
  const requested = Number(env.MAPS_GEOAPIFY_DAILY_CREDITS ?? 2400);
  // Never exceed the Free allowance, even if an operator mistypes the cap.
  const dailyCredits = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 2400) : 2400;
  return { enabled: env.MAPS_GEOAPIFY_ENABLED === 'true' && /^[a-zA-Z0-9_-]{16,128}$/.test(apiKey), apiKey, dailyCredits };
}
