import { createAcpClient, type AcpClient, type AcpClientOptions } from './acp';

export interface GeminiAcpClientOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export type GeminiAcpClient = AcpClient;

export function createGeminiAcpClient(options: GeminiAcpClientOptions): GeminiAcpClient {
  const acpOptions: AcpClientOptions = {
    ...options,
    command: 'gemini',
    args: ['--acp'],
    label: 'Gemini ACP',
  };
  return createAcpClient(acpOptions);
}
