import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface AvatarProps {
  hue: number;
  size?: number;
  label?: string;
  glow?: boolean;
}

export default function Avatar({ hue, size = 40, label = '?', glow = true }: AvatarProps) {
  const initials = (label || '?')
    .split(/[\s_.\-@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

  const borderRadius = size * 0.28;
  const fontSize = size * 0.38;

  const c1 = hslToHex(hue, 55, 28);
  const c2 = hslToHex((hue + 60) % 360, 50, 18);
  const c3 = hslToHex((hue + 30) % 360, 60, 22);
  const shadowColor = hslToHex(hue, 70, 55);

  return (
    <View
      style={[
        styles.wrapper,
        { width: size, height: size, borderRadius },
        glow && {
          shadowColor,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 8,
          elevation: 6,
        },
      ]}
    >
      <LinearGradient
        colors={[c1, c2, c3, c1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius }]}
      />
      <Text style={[styles.initials, { fontSize, color: hslToHex(hue, 80, 90) }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontFamily: 'JetBrainsMono-Bold',
    letterSpacing: -0.5,
    zIndex: 1,
  },
});
