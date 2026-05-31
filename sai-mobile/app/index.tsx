import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useMachines } from '../lib/machinesStore';
import { onboardingFlag } from '../lib/onboardingFlag';

// Root route. We don't render the machine list here anymore — it's at
// /machines. The user lands on the most-recently-used machine's PWA on app
// launch (the common case). If nothing is paired, we route to onboarding or
// scan. If multiple machines exist, we still pick the most recently seen.
export default function Index() {
  const machines = useMachines((s) => s.machines);
  const loaded = useMachines((s) => s.loaded);
  const refresh = useMachines((s) => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      if (machines.length === 0) {
        if (!(await onboardingFlag.seen())) router.replace('/onboarding');
        else router.replace('/scan');
        return;
      }
      // Pick the most recently seen (or first if none have been pinged yet).
      const sorted = [...machines].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
      router.replace(`/m/${sorted[0].machineId}`);
    })();
  }, [loaded, machines]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1114' }}>
      <ActivityIndicator color="#c7910c" />
    </View>
  );
}
