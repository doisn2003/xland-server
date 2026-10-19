export interface EmbedConfig {
  readonly enabled: boolean;
  readonly apiKey: string;
  readonly wrapperOrigin: string;
  readonly parentOrigins: readonly string[];
  readonly reason: string | null;
}
function origin(value: string | undefined, allowLocalHttp: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const localHttp = allowLocalHttp && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}
export function embedConfigFromEnv(env: NodeJS.ProcessEnv): EmbedConfig {
  const allowLocalHttp = env.NODE_ENV !== 'production' && env.MAPS_ALLOW_LOCAL_HTTP === 'true';
  const wrapperOrigin = origin(env.MAPS_WRAPPER_ORIGIN, allowLocalHttp);
  const parentInputs = (env.MAPS_WEB_ORIGINS ?? '').split(',').filter(Boolean);
  const parentOrigins = parentInputs.map(value => origin(value.trim(), allowLocalHttp));
  const key = env.MAPS_EMBED_API_KEY?.trim() ?? '';
  const requested = env.MAPS_EMBED_ENABLED === 'true';
  let reason: string | null = null;
  if (!requested) reason = 'Bản đồ Google chưa được bật';
  else if (!/^[A-Za-z0-9_-]{16,256}$/.test(key)) reason = 'Chưa cấp cấu hình Google Maps Embed';
  else if (!wrapperOrigin || parentOrigins.some(value => value === null)) reason = 'Chưa cấu hình địa chỉ HTTPS bản đồ hợp lệ';
  else if (env.MAPS_EMBED_RESTRICTIONS_CONFIRMED !== 'true') reason = 'Chưa xác nhận giới hạn sử dụng khóa Google Maps Embed';
  return Object.freeze({
    enabled: requested && reason === null,
    apiKey: reason ? '' : key,
    wrapperOrigin: wrapperOrigin ?? '',
    parentOrigins: Object.freeze(parentOrigins.filter((value): value is string => value !== null)),
    reason,
  });
}
