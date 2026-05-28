export function describeDevice(ua: string, clientId: string): string {
  const platform = detectPlatform(ua);
  const browser = detectBrowser(ua);
  const suffix = clientId ? `#${clientId.slice(0, 4)}` : '';
  const parts = [platform];
  if (browser) parts.push(browser);
  if (suffix) parts.push(suffix);
  return parts.join(' · ');
}

function detectPlatform(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Device';
}

function detectBrowser(ua: string): string | null {
  // Order matters: Edge advertises Chrome; Chrome advertises Safari.
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}
