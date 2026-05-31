import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useMachines } from '../lib/machinesStore';
import { onboardingFlag } from '../lib/onboardingFlag';

export default function Index() {
  const machines = useMachines((s) => s.machines);
  const loaded = useMachines((s) => s.loaded);
  const refresh = useMachines((s) => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      if (machines.length > 0) return;          // MachineList screen renders next
      if (!(await onboardingFlag.seen())) router.replace('/onboarding');
      else router.replace('/scan');
    })();
  }, [loaded, machines.length]);

  // If we have machines, fall through to MachineList screen (added in Task 17).
  if (!loaded || machines.length === 0) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }
  return <View className="flex-1 bg-[#0e1114]" />; // placeholder until Task 17
}
