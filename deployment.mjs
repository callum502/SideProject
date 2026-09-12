export function deploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const origins = new Set();
  for (const value of [env.RENDER_EXTERNAL_URL, ...(env.APP_ORIGINS || '').split(',')].filter(value => value?.trim())) {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Public app origins must be HTTPS URLs without paths, credentials, queries or fragments.');
    }
    origins.add(url.origin);
  }
  if (production && !origins.size) throw new Error('Set APP_ORIGINS to your public HTTPS URL before starting in production.');
  return {
    host: production ? '0.0.0.0' : '127.0.0.1',
    secureCookie: production ? '; Secure' : '',
    allows(host, origin) {
      if (production) return origins.has(`https://${host}`) && (!origin || origin === `https://${host}`);
      return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '') && (!origin || origin === `http://${host}`);
    },
  };
}
