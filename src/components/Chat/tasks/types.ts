export type CardStatus = 'queued' | 'running' | 'waiting' | 'paused' | 'done' | 'failed';
export interface TailLine { text: string; tone: 'normal' | 'error' | 'live' }
export interface TaskCard {
  id: string;                      // model id | `bg:<taskId>` | 'current-work'
  source: 'declared' | 'runtime' | 'fallback';
  title: string;
  /** Feed key: taskTag(batchStartedAt, id) for declared cards, the card id otherwise. */
  tag: string;
  status: CardStatus;
  /** One-line "now" label from the card's feed (nowLabel); null = nothing yet. */
  now: string | null;
  startedAt: number | null;
  endedAt: number | null;
  result: string | null;
  agent: { description: string; toolUseId: string | null; taskId: string | null } | null;
  messageIds: string[];            // main-chat message ids attributed to this card
  question: { text: string; options: string[] } | null;
}
export interface TaskBoard { cards: TaskCard[]; batchStartedAt: number | null; allDone: boolean }
export interface SaiTaskInput {
  action: 'create' | 'update';
  tasks?: { id: string; title: string; steps: string[] }[];
  id?: string;
  status?: 'running' | 'done' | 'failed';
  step?: number;
  note?: string;
  agent?: string;
  add_steps?: string[];
}
