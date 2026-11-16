import { useState, useEffect } from 'react';

// "Tag messages with their task": when on, every reply and tool call in the
// All view carries a chip naming the task tab it is filed under. Cached at
// module scope; SettingsModal broadcasts changes via the window event.
export const TASK_TAGS_EVENT = 'sai-pref-task-tags';

let cached = false;
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  Promise.resolve((window as any).sai.settingsGet('tagMessagesWithTask', false))
    .then((v: unknown) => {
      const on = v === true;
      if (on === cached) return;
      cached = on;
      window.dispatchEvent(new CustomEvent(TASK_TAGS_EVENT, { detail: on }));
    })
    .catch(() => {});
}

export function setTaskTagsPref(on: boolean): void {
  cached = on;
  window.dispatchEvent(new CustomEvent(TASK_TAGS_EVENT, { detail: on }));
}

export function useTaskTagsPref(): boolean {
  const [on, setOn] = useState<boolean>(cached);
  useEffect(() => {
    const onPref = (e: Event) => setOn((e as CustomEvent).detail === true);
    window.addEventListener(TASK_TAGS_EVENT, onPref);
    setOn(cached);
    return () => window.removeEventListener(TASK_TAGS_EVENT, onPref);
  }, []);
  return on;
}
