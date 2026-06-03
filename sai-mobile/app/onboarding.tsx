import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onboardingFlag } from '../lib/onboardingFlag';

export default function Onboarding() {
  return (
    <SafeAreaView className="flex-1 bg-[#0e1114] px-6">
      <View className="flex-1 justify-center gap-6">
        <Text className="text-white text-3xl font-semibold">Welcome to SAI</Text>
        <Text className="text-[#bec6d0] text-base leading-6">
          SAI mobile connects to your desktop SAI over your Tailscale network. Before you pair:
        </Text>
        <View className="gap-3">
          <Text className="text-[#bec6d0] text-base">1. Install Tailscale on this phone and sign in.</Text>
          <Text className="text-[#bec6d0] text-base">2. Open SAI on your desktop and enable Mobile Remote.</Text>
          <Text className="text-[#bec6d0] text-base">3. Generate a pair code on desktop and scan it below.</Text>
        </View>
      </View>
      <Pressable
        className="bg-[#c7910c] rounded-xl py-4 mb-6 items-center"
        onPress={async () => { await onboardingFlag.mark(); router.replace('/scan'); }}
      >
        <Text className="text-black font-semibold text-base">Continue</Text>
      </Pressable>
    </SafeAreaView>
  );
}
