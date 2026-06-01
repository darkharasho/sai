import { useEffect, useState } from 'react';
import { useLocalSearchParams, Tabs, router } from 'expo-router';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MessageSquare, Terminal as TermIcon, FileText } from 'lucide-react-native';
import { useMachines } from '../../../lib/machinesStore';
import { ConnectionProvider, useConn } from '../../../lib/connection';

function StatePill() {
  const { state } = useConn();
  const color = state === 'open' ? '#00a884' : state === 'opening' ? '#c7910c' : '#E35535';
  const label = state === 'open' ? 'connected' : state === 'opening' ? 'connecting…' : 'offline';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: '#a0acbb', fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Header() {
  const { machine } = useConn();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#1e2228',
        backgroundColor: '#0c0f11',
        gap: 4,
      }}
    >
      <Pressable onPress={() => router.replace('/')} hitSlop={8} style={{ padding: 6 }}>
        <ChevronLeft size={20} color="#bec6d0" />
      </Pressable>
      <Text
        numberOfLines={1}
        style={{ color: '#fff', fontSize: 16, fontWeight: '500', flex: 1, marginLeft: 4 }}
      >
        {machine.label}
      </Text>
      <StatePill />
    </View>
  );
}

function Inner() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0e1114' }} edges={['top']}>
      <Header />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#0c0f11', borderTopColor: '#1e2228' },
          tabBarActiveTintColor: '#c7910c',
          tabBarInactiveTintColor: '#5a6a7a',
        }}
      >
        <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color }) => <MessageSquare size={20} color={color} /> }} />
        <Tabs.Screen name="terminal" options={{ title: 'Terminal', tabBarIcon: ({ color }) => <TermIcon size={20} color={color} /> }} />
        <Tabs.Screen name="files" options={{ title: 'Files', tabBarIcon: ({ color }) => <FileText size={20} color={color} /> }} />
      </Tabs>
    </SafeAreaView>
  );
}

export default function MachineLayout() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>();
  const machines = useMachines((s) => s.machines);
  const getToken = useMachines((s) => s.getToken);
  const refresh = useMachines((s) => s.refresh);
  const [token, setToken] = useState<string | null>(null);
  const machine = machines.find((m) => m.machineId === machineId);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!machineId) return;
    getToken(machineId).then(setToken);
  }, [machineId, getToken]);

  if (!machine || !token) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }
  return (
    <ConnectionProvider machine={machine} token={token}>
      <Inner />
    </ConnectionProvider>
  );
}
