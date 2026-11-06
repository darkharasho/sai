// One card in the background-work sidebar.
import { motion } from 'motion/react';
import { isPossiblyStuck, isTerminalDetail, type BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';
import { formatElapsed } from './formatCountdown';
import { formatTokens, nowLine } from './backgroundTaskView';

interface Props {
  task: BackgroundTaskDetail;
  nowMs: number;
  /** Terminal but still holding its done state in the running list. */
  settling: boolean;
  stopping: boolean;
  stopFailed: boolean;
  onStop: (id: string) => void;
  reducedMotion: boolean;
}

export default function BackgroundTaskCard({ task, nowMs, settling, stopping, stopFailed, onStop, reducedMotion }: Props) {
  const terminal = isTerminalDetail(task);
  const stuck = isPossiblyStuck(task, nowMs);
  const state = terminal ? (settling ? 'done' : 'finished') : 'running';
  const elapsedS = ((task.endedAt ?? nowMs) - task.startedAt) / 1000;
  const sinceS = (nowMs - task.lastEventAt) / 1000;

  const dot = terminal
    ? task.status === 'failed' ? '✕' : task.status === 'stopped' ? '' : '✓'
    : '';

  return (
    <motion.div
      layout={reducedMotion ? false : 'position'}
      layoutId={reducedMotion ? undefined : `bgtask-${task.id}`}
      transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
      className="sai-bgtask"
      data-task-id={task.id}
      data-state={state}
      data-status={task.status}
      data-stuck={stuck ? 'true' : undefined}
    >
      <div className="sai-bgtask-head">
        <span className="sai-bgtask-dot" aria-hidden>{dot}</span>
        <span className="sai-bgtask-name" title={task.description}>{task.description || 'Background task'}</span>
        <span className="sai-bgtask-kind">{task.kind}</span>
      </div>
      <div className="sai-bgtask-now" title={nowLine(task, nowMs)}>{nowLine(task, nowMs)}</div>
      <div className="sai-bgtask-foot">
        <span className="sai-bgtask-stats">
          <span>{formatElapsed(elapsedS)}</span>
          {task.totalTokens != null && <span>{formatTokens(task.totalTokens)} tok</span>}
          {task.toolUses != null && <span>{task.toolUses} tool{task.toolUses === 1 ? '' : 's'}</span>}
          {/* Shells never report progress; stuck cards already say how long. */}
          {!terminal && !task.isShell && !stuck && sinceS >= 1 && <span>updated {formatElapsed(sinceS)} ago</span>}
        </span>
        {stuck && <span className="sai-bgtask-stuck">⚠ Quiet for {Math.floor(sinceS / 60)}m — may be stuck</span>}
        {!terminal && (
          <button
            type="button"
            className="sai-bgtask-stop"
            disabled={stopping}
            title={stopFailed ? "Couldn't stop this task" : undefined}
            onClick={() => onStop(task.id)}
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>
    </motion.div>
  );
}
