export type PushKind = 'done' | 'approval' | 'question' | 'error';

export interface PushPlain {
  v: 1;
  kind: PushKind;
  chatId: string;
  projectPath: string;
  title: string;
  body: string;
  ts: number;
}

export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 180;
export const PUSH_CHATID_MAX = 128;
export const PUSH_PATH_MAX = 512;
