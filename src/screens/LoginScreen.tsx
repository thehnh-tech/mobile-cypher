import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { FONTS, THEMES } from '../theme';
import { AuthStackParams } from '../navigation';
import Input from '../components/Input';
import Button from '../components/Button';
import Svg, { Path } from 'react-native-svg';

type Props = { navigation: StackNavigationProp<AuthStackParams, 'Login'> };

export default function LoginScreen({ navigation }: Props) {
  const { login } = useApp();
  const theme = THEMES.cyan;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!username || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(username, password);
    } catch (e: any) {
      setError(e.message || 'Login failed');
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* Subtle grid bg */}
      <View style={[styles.gridBg, { borderColor: theme.accent, pointerEvents: 'none' }]} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          enabled={Platform.OS === 'ios'}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo */}
            <View style={styles.logoSection}>
              <View style={styles.logoWrap}>
                <LinearGradient
                  colors={[`${theme.accentBg}`, `${theme.accentBorder}`]}
                  style={styles.logoGradient}
                >
                  <Svg width={36} height={36} viewBox="0 0 36 36" fill="none">
                    <Path
                      d="M6 10a4 4 0 014-4h16a4 4 0 014 4v12a4 4 0 01-4 4h-12l-6 5v-5h-2a4 4 0 01-4-4V10z"
                      fill="white"
                      fillOpacity={0.95}
                    />
                  </Svg>
                </LinearGradient>
              </View>
              <Text style={[styles.appName, { color: theme.text, fontFamily: FONTS.bodyBold }]}>Cipher</Text>
              <Text style={[styles.tagline, { color: theme.textDim, fontFamily: FONTS.body }]}>
                Chat with friends, privately.
              </Text>
            </View>

            {/* Form */}
            <View style={styles.formSection}>
              <Text style={[styles.formTitle, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
                Welcome back
              </Text>
              <Text style={[styles.formSub, { color: theme.textDim, fontFamily: FONTS.body }]}>
                Sign in to continue
              </Text>

              <View style={styles.fields}>
                <Input
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  placeholder="your username"
                  theme={theme}
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  theme={theme}
                />

                {error ? (
                  <View style={[styles.errorBox, { borderColor: 'rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.08)' }]}>
                    <Text style={[styles.errorText, { fontFamily: FONTS.body }]}>{error}</Text>
                  </View>
                ) : null}

                <Button
                  onPress={submit}
                  disabled={!username || !password}
                  loading={loading}
                  full
                  theme={theme}
                >
                  Sign in
                </Button>
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: theme.textDim, fontFamily: FONTS.body }]}>
                New to Cipher?
              </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                <Text style={[styles.footerLink, { color: theme.accent, fontFamily: FONTS.bodySemiBold }]}>
                  Create account
                </Text>
              </TouchableOpacity>
            </View>

            {/* Fingerprint badge */}
            <View style={styles.encryptBadge}>
              <View style={[styles.badge, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}>
                <Text style={[styles.badgeText, { color: theme.accent, fontFamily: FONTS.mono }]}>
                  ■ End-to-end encrypted
                </Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gridBg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.04,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 36,
  },
  logoWrap: {
    marginBottom: 14,
    shadowColor: '#22d3ee',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  logoGradient: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 28,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 13,
  },
  formSection: {
    marginBottom: 24,
  },
  formTitle: {
    fontSize: 22,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  formSub: {
    fontSize: 13,
    marginBottom: 24,
  },
  fields: {
    gap: 14,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 'auto',
    paddingTop: 24,
  },
  footerText: { fontSize: 13 },
  footerLink: { fontSize: 13, paddingHorizontal: 4 },
  encryptBadge: {
    alignItems: 'center',
    marginTop: 16,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 9,
    letterSpacing: 1,
  },
});
