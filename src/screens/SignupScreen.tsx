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

type Props = { navigation: StackNavigationProp<AuthStackParams, 'Signup'> };

export default function SignupScreen({ navigation }: Props) {
  const { signup } = useApp();
  const theme = THEMES.cyan;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tag, setTag] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cleanTag = (tag || username).toLowerCase().replace(/[^a-z0-9_.]/g, '');
  const passwordsMatch = !confirm || password === confirm;
  const valid =
    username.length >= 3 &&
    password.length >= 6 &&
    password === confirm &&
    cleanTag.length >= 3;

  const submit = async () => {
    if (!valid) return;
    setLoading(true);
    setError('');
    try {
      await signup(username, password, displayName, cleanTag);
    } catch (e: any) {
      setError(e.message || 'Signup failed');
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
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
                  colors={[theme.accentBg, theme.accentBorder]}
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
                Create account
              </Text>
              <Text style={[styles.formSub, { color: theme.textDim, fontFamily: FONTS.body }]}>
                Pick a username and a unique @tag
              </Text>

              <View style={styles.fields}>
                <Input
                  label="Username"
                  value={username}
                  onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                  placeholder="min 3 characters"
                  theme={theme}
                />
                <Input
                  label="Display name"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="optional"
                  autoCapitalize="words"
                  theme={theme}
                />
                <Input
                  label="@tag — how friends find you"
                  value={tag}
                  onChangeText={(v) => setTag(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                  placeholder={username || 'yourtag'}
                  prefix="@"
                  theme={theme}
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="min 6 characters"
                  secureTextEntry
                  theme={theme}
                />
                <Input
                  label="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="repeat password"
                  secureTextEntry
                  theme={theme}
                />

                {!passwordsMatch && (
                  <Text style={[styles.mismatch, { fontFamily: FONTS.body }]}>
                    Passwords don't match
                  </Text>
                )}

                {error ? (
                  <View style={[styles.errorBox, { borderColor: 'rgba(248,113,113,0.4)', backgroundColor: 'rgba(248,113,113,0.08)' }]}>
                    <Text style={[styles.errorText, { fontFamily: FONTS.body }]}>{error}</Text>
                  </View>
                ) : null}

                <Button
                  onPress={submit}
                  disabled={!valid}
                  loading={loading}
                  full
                  theme={theme}
                >
                  Create account
                </Button>
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: theme.textDim, fontFamily: FONTS.body }]}>
                Already have one?
              </Text>
              <TouchableOpacity onPress={() => navigation.goBack()}>
                <Text style={[styles.footerLink, { color: theme.accent, fontFamily: FONTS.bodySemiBold }]}>
                  Sign in
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  logoSection: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 28,
  },
  logoWrap: {
    marginBottom: 14,
    shadowColor: '#22d3ee',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  logoGradient: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: { fontSize: 26, letterSpacing: -0.5, marginBottom: 4 },
  tagline: { fontSize: 13 },
  formSection: { marginBottom: 24 },
  formTitle: { fontSize: 22, letterSpacing: -0.5, marginBottom: 4 },
  formSub: { fontSize: 13, marginBottom: 20 },
  fields: { gap: 12 },
  mismatch: { fontSize: 12, color: '#f87171' },
  errorBox: { borderWidth: 1, borderRadius: 8, padding: 10 },
  errorText: { fontSize: 12, color: '#f87171' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingTop: 20,
  },
  footerText: { fontSize: 13 },
  footerLink: { fontSize: 13, paddingHorizontal: 4 },
});
