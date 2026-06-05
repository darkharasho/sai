// Editable file view. Port of src/renderer-remote/files/FileEditor.tsx but
// without Shiki/syntax highlighting (impractical on mobile) — the editor is
// a plain monospace TextInput with stale-write detection + conflict modal,
// matching the PWA's safety semantics.
//
// On Save:
//   client.writeFile(cwd, path, content, expectMtime, expectSha)
//   - success → update initial* state, stay in edit mode
//   - isWriteStaleError → open conflict modal (Overwrite / Reload / Cancel)
//   - other → render error banner
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform,
  Pressable, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useConn } from '../../../../lib/connection';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import { isWriteStaleError } from '../../../../lib/wire';
import EditorToolbar from '../../../../components/EditorToolbar';
import { highlightedSpans } from '../../../../components/SyntaxHighlight';
import { langFromPath } from '../../../../lib/highlight';
import { FONT } from '../../../../lib/fonts';

const C = {
  bgPrimary: '#0e1114',
  bgSecondary: '#0c0f11',
  bgInput: '#161a1f',
  border: '#1e2228',
  text: '#bec6d0',
  textMuted: '#5a6a7a',
  accent: '#c7910c',
  red: '#E35535',
  amber: '#f59e0b',
  mono: FONT.mono,
  overlay: 'rgba(0,0,0,0.55)',
};

// TextInput with inline highlighted spans. RN renders nested <Text>
// children with their per-span styles, so when the combined children text
// equals `value` the input shows colorized code while still being typeable.
// On iOS the attributedString refresh on every keystroke can cause minor
// flicker — useDeferredValue keeps the visible spans one tick behind input
// so typing remains responsive on large files.
function Highlighted({
  content, lang, setContent,
}: { content: string; lang?: string; setContent(t: string): void }) {
  const spans = useMemo(() => highlightedSpans(content, lang), [content, lang]);
  return (
    <TextInput
      value={content}
      onChangeText={setContent}
      multiline
      autoCorrect={false}
      autoCapitalize="none"
      autoComplete="off"
      spellCheck={false}
      keyboardType="ascii-capable"
      textAlignVertical="top"
      style={{
        flex: 1,
        padding: 12,
        color: '#c9d1d9',
        backgroundColor: C.bgPrimary,
        fontFamily: C.mono,
        fontSize: 13,
        lineHeight: 18,
      }}
    >
      <Text>{spans}</Text>
    </TextInput>
  );
}

export default function FileEdit() {
  const params = useLocalSearchParams<{ path: string; cwd?: string }>();
  const { machine, client } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const cwd = (params.cwd as string | undefined) ?? active?.projectPath ?? null;
  const path = (params.path as string | undefined) ?? '';

  // Loaded baseline. initialMtime/Sha are used for the optimistic-concurrency
  // expectations on writeFile. After a successful write they advance to the
  // server's new values so subsequent saves keep using fresh tokens.
  const [content, setContent] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [initialMtime, setInitialMtime] = useState<number | null>(null);
  const [initialSha, setInitialSha] = useState<string | null>(null);
  const [lang, setLang] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Conflict modal payload — server returns the disk's current mtime/sha
  // when our expect* tokens don't match.
  const [conflict, setConflict] = useState<{ currentMtime: number; currentSha: string } | null>(null);
  // Mirror content into a ref so the save handler reads the latest buffer
  // even if React state hasn't flushed (same trick as TerminalInput).
  const contentRef = useRef('');

  const load = async () => {
    if (!cwd || !path || !client) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await client.readFile(cwd, path);
      if (r.encoding !== 'text' || typeof r.content !== 'string') {
        setErr('This file is not editable as text.');
        setLoading(false);
        return;
      }
      setContent(r.content);
      contentRef.current = r.content;
      setInitialContent(r.content);
      setInitialMtime(typeof r.mtime === 'number' ? r.mtime : null);
      setInitialSha(typeof r.sha === 'string' ? r.sha : null);
      setLang(r.lang);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, cwd, path]);

  const dirty = content !== initialContent;
  const saveState: 'clean' | 'dirty' | 'saving' = saving ? 'saving' : dirty ? 'dirty' : 'clean';

  const doSave = async (force = false) => {
    if (!client || !cwd || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setErr(null);
    try {
      const r = await client.writeFile(
        cwd,
        path,
        contentRef.current,
        force ? null : initialMtime,
        force ? null : initialSha,
      );
      setInitialContent(contentRef.current);
      setInitialMtime(r.mtime);
      setInitialSha(r.sha);
      setConflict(null);
    } catch (e: unknown) {
      if (isWriteStaleError(e)) {
        setConflict({ currentMtime: e.currentMtime, currentSha: e.currentSha });
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => {
    // Discard-warning UX is intentionally lightweight on mobile: just bounce
    // back. If the user wants the safety, they save first. Mobile reads
    // are cheap and the diff is recoverable from server-side history.
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgPrimary }}>
      <EditorToolbar
        path={path}
        lang={lang ?? null}
        onBack={onBack}
        onSave={() => doSave(false)}
        saveState={saveState}
        onDiff={cwd ? () => {
          router.push({
            pathname: `/m/${machine.machineId}/files/diff`,
            params: { path, cwd },
          });
        } : undefined}
      />
      {err && (
        <View style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: '#2a1011',
          borderBottomWidth: 1,
          borderBottomColor: C.red,
        }}>
          <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>
        </View>
      )}
      {loading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          style={{ flex: 1 }}
        >
          <Highlighted
            content={content}
            lang={lang ?? langFromPath(path)}
            setContent={(t) => { contentRef.current = t; setContent(t); }}
          />
        </KeyboardAvoidingView>
      )}

      <Modal
        visible={conflict !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConflict(null)}
      >
        <View style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.bgSecondary,
            borderTopWidth: 1,
            borderTopColor: C.border,
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            padding: 18,
            paddingBottom: 28,
            gap: 12,
          }}>
            <Text style={{ color: C.amber, fontSize: 13, fontWeight: '600' }}>
              File changed on disk
            </Text>
            <Text style={{ color: C.text, fontSize: 13, lineHeight: 19 }}>
              Another writer modified this file since you opened it. Choose
              how to proceed — overwriting will discard their changes.
            </Text>
            <Pressable
              onPress={() => { setConflict(null); doSave(true); }}
              style={({ pressed }) => ({
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 8,
                backgroundColor: C.red,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' }}>
                Overwrite with my changes
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setConflict(null); load(); }}
              style={({ pressed }) => ({
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: C.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ color: C.text, fontSize: 14, textAlign: 'center' }}>
                Reload from disk (discard my changes)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setConflict(null)}
              style={({ pressed }) => ({
                paddingVertical: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
                Keep editing
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
