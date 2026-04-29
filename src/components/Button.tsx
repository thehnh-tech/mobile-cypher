import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { Theme } from '../theme';

interface ButtonProps {
  children: string;
  onPress: () => void;
  theme: Theme;
  variant?: 'primary' | 'ghost' | 'danger';
  full?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export default function Button({
  children, onPress, theme, variant = 'primary',
  full = false, disabled = false, loading = false, style,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
      style={[
        styles.base,
        full && styles.full,
        isPrimary && { backgroundColor: theme.accent, shadowColor: theme.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
        variant === 'ghost' && { borderWidth: 1, borderColor: theme.accentBorder, backgroundColor: theme.accentBg },
        isDanger && { borderWidth: 1, borderColor: 'rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.08)' },
        (disabled || loading) && { opacity: 0.4 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#0a0d14' : theme.accent} size="small" />
      ) : (
        <Text
          style={[
            styles.label,
            isPrimary && { color: '#0a0d14' },
            variant === 'ghost' && { color: theme.accent },
            isDanger && { color: theme.error },
          ]}
        >
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  full: {
    width: '100%',
  },
  label: {
    fontFamily: 'JetBrainsMono-Bold',
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
