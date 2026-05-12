import type { SwarmTask } from '../types';

export interface SchedulerOptions {
  cap: number;
  onStart: (task: SwarmTask) => void;
}

export class SwarmScheduler {
  private tasks: SwarmTask[] = [];
  constructor(private opts: SchedulerOptions) {}

  setTasks(tasks: SwarmTask[]) {
    this.tasks = tasks;
    this.tick();
  }

  setCap(cap: number) {
    this.opts.cap = cap;
    this.tick();
  }

  tick() {
    const streaming = this.tasks.filter(t => t.status === 'streaming').length;
    let free = this.opts.cap - streaming;
    if (free <= 0) return;
    for (const t of this.tasks) {
      if (free === 0) break;
      if (t.status === 'queued') {
        // Mark in-memory so a re-tick before external state catches up doesn't double-promote.
        (t as SwarmTask).status = 'streaming';
        this.opts.onStart(t);
        free--;
      }
    }
  }
}
