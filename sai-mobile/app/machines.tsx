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
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1114' }}>
        <ActivityIndicator color="#c7910c" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0e1114', paddingHorizontal: 16 }}>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
      }}>
        <Text style={{ color: '#ffffff', fontSize: 24, fontWeight: '600' }}>Machines</Text>
        <Pressable
          onPress={() => router.push('/scan')}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#a5780a' : '#c7910c',
            borderRadius: 999,
            padding: 8,
          })}
        >
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
            onLongPress={() =>
              Alert.alert(item.label, undefined, [
                {
                  text: 'Unpair',
                  style: 'destructive',
                  onPress: async () => {
                    const tok = await getToken(item.machineId);
                    if (tok) await unpair(item.hostUrl, item.deviceId, tok).catch(() => {});
                    await remove(item.machineId);
                  },
                },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
          />
        )}
      />
    </SafeAreaView>
  );
}
