import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FONTS, Theme } from '../theme';

export interface ToastItem {
  id: string;
  text: string;
  kind: 'message' | 'request' | 'info';
}

interface ToastHostProps {
  toasts: ToastItem[];
  theme: Theme;
}

function ToastBubble({ item, theme }: { item: ToastItem; theme: Theme }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: theme.surface1,
          borderColor: theme.accentBorder,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: theme.accent }]} />
      <Text style={[styles.text, { color: theme.text, fontFamily: FONTS.body }]} numberOfLines={2}>
        {item.text}
      </Text>
    </Animated.View>
  );
}

export function ToastHost({ toasts, theme }: ToastHostProps) {
  if (toasts.length === 0) return null;
  return (
    <SafeAreaView pointerEvents="none" style={styles.host}>
      <View style={styles.stack} pointerEvents="none">
        {toasts.map((t) => (
          <ToastBubble key={t.id} item={t} theme={theme} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stack: {
    paddingTop: 8,
    gap: 8,
    width: '92%',
    maxWidth: 480,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: { flex: 1, fontSize: 13 },
});
