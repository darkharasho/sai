import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
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
  const [assetUri, setAssetUri] = useState<string | null>(null);
  const [bearer, setBearer] = useState<{ token: string; deviceId: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const machine = machines.find((m) => m.machineId === machineId);

  useEffect(() => { refresh(); }, [refresh]);

  // Resolve the bundled PWA asset to a local file URI. We pass this URI
  // directly to WebView (much faster + lighter than reading the 3MB HTML
  // into JS state and serving it via source={{ html }}).
  useEffect(() => {
    (async () => {
      try {
        const asset = Asset.fromModule(require('../../../assets/pwa/inlined.html'));
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error('asset has no uri');
        setAssetUri(uri);
      } catch (e: any) {
        setError(`PWA asset load failed: ${String(e?.message ?? e)}`);
      }
    })();
  }, []);

  // Resolve the per-machine bearer from secure storage.
  useEffect(() => {
    if (!machineId || !machine) return;
    getToken(machineId).then((token) => {
      if (token) setBearer({ token, deviceId: machine.deviceId, label: machine.label });
      else setError('No bearer token stored for this machine. Re-pair from the machine list.');
    });
  }, [machineId, machine, getToken]);

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0e1114', padding: 20 }} edges={['top']}>
        <Pressable onPress={() => router.replace('/')} hitSlop={8} style={{ marginBottom: 16 }}>
          <Text style={{ color: '#c7910c', fontSize: 14 }}>← Back</Text>
        </Pressable>
        <Text style={{ color: '#E35535', fontSize: 14, marginBottom: 8, fontWeight: '600' }}>
          Could not open machine
        </Text>
        <Text style={{ color: '#a0acbb', fontSize: 12 }}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (!machine || !bearer || !assetUri) {
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
        <Pressable onPress={() => router.replace('/machines')} hitSlop={8} style={{ padding: 6 }}>
          <ChevronLeft size={20} color="#bec6d0" />
        </Pressable>
        <Text
          style={{ color: '#fff', fontSize: 14, fontWeight: '500', marginLeft: 4, flex: 1 }}
          numberOfLines={1}
        >
          {machine.label}
        </Text>
      </View>
      <WebView
        originWhitelist={['*']}
        source={{ uri: assetUri }}
        injectedJavaScriptBeforeContentLoaded={inject}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowsBackForwardNavigationGestures
        style={{ flex: 1, backgroundColor: '#0e1114' }}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        webviewDebuggingEnabled
        onError={(e) => setError(`WebView error: ${e.nativeEvent.description}`)}
      />
    </SafeAreaView>
  );
}
