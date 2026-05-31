import * as Device from 'expo-device';
export function deviceLabel(): string {
  const name = Device.deviceName ?? 'iPhone';
  return `iPhone — ${name}`;
}
