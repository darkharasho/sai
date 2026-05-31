// PWA-faithful port of src/renderer-remote/chat/GitHubWatcherCard.tsx.
// Renders a CI run snapshot streamed from the desktop via github.watcher
// frames. Tapping "Open on GitHub" launches the URL via expo-linking.
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  ExternalLink,
  GitBranch,
  MinusCircle,
  XCircle,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import type {
  GithubWatcherStore,
  GithubWatcherSnapshotShape,
  GitHubWatchTarget,
} from '../lib/githubWatcherStore';
import { githubWatcherStore as defaultStore } from '../lib/githubWatcherStore';

type Phase = GithubWatcherSnapshotShape['phase'];

interface IconProps { size?: number; color?: string }

const PHASE_THEME: Record<Phase, { color: string; label: string; Icon: ComponentType<IconProps> }> = {
  pending:     { color: '#8a9099', label: 'Connecting',    Icon: Clock },
  queued:      { color: '#8a9099', label: 'Queued',        Icon: Clock },
  in_progress: { color: '#c7910c', label: 'Running',       Icon: CircleDot },
  success:     { color: '#3fb950', label: 'Success',       Icon: CheckCircle2 },
  failure:     { color: '#f85149', label: 'Failed',        Icon: XCircle },
  cancelled:   { color: '#8a9099', label: 'Cancelled',     Icon: MinusCircle },
  neutral:     { color: '#8a9099', label: 'Completed',     Icon: CheckCircle2 },
  error:       { color: '#f85149', label: 'Watcher error', Icon: AlertCircle },
};

interface JobShape {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'waiting' | 'completed' | 'unknown';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | null;
}

interface RunShape {
  status?: string;
  conclusion?: string | null;
  name?: string;
  displayTitle?: string;
  runNumber?: number;
  headBranch?: string;
  htmlUrl?: string;
  _jobs?: JobShape[];
}

function jobIcon(job: JobShape): { color: string; Icon: ComponentType<IconProps> } {
  if (job.status === 'in_progress') return { color: '#c7910c', Icon: CircleDot };
  if (job.status === 'queued' || job.status === 'waiting') return { color: '#8a9099', Icon: Clock };
  if (job.status === 'completed') {
    if (job.conclusion === 'success') return { color: '#3fb950', Icon: CheckCircle2 };
    if (job.conclusion === 'failure' || job.conclusion === 'timed_out') return { color: '#f85149', Icon: XCircle };
    if (job.conclusion === 'cancelled' || job.conclusion === 'skipped') return { color: '#8a9099', Icon: MinusCircle };
    return { color: '#8a9099', Icon: CheckCircle2 };
  }
  return { color: '#8a9099', Icon: Circle };
}

const C = {
  bgSecondary: '#181c20',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  mono: 'Menlo',
};

interface Props {
  messageId: string;
  target: GitHubWatchTarget;
  watcherStore?: GithubWatcherStore;
}

export function GitHubWatcherCard({ messageId, target, watcherStore }: Props) {
  const store = watcherStore ?? defaultStore;
  const [snap, setSnap] = useState<GithubWatcherSnapshotShape | undefined>(
    store.get(messageId, target.url),
  );

  useEffect(() => {
    const off = store.subscribe((key, s) => {
      if (key === `${messageId} ${target.url}` && s) setSnap(s);
    });
    return off;
  }, [store, messageId, target.url]);

  const phase: Phase = snap?.phase ?? 'pending';
  const theme = PHASE_THEME[phase];
  const run = (snap?.data ?? {}) as RunShape;
  const jobs = (run._jobs ?? []) as JobShape[];
  const title = run.displayTitle || run.name || `${target.owner}/${target.repo} #${target.runId}`;
  const url = run.htmlUrl || target.url;
  const PhaseIcon = theme.Icon;

  return (
    <View style={{
      marginVertical: 6,
      paddingTop: 10,
      paddingBottom: 10,
      paddingRight: 12,
      paddingLeft: 14,
      backgroundColor: C.bgSecondary,
      borderWidth: 1,
      borderColor: C.border,
      borderLeftWidth: 3,
      borderLeftColor: theme.color,
      borderRadius: 8,
      gap: 6,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderWidth: 1,
          borderColor: theme.color + '55',
          borderRadius: 999,
        }}>
          <PhaseIcon size={11} color={theme.color} />
          <Text style={{
            color: theme.color,
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.2,
            textTransform: 'uppercase',
          }}>
            {theme.label}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <GitBranch size={10} color={C.textMuted} />
          <Text style={{
            fontSize: 10,
            color: C.textMuted,
            fontFamily: C.mono,
          }}>
            {target.owner}/{target.repo}{run.runNumber ? ` · #${run.runNumber}` : ''}
          </Text>
        </View>
      </View>
      <Pressable onPress={url ? () => { void Linking.openURL(url); } : undefined}>
        <Text style={{ fontSize: 13, color: C.text, lineHeight: 17 }}>{title}</Text>
      </Pressable>
      {run.headBranch ? (
        <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: C.mono }}>{run.headBranch}</Text>
      ) : null}
      {jobs.length > 0 ? (
        <View style={{ marginTop: 2, gap: 3 }}>
          {jobs.map((j) => {
            const ji = jobIcon(j);
            const JIcon = ji.Icon;
            return (
              <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <JIcon size={12} color={ji.color} />
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={{
                    fontFamily: C.mono,
                    fontSize: 11,
                    color: ji.color,
                    flex: 1,
                  }}
                >
                  {j.name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {url ? (
        <Pressable
          onPress={() => { void Linking.openURL(url); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
        >
          <Text style={{ fontSize: 11, color: C.accent }}>Open on GitHub</Text>
          <ExternalLink size={11} color={C.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}
