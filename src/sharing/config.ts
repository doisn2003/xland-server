export interface SharingConfig {
  publicBaseUrl: string | undefined;
  androidPackage: string;
  androidFingerprints: string[];
  appleAppId: string | undefined;
}

export function publicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('PUBLIC_BASE_URL must be a public HTTPS origin without path, credentials, query or fragment');
  }
  return url.origin;
}

export function sharingConfig(env: NodeJS.ProcessEnv): SharingConfig {
  const androidPackage = env.SHARE_ANDROID_PACKAGE ?? 'vn.xland.xland_mobile';
  if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(androidPackage)) throw new Error('Invalid SHARE_ANDROID_PACKAGE');
  const androidFingerprints = (env.SHARE_ANDROID_SHA256 ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (androidFingerprints.some(s => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))) throw new Error('Invalid SHARE_ANDROID_SHA256');
  const appleAppId = env.SHARE_APPLE_APP_ID || undefined;
  if (appleAppId && !/^[A-Z0-9]{10}\.[a-zA-Z0-9.-]+$/.test(appleAppId)) throw new Error('Invalid SHARE_APPLE_APP_ID');
  return { publicBaseUrl: publicOrigin(env.PUBLIC_BASE_URL), androidPackage, androidFingerprints, appleAppId };
}
