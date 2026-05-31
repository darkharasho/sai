import { useState, useCallback } from 'react';
import { View, Text, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { uuid } from '../shims/uuid';
import { pair, parsePairingUrl, isAllowedPairHost } from '../lib/wire';
import { useMachines } from '../lib/machinesStore';
import { deviceLabel } from '../lib/deviceLabel';
import { PairErrorCard, type PairErrorKind } from '../components/PairErrorCard';

export default function Scan() {
  const [perm, requestPerm] = useCameraPermissions();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualUrl, setManualUrl] = useState('');
  const [error, setError] = useState<{ kind: PairErrorKind; detail?: string } | null>(null);
  const [pairing, setPairing] = useState(false);
  const add = useMachines((s) => s.add);

  const onPair = useCallback(async (raw: string) => {
    if (pairing) return;
    setPairing(true);
    setError(null);
    try {
      const parsed = parsePairingUrl(raw);
      if (!parsed) { setError({ kind: 'code-invalid' }); return; }
      const host = new URL(parsed.baseUrl).hostname;
      if (!isAllowedPairHost(host)) { setError({ kind: 'host-rejected', detail: host }); return; }
      const result = await pair(parsed.baseUrl, parsed.code, deviceLabel(), uuid());
      const machine = await add({
        label: host,
        hostUrl: parsed.baseUrl,
        deviceId: result.deviceId,
        token: result.token,
      });
      router.replace(`/m/${machine.machineId}/chat`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('Network request failed')) setError({ kind: 'network', detail: msg });
      else if (msg.includes('410') || msg.includes('expired')) setError({ kind: 'code-expired', detail: msg });
      else if (msg.includes('400') || msg.includes('401')) setError({ kind: 'code-invalid', detail: msg });
      else setError({ kind: 'unknown', detail: msg });
    } finally {
      setPairing(false);
    }
  }, [add, pairing]);

  if (!perm) return <SafeAreaView className="flex-1 bg-[#0e1114]" />;
  if (!perm.granted) {
    return (
      <SafeAreaView className="flex-1 bg-[#0e1114] px-6 justify-center gap-4">
        <Text className="text-white text-xl">Camera access</Text>
        <Text className="text-[#bec6d0]">SAI uses the camera to scan pair codes from your desktop.</Text>
        <Pressable className="bg-[#c7910c] rounded-xl py-3 items-center" onPress={requestPerm}>
          <Text className="text-black font-semibold">Enable camera</Text>
        </Pressable>
        <Pressable className="py-3 items-center" onPress={() => setMode('manual')}>
          <Text className="text-[#a0acbb]">Enter pair URL manually</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0e1114]">
      {mode === 'camera' ? (
        <View className="flex-1">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={pairing ? undefined : (r) => onPair(r.data)}
          />
          <View className="absolute top-12 left-0 right-0 items-center">
            <Text className="text-white bg-black/50 px-3 py-1 rounded-full">Scan SAI pair code</Text>
          </View>
          <Pressable className="absolute bottom-10 self-center bg-black/60 px-4 py-2 rounded-full" onPress={() => setMode('manual')}>
            <Text className="text-white">Enter pair URL manually</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView className="flex-1 px-6 justify-center gap-4" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text className="text-white text-xl">Paste pair URL</Text>
          <TextInput
            value={manualUrl}
            onChangeText={setManualUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://...ts.net/?code=..."
            placeholderTextColor="#5a6a7a"
            className="bg-[#161a1f] text-white rounded-xl px-4 py-3 border border-[#1e2228]"
          />
          <Pressable className="bg-[#c7910c] rounded-xl py-3 items-center" onPress={() => onPair(manualUrl)}>
            <Text className="text-black font-semibold">{pairing ? 'Pairing…' : 'Pair'}</Text>
          </Pressable>
          <Pressable className="py-3 items-center" onPress={() => setMode('camera')}>
            <Text className="text-[#a0acbb]">Back to scanner</Text>
          </Pressable>
        </KeyboardAvoidingView>
      )}
      {error ? (
        <View className="absolute bottom-32 left-4 right-4">
          <PairErrorCard kind={error.kind} detail={error.detail} onRetry={() => setError(null)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
