import React, { useState, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { Theme, FONTS } from '../theme';

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  prefix?: string;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  theme: Theme;
  returnKeyType?: 'done' | 'next' | 'search' | 'send';
  onSubmitEditing?: () => void;
}

export default function Input({
  label, value, onChangeText, placeholder, secureTextEntry = false,
  prefix, autoFocus = false, autoCapitalize = 'none', theme,
  returnKeyType, onSubmitEditing,
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: theme.textDim }]}>{label}</Text>
      )}
      {/* TouchableWithoutFeedback ensures the whole row is tappable, not just the text cursor area */}
      <TouchableWithoutFeedback onPress={() => inputRef.current?.focus()}>
        <View
          style={[
            styles.inputRow,
            { backgroundColor: theme.surface1, borderColor: focused ? theme.accent : theme.border },
            focused && {
              shadowColor: theme.accent,
              shadowOpacity: 0.4,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            },
          ]}
        >
          {prefix && (
            <Text style={[styles.prefix, { color: theme.accent }]}>{prefix}</Text>
          )}
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.textDim}
            secureTextEntry={secureTextEntry}
            autoFocus={autoFocus}
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            spellCheck={false}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={[styles.input, { color: theme.text, fontFamily: FONTS.body }]}
            // These two are critical on Android to avoid touch area issues
            underlineColorAndroid="transparent"
            textAlignVertical="center"
          />
        </View>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    // paddingVertical instead of height — lets TextInput define its own size
    // This avoids the '100%' height issue on Android
    paddingVertical: 12,
    minHeight: 50,
  },
  prefix: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 14,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    // No height: '100%' — that collapses tappable area on Android
    padding: 0,
    margin: 0,
  },
});
