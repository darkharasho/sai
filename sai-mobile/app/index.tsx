import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { useMachines } from '../lib/machinesStore';
import { onboardingFlag } from '../lib/onboardingFlag';
import { MachineRow } from '../components/MachineRow';
import { useReachabilityPoll } from '../lib/reachability';
import { unpair } from '../lib/wire';

export default function Index() {
  const machines = useMachines((s) => s.machines);
  const loaded = useMachines((s) => s.loaded);
  const refresh = useMachines((s) => s.refresh);
  const remove = useMachines((s) => s.remove);
  const getToken = useMachines((s) => s.getToken);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    if (machines.length === 0) {
      (async () => {
        if (!(await onboardingFlag.seen())) router.replace('/onboarding');
        else router.replace('/scan');
      })();
    }
  }, [loaded, machines.length]);

  useReachabilityPoll(30_000);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(id); }, []);

  if (!loaded) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0e1114] px-4">
      <View className="flex-row items-center justify-between py-3">
        <Text className="text-white text-2xl font-semibold">Machines</Text>
        <Pressable onPress={() => router.push('/scan')} className="bg-[#c7910c] rounded-full p-2">
          <Plus size={20} color="#000" />
        </Pressable>
      </View>
      <FlatList
        data={machines}
        keyExtractor={(m) => m.machineId}
        renderItem={({ item }) => (
          <MachineRow
            m={item}
            online={item.lastSeenAt != null && (now - item.lastSeenAt) < 60_000}
            onPress={() => router.push(`/m/${item.machineId}`)}
            onLongPress={() => Alert.alert(item.label, undefined, [
              { text: 'Unpair', style: 'destructive', onPress: async () => {
                const tok = await getToken(item.machineId);
                if (tok) await unpair(item.hostUrl, item.deviceId, tok).catch(() => {});
                await remove(item.machineId);
              }},
              { text: 'Cancel', style: 'cancel' },
            ])}
          />
        )}
      />
    </SafeAreaView>
  );
}
