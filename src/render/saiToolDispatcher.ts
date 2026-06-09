import { renderStore } from './renderStore';
import { getRegisteredComponent, registeredComponentKeys } from './componentRegistry';
import { buildChartHtml, buildDiffHtml, type ChartInput, type DiffInput } from './builtinRenderers';

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_WIDTH = 360;

export function dispatchSaiRenderTool(name: string, input: any, renderId: string): DispatchResult {
  const inp = input ?? {};
  const width = typeof inp.width === 'number' && inp.width > 0 ? inp.width : DEFAULT_WIDTH;
  const background = typeof inp.background === 'string' ? inp.background : undefined;
  const title = typeof inp.title === 'string' ? inp.title : '';

  switch (name) {
    case 'render_html': {
      if (typeof inp.html !== 'string' || inp.html.length === 0) {
        return { ok: false, error: 'render_html requires a non-empty "html" string' };
      }
      renderStore.upsert({ renderId, kind: 'html', payload: { html: inp.html }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_component': {
      if (typeof inp.component !== 'string' || inp.component.length === 0) {
        return { ok: false, error: 'render_component requires a "component" string' };
      }
      if (!getRegisteredComponent(inp.component)) {
        return { ok: false, error: `unknown component: ${inp.component}. Available: ${registeredComponentKeys().join(', ')}` };
      }
      const props = inp.props && typeof inp.props === 'object' ? inp.props : {};
      renderStore.upsert({ renderId, kind: 'component', payload: { component: inp.component, props }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_chart': {
      let html: string;
      try {
        html = buildChartHtml(inp as ChartInput);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'invalid chart input' };
      }
      renderStore.upsert({ renderId, kind: 'html', payload: { html }, title: title || 'Chart', width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_diff': {
      if (typeof inp.before !== 'string' || inp.before.length === 0 ||
          typeof inp.after !== 'string' || inp.after.length === 0) {
        return { ok: false, error: 'render_diff requires non-empty "before" and "after" HTML strings' };
      }
      let html: string;
      try {
        html = buildDiffHtml(inp as DiffInput);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'invalid diff input' };
      }
      renderStore.upsert({ renderId, kind: 'html', payload: { html }, title: title || 'Diff', width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_mermaid': {
      if (typeof inp.diagram !== 'string' || inp.diagram.length === 0) {
        return { ok: false, error: 'render_mermaid requires a non-empty "diagram" string' };
      }
      renderStore.upsert({ renderId, kind: 'mermaid', payload: { diagram: inp.diagram }, title: title || 'Diagram', width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_theme': {
      if (!inp.vars || typeof inp.vars !== 'object' || Array.isArray(inp.vars)) {
        return { ok: false, error: 'render_theme requires a "vars" object of CSS custom properties' };
      }
      const components = Array.isArray(inp.components) && inp.components.length > 0
        ? (inp.components as unknown[]).filter((c): c is string => typeof c === 'string')
        : registeredComponentKeys();
      renderStore.upsert({ renderId, kind: 'theme', payload: { components, vars: inp.vars }, title: title || 'Theme', width, background, status: 'rendering' });
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
