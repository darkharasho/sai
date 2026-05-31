import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { ChevronLeft } from 'lucide-react-native';
import { useMachines } from '../../../lib/machinesStore';

// Per-machine screen. We no longer render a native chat/terminal/files UI;
// the bundled SAI PWA is loaded inside a WebView and given a host override +
// bearer via window globals (see src/renderer-remote/wire.ts → bridgeBase()).
export default function MachineWebView() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>();
  const machines = useMachines((s) => s.machines);
  const getToken = useMachines((s) => s.getToken);
  const refresh = useMachines((s) => s.refresh);
  const [html, setHtml] = useState<string | null>(null);
  const [bearer, setBearer] = useState<{ token: string; deviceId: string; label: string } | null>(null);

  const machine = machines.find((m) => m.machineId === machineId);

  useEffect(() => { refresh(); }, [refresh]);

  // Load the bundled PWA HTML into memory once.
  useEffect(() => {
    (async () => {
      const asset = Asset.fromModule(require('../../../assets/pwa/inlined.html'));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const content = await readAsStringAsync(uri);
      setHtml(content);
    })().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[pwa] load fail', e);
    });
  }, []);

  // Resolve the per-machine bearer from secure storage.
  useEffect(() => {
    if (!machineId || !machine) return;
    getToken(machineId).then((token) => {
      if (token) setBearer({ token, deviceId: machine.deviceId, label: machine.label });
    });
  }, [machineId, machine, getToken]);

  if (!machine || !bearer || !html) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1114' }}>
        <ActivityIndicator color="#c7910c" />
      </View>
    );
  }

  // Run this before any PWA bundle code so loadBearer() / bridgeBase() see it.
  const inject = `
    window.SAI_BRIDGE_HOST = ${JSON.stringify(machine.hostUrl)};
    window.SAI_INJECTED_BEARER = ${JSON.stringify(bearer)};
    true;
  `;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0e1114' }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: '#1e2228',
          backgroundColor: '#0c0f11',
        }}
      >
        <Pressable onPress={() => router.replace('/')} hitSlop={8} style={{ padding: 6 }}>
          <ChevronLeft size={20} color="#bec6d0" />
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '500', marginLeft: 4 }} numberOfLines={1}>
          {machine.label}
        </Text>
      </View>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: machine.hostUrl }}
        injectedJavaScriptBeforeContentLoaded={inject}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        style={{ flex: 1, backgroundColor: '#0e1114' }}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        webviewDebuggingEnabled
      />
    </SafeAreaView>
  );
}
