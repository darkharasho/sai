// Unified-diff viewer. Mirrors src/renderer-remote/files/DiffViewer.tsx,
// rendered through a WebView so long lines can scroll horizontally without
// fighting RN's flex layout. The header mirrors the PWA's chrome (path +
// staged/unstaged badge + ±counts).
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  green: '#4ade80',
  red: '#E35535',
  mono: 'Menlo',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface ParsedLine {
  kind: 'context' | 'add' | 'remove' | 'hunk' | 'meta';
  text: string;
}

function parseDiff(diff: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) out.push({ kind: 'hunk', text: line });
    else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      out.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) out.push({ kind: 'add', text: line });
    else if (line.startsWith('-')) out.push({ kind: 'remove', text: line });
    else out.push({ kind: 'context', text: line });
  }
  return out;
}

function diffHtml(diff: string): string {
  const lines = parseDiff(diff);
  const bodyLines = lines.map((l) => {
    let cls = 'ctx';
    if (l.kind === 'add') cls = 'add';
    else if (l.kind === 'remove') cls = 'rem';
    else if (l.kind === 'hunk') cls = 'hunk';
    else if (l.kind === 'meta') cls = 'meta';
    return `<div class="${cls}">${escapeHtml(l.text || ' ')}</div>`;
  }).join('');
  return `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
    <style>
      html,body{margin:0;background:${C.bgPrimary};color:${C.text};font-family:Menlo,ui-monospace,monospace;font-size:12px;line-height:1.45;}
      .wrap{padding:6px 0;white-space:pre;overflow-x:auto;}
      div{padding:0 10px;white-space:pre;}
      .add{color:${C.green};background:rgba(74,222,128,0.10);}
      .rem{color:${C.red};background:rgba(227,85,53,0.10);}
      .hunk{color:${C.accent};}
      .meta{color:${C.textMuted};}
      .ctx{color:${C.text};}
    </style>
  </head><body><div class="wrap">${bodyLines}</div></body></html>`;
}

interface Props {
  path: string;
  status: string;
  staged: boolean;
  diff: string;
}

const STATUS_LABEL: Record<string, { letter: string; color: string }> = {
  modified: { letter: 'M', color: '#f59e0b' },
  added: { letter: 'A', color: C.green },
  deleted: { letter: 'D', color: C.red },
  renamed: { letter: 'R', color: '#3b82f6' },
};

export default function DiffViewer({ path, status, staged, diff }: Props) {
  const stats = useMemo(() => {
    let add = 0, rem = 0;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) add++;
      else if (line.startsWith('-') && !line.startsWith('---')) rem++;
    }
    return { add, rem };
  }, [diff]);

  const html = useMemo(() => diffHtml(diff || ''), [diff]);
  const empty = !diff || !diff.trim();
  const meta = STATUS_LABEL[status] ?? { letter: '?', color: C.textMuted };

  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: C.bgPrimary }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: C.bgSecondary,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}>
        <Text style={{ fontFamily: C.mono, fontSize: 13, fontWeight: '700', color: meta.color, width: 14 }}>
          {meta.letter}
        </Text>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontFamily: C.mono, fontSize: 12, color: C.text }}
        >
          {path}
        </Text>
        <View style={{
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: staged ? C.accent : C.border,
          backgroundColor: staged ? C.accent : 'transparent',
        }}>
          <Text style={{
            fontFamily: C.mono,
            fontSize: 10,
            color: staged ? '#000' : C.textMuted,
          }}>
            {staged ? 'staged' : 'unstaged'}
          </Text>
        </View>
        <Text style={{ fontFamily: C.mono, fontSize: 11, color: C.green }}>+{stats.add}</Text>
        <Text style={{ fontFamily: C.mono, fontSize: 11, color: C.red }}>-{stats.rem}</Text>
      </View>
      {empty ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: C.textMuted, fontSize: 13 }}>No changes.</Text>
        </View>
      ) : (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          style={{ flex: 1, backgroundColor: C.bgPrimary }}
          scrollEnabled
          showsHorizontalScrollIndicator
        />
      )}
    </View>
  );
}
