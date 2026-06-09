import type { CSSProperties } from 'react';
import { getRegisteredComponent } from './componentRegistry';

export function ThemedComponents({
  components,
  vars,
  props,
}: {
  components: string[];
  vars: Record<string, string>;
  props?: Record<string, unknown>;
}) {
  // CSS custom properties go through inline style; cast because React's
  // CSSProperties doesn't type arbitrary `--*` keys.
  const wrapStyle = { display: 'flex', flexWrap: 'wrap', gap: 12, padding: 12, ...vars } as CSSProperties;
  return (
    <div data-themed-wrap style={wrapStyle}>
      {components.map((key, i) => {
        const reg = getRegisteredComponent(key);
        if (!reg) {
          return <div key={i} className="sai-render-card__err">unknown component: {key}</div>;
        }
        const Cmp = reg.component;
        return <Cmp key={i} {...(props ?? {})} />;
      })}
    </div>
  );
}
