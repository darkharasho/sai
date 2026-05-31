// Bottom-sheet picker for terminals (phone + desktop). Mirrors
// src/renderer-remote/terminal/TerminalPicker.tsx but uses RN Modal/ScrollView
// to follow the same UX as components/WorkspacePicker.tsx.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import type { WireClient } from '../lib/wire';
import { FONT } from '../lib/fonts';

const C = {
  bgSecondary: '#0c0f11',
  bgElevated: '#13171b',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
  overlay: 'rgba(0,0,0,0.55)',
  mono: FONT.mono,
};

export interface TerminalSummary {
  termId: number;
  cwd: string;
  cols: number;
  rows: number;
  alive: boolean;
  origin: 'phone' | 'desktop';
}

interface Props {
  open: boolean;
  client: WireClient | null;
  cwd: string;
  currentTermId: number | null;
  onClose: () => void;
  onPick: (term: TerminalSummary) => void;
  onKill: (term: TerminalSummary) => void;
}

export default function TerminalPicker({
  open, client, cwd, currentTermId, onClose, onPick, onKill,
}: Props) {
  const [terms, setTerms] = useState<TerminalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [killingId, setKillingId] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    client.listTerminals(cwd)
      .then((arr) => { if (!cancelled) setTerms(arr as TerminalSummary[]); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, client, cwd]);

  const onNew = async () => {
    if (!client) return;
    setCreating(true);
    setErr(null);
    try {
      const r = await client.openTerminal(cwd, 80, 24);
      // The picker is closed once the parent applies the pick.
      onPick({ termId: r.termId, cwd, cols: r.cols, rows: r.rows, alive: true, origin: 'phone' });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onKillRow = async (t: TerminalSummary) => {
    setKillingId(t.termId);
    try {
      await onKill(t);
      setTerms((arr) => arr.filter((x) => x.termId !== t.termId));
    } finally {
      setKillingId(null);
    }
  };

  const phoneTerms = terms.filter((t) => t.origin === 'phone');
  const desktopTerms = terms.filter((t) => t.origin === 'desktop');

  const renderRow = (t: TerminalSummary) => {
    const active = t.termId === currentTermId;
    return (
      <View
        key={t.termId}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          borderLeftWidth: 2,
          borderLeftColor: active ? C.accent : 'transparent',
        }}
      >
        <Pressable
          onPress={() => onPick(t)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Text style={{ fontFamily: C.mono, fontSize: 13, color: C.accent }}>#{t.termId}</Text>
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontFamily: C.mono, fontSize: 13, color: C.textMuted }}
          >
            {t.cwd}
          </Text>
          <View style={{
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 999,
            borderWidth: t.origin === 'desktop' ? 1 : 0,
            borderColor: C.border,
            backgroundColor: t.origin === 'phone' ? C.accent : 'transparent',
          }}>
            <Text style={{
              fontFamily: C.mono,
              fontSize: 9,
              color: t.origin === 'phone' ? '#000' : C.textMuted,
            }}>
              {t.origin}
            </Text>
          </View>
          <Text style={{ fontFamily: C.mono, fontSize: 11, color: C.textMuted }}>
            {t.cols}×{t.rows}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onKillRow(t)}
          disabled={killingId === t.termId}
          accessibilityLabel={`Kill terminal #${t.termId}`}
          style={{
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            opacity: killingId === t.termId ? 0.5 : 1,
          }}
        >
          <X size={14} color={C.red} strokeWidth={2} />
        </Pressable>
      </View>
    );
  };

  const sectionHeader = (label: string) => (
    <View style={{
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 4,
      backgroundColor: C.bgSecondary,
    }}>
      <Text style={{
        fontFamily: C.mono,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: C.textMuted,
      }}>
        {label}
      </Text>
    </View>
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation?.()}
          style={{
            backgroundColor: C.bgSecondary,
            borderTopWidth: 1,
            borderTopColor: C.border,
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            paddingBottom: 24,
            maxHeight: '75%',
          }}
        >
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          }}>
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.text }}>Terminals</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close picker">
              <X size={18} color={C.textMuted} strokeWidth={2} />
            </Pressable>
          </View>
          <Pressable
            onPress={onNew}
            disabled={creating}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: C.border,
              opacity: creating ? 0.6 : 1,
            }}
          >
            <Plus size={16} color={C.accent} strokeWidth={2} />
            <Text style={{ fontSize: 14, color: C.accent }}>
              {creating ? 'Opening…' : 'New terminal'}
            </Text>
          </Pressable>
          <ScrollView>
            {loading && (
              <View style={{ padding: 14 }}>
                <ActivityIndicator color={C.accent} />
              </View>
            )}
            {err && (
              <View style={{ padding: 14 }}>
                <Text style={{ fontSize: 12, color: C.red }}>{err}</Text>
              </View>
            )}
            {!loading && terms.length === 0 && !err && (
              <View style={{ padding: 14 }}>
                <Text style={{ fontSize: 12, color: C.textMuted }}>No terminals yet.</Text>
              </View>
            )}
            {phoneTerms.length > 0 && sectionHeader('Phone terminals')}
            {phoneTerms.map(renderRow)}
            {desktopTerms.length > 0 && sectionHeader('Desktop terminals')}
            {desktopTerms.map(renderRow)}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
