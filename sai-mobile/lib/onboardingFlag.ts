import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'sai-mobile-onboarded';
export const onboardingFlag = {
  async seen(): Promise<boolean> { return (await AsyncStorage.getItem(KEY)) === '1'; },
  async mark(): Promise<void> { await AsyncStorage.setItem(KEY, '1'); },
};
