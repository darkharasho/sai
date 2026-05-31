// Renders code as a single RN <Text> with nested colored spans, derived
// from the highlight.js tokenizer in lib/highlight.ts. Two consumers:
//
//   <SyntaxHighlight … />              standalone display (file viewer)
//   <TextInput>{highlightedSpans(…)}</TextInput>
//                                       inline children inside an editor —
//                                       RN renders the styled spans while
//                                       still firing onChangeText on input
//                                       (the children's combined text MUST
//                                       equal value or RN drops them).
import { useMemo } from 'react';
import { Text, type TextStyle } from 'react-native';
import { colorForClass, tokenize } from '../lib/highlight';
import { FONT } from '../lib/fonts';

interface Props {
  code: string;
  lang?: string;
  style?: TextStyle;
  baseColor?: string;
}

export function highlightedSpans(code: string, lang: string | undefined): React.ReactNode[] {
  const tokens = tokenize(code, lang);
  return tokens.map((t, i) => {
    const color = colorForClass(t.cls);
    if (!color) return t.text;
    return (
      <Text key={i} style={{ color }}>
        {t.text}
      </Text>
    );
  });
}

export function SyntaxHighlight({
  code, lang, style, baseColor = '#c9d1d9',
}: Props) {
  const spans = useMemo(() => highlightedSpans(code, lang), [code, lang]);
  return (
    <Text
      selectable
      style={{
        fontFamily: FONT.mono,
        fontSize: 13,
        lineHeight: 18,
        color: baseColor,
        ...style,
      }}
    >
      {spans}
    </Text>
  );
}
