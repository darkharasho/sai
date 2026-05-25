import { describe, it, expect } from 'vitest';
import { resolveTailnetIp, resolveTailnetEndpoint } from '@electron/services/remote/tailnet';

describe('resolveTailnetIp', () => {
  it('returns first IPv4 from tailscale ip -4', async () => {
    const exec = async () => ({ stdout: '100.64.1.5\nfd7a:115c::1\n', stderr: '', code: 0 });
    expect(await resolveTailnetIp({ exec })).toBe('100.64.1.5');
  });

  it('returns null when CLI exits non-zero', async () => {
    const exec = async () => ({ stdout: '', stderr: 'not running', code: 1 });
    expect(await resolveTailnetIp({ exec })).toBeNull();
  });

  it('returns null on garbage output', async () => {
    const exec = async () => ({ stdout: 'not an ip\n', stderr: '', code: 0 });
    expect(await resolveTailnetIp({ exec })).toBeNull();
  });
});

describe('resolveTailnetEndpoint', () => {
  it('returns ip and MagicDNS host', async () => {
    const exec = async () => ({
      stdout: JSON.stringify({
        Self: { HostName: 'sai-laptop', TailscaleIPs: ['100.64.1.5'] },
        MagicDNSSuffix: 'tailnet-abc.ts.net.',
      }),
      stderr: '',
      code: 0,
    });
    const r = await resolveTailnetEndpoint({ exec });
    expect(r).toEqual({ ip: '100.64.1.5', host: 'sai-laptop.tailnet-abc.ts.net' });
  });

  it('falls back to Self.DNSName when MagicDNS missing', async () => {
    const exec = async () => ({
      stdout: JSON.stringify({ Self: { DNSName: 'sai-laptop.example.', TailscaleIPs: ['100.64.1.5'] } }),
      stderr: '',
      code: 0,
    });
    expect(await resolveTailnetEndpoint({ exec })).toEqual({ ip: '100.64.1.5', host: 'sai-laptop.example' });
  });

  it('returns nulls on exec failure', async () => {
    const exec = async () => ({ stdout: '', stderr: '', code: 1 });
    expect(await resolveTailnetEndpoint({ exec })).toEqual({ ip: null, host: null });
  });
});
