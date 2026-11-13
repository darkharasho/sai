import './tasks.css';

export interface TaskChipProps {
  title: string;
  /** The card's index in board.cards; picks one of six colors. */
  colorIndex: number;
}

/** Small label above the first All item of a run filed under one task. */
export function TaskChip({ title, colorIndex }: TaskChipProps) {
  return <span className={`task-feed-chip task-feed-chip--c${colorIndex % 6}`}>{title}</span>;
}
