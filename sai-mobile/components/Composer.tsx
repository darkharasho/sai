import { useState } from 'react';
import { View, TextInput, Pressable, Text, Image, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ImagePlus, Send } from 'lucide-react-native';

export interface ComposerProps {
  disabled: boolean;
  onSend(text: string, images: string[]): void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: false, quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const resized = await ImageManipulator.manipulateAsync(
      a.uri,
      [{ resize: { width: 1568 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (resized.base64) {
      setImages((prev) => [...prev, `data:image/jpeg;base64,${resized.base64}`]);
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t && images.length === 0) return;
    onSend(t, images);
    setText('');
    setImages([]);
  };

  return (
    <View className="border-t border-[#1e2228] bg-[#0c0f11] px-3 py-2">
      {images.length > 0 ? (
        <ScrollView horizontal className="mb-2" showsHorizontalScrollIndicator={false}>
          {images.map((src, i) => (
            <View key={i} className="mr-2 relative">
              <Image source={{ uri: src }} style={{ width: 60, height: 60, borderRadius: 8 }} />
              <Pressable onPress={() => setImages((p) => p.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 bg-black rounded-full px-1.5">
                <Text className="text-white text-xs">×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View className="flex-row items-end gap-2">
        <Pressable onPress={pick} disabled={disabled} className="p-2">
          <ImagePlus size={20} color={disabled ? '#475262' : '#a0acbb'} />
        </Pressable>
        <TextInput
          className="flex-1 bg-[#161a1f] text-white rounded-2xl px-3 py-2.5 max-h-32"
          placeholder="Message SAI"
          placeholderTextColor="#5a6a7a"
          value={text}
          onChangeText={setText}
          multiline
          editable={!disabled}
        />
        <Pressable onPress={send} disabled={disabled} className="bg-[#c7910c] rounded-full p-2.5">
          <Send size={18} color="#000" />
        </Pressable>
      </View>
    </View>
  );
}
