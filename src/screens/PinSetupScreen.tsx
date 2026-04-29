import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { LockIcon, ShieldIcon, BackIcon } from '../components/Icons';
import { hashPin, randomSalt } from '../crypto';

const PIN_LENGTH = 4;
type Path = 'choose' | 'pin';

export default function PinSetupScreen() {
  const { theme, vault, updateVault } = useApp();
  const [path, setPath] = useState<Path>('choose');
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<TextInput>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (mounted) setBiometricSupported(hasHw && enrolled);
    })();
    return () => { mounted = false; };
  }, []);

  const filterDigits = (s: string) => s.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);

  const enableBiometric = async () => {
    if (!vault) return;
    setBusy(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to enable biometric unlock',
        fallbackLabel: '',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });
      if (!result.success) {
        Alert.alert('Cancelled', 'Biometric was not enabled.');
        return;
      }
      await updateVault({
        ...vault,
        settings: {
          ...vault.settings,
          appLock: { biometricEnabled: true },
        },
      });
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not enable biometric');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async () => {
    setError('');
    if (pin.length !== PIN_LENGTH) {
      setError(`PIN must be exactly ${PIN_LENGTH} digits.`);
      return;
    }
    if (pin !== confirm) {
      setError("PINs don't match.");
      return;
    }
    if (!vault) return;
    setBusy(true);
    try {
      const salt = randomSalt();
      const pinHash = hashPin(pin, salt);
      await updateVault({
        ...vault,
        settings: {
          ...vault.settings,
          appLock: { biometricEnabled: false, pinHash, salt },
        },
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save PIN');
    } finally {
      setBusy(false);
    }
  };

  // ── PIN entry path ────────────────────────────────────────
  if (path === 'pin') {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg }]}>
        <SafeAreaView style={{ flex: 1 }}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <TouchableOpacity onPress={() => setPath('choose')} style={styles.backBtn}>
              <BackIcon color={theme.accent} size={20} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <View style={{ width: 28 }} />
          </View>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
            enabled={Platform.OS === 'ios'}
          >
            <View style={styles.body}>
              <View style={[styles.badge, { borderColor: theme.accentBorder, backgroundColor: theme.accentBg }]}>
                <LockIcon color={theme.accent} size={26} />
              </View>
              <Text style={[styles.title, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
                Set a 4-digit PIN
              </Text>
              <Text style={[styles.subtitle, { color: theme.textDim, fontFamily: FONTS.body }]}>
                You'll enter this every time you open Cipher.
              </Text>

              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                NEW PIN · {pin.length}/{PIN_LENGTH}
              </Text>
              <TextInput
                ref={pinRef}
                value={pin}
                onChangeText={(s) => setPin(filterDigits(s))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_LENGTH}
                autoFocus
                underlineColorAndroid="transparent"
                style={[
                  styles.pinInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface1, fontFamily: FONTS.mono },
                ]}
              />

              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                CONFIRM PIN
              </Text>
              <TextInput
                value={confirm}
                onChangeText={(s) => setConfirm(filterDigits(s))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_LENGTH}
                underlineColorAndroid="transparent"
                style={[
                  styles.pinInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface1, fontFamily: FONTS.mono },
                ]}
              />

              {error ? (
                <Text style={[styles.error, { color: theme.error, fontFamily: FONTS.body }]}>{error}</Text>
              ) : null}

              <TouchableOpacity
                onPress={submitPin}
                disabled={busy || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH}
                style={[
                  styles.primary,
                  { backgroundColor: theme.accent, borderColor: theme.accentBorder },
                  (busy || pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH) && { opacity: 0.4 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#0a0d14" size="small" />
                ) : (
                  <Text style={[styles.primaryLabel, { fontFamily: FONTS.bodyBold }]}>Set PIN</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  // ── Choose path ───────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.body}>
          <View style={[styles.badge, { borderColor: theme.accentBorder, backgroundColor: theme.accentBg }]}>
            <LockIcon color={theme.accent} size={26} />
          </View>
          <Text style={[styles.title, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
            Secure your app
          </Text>
          <Text style={[styles.subtitle, { color: theme.textDim, fontFamily: FONTS.body }]}>
            Choose how Cipher should unlock. You can pick only one.
          </Text>

          {biometricSupported && (
            <TouchableOpacity
              onPress={enableBiometric}
              disabled={busy}
              style={[styles.choice, { borderColor: theme.accentBorder, backgroundColor: theme.surface1 }]}
            >
              <View style={[styles.choiceIcon, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}>
                <ShieldIcon color={theme.accent} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.choiceTitle, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
                  Biometric
                </Text>
                <Text style={[styles.choiceSub, { color: theme.textDim, fontFamily: FONTS.body }]}>
                  Face / fingerprint / device passcode
                </Text>
              </View>
              {busy ? <ActivityIndicator color={theme.accent} size="small" /> : null}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => setPath('pin')}
            disabled={busy}
            style={[styles.choice, { borderColor: theme.border, backgroundColor: theme.surface1 }]}
          >
            <View style={[styles.choiceIcon, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
              <LockIcon color={theme.text} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.choiceTitle, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
                4-digit PIN
              </Text>
              <Text style={[styles.choiceSub, { color: theme.textDim, fontFamily: FONTS.body }]}>
                Always works, even if biometric fails
              </Text>
            </View>
          </TouchableOpacity>

          {!biometricSupported && (
            <Text style={[styles.hint, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              No biometric hardware enrolled — PIN only
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, width: 28 },
  body: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  badge: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, alignSelf: 'center', marginBottom: 12,
  },
  title: { fontSize: 22, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, textAlign: 'center', marginBottom: 16 },
  label: { fontSize: 10, letterSpacing: 1.2, marginTop: 8 },
  pinInput: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 22, letterSpacing: 8,
    textAlign: 'center',
  },
  error: { fontSize: 13, textAlign: 'center' },
  primary: {
    borderWidth: 1, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
    marginTop: 8,
  },
  primaryLabel: { fontSize: 15, color: '#0a0d14' },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  choiceIcon: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  choiceTitle: { fontSize: 15 },
  choiceSub: { fontSize: 12, marginTop: 2 },
  hint: { fontSize: 10, letterSpacing: 1, textAlign: 'center', marginTop: 6 },
});
