import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { LockIcon, ShieldIcon } from '../components/Icons';
import { hashPin } from '../crypto';
import { pinAttempts } from '../pinAttemptStorage';
import { MAX_PIN_ATTEMPTS, PinAttemptState } from '../pinAttempts';

const PIN_LENGTH = 4;

export default function LockScreen() {
  const { theme, vault, unlock, logout } = useApp();
  const lockCfg = vault?.settings?.appLock;
  const userId = vault?.profile.id;
  const isBiometric = !!lockCfg?.biometricEnabled;

  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attemptState, setAttemptState] = useState<PinAttemptState>({ attempts: 0, blockedUntil: 0 });
  const [attemptsReady, setAttemptsReady] = useState(false);
  const [checkingPin, setCheckingPin] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [bioRunning, setBioRunning] = useState(false);
  const [bioCancelled, setBioCancelled] = useState(false);
  const pinRef = useRef<TextInput>(null);
  const autoTriedRef = useRef(false);
  const checkingPinRef = useRef(false);
  const secondsRemaining = Math.max(0, Math.ceil((attemptState.blockedUntil - now) / 1000));

  useEffect(() => {
    if (isBiometric || !userId) return;
    let active = true;
    setAttemptsReady(false);
    pinAttempts.read(userId).then((state) => {
      if (!active) return;
      setAttemptState(state);
      setAttemptsReady(true);
    }).catch(() => {
      if (active) setError('PIN protection is unavailable. Log out and sign in with your password.');
    });
    return () => { active = false; };
  }, [isBiometric, userId]);

  useEffect(() => {
    if (!attemptState.blockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [attemptState.blockedUntil]);

  const tryBiometric = useCallback(async () => {
    if (!isBiometric || bioRunning) return;
    setBioRunning(true);
    setError('');
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) {
        setError('Biometric unavailable on this device');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Cipher',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        unlock();
      } else {
        setBioCancelled(true);
      }
    } catch {
      setError('Device authentication failed. Try again or log out.');
      setBioCancelled(true);
    } finally {
      setBioRunning(false);
    }
  }, [isBiometric, bioRunning, unlock]);

  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (isBiometric) {
      void tryBiometric();
    } else {
      setTimeout(() => pinRef.current?.focus(), 100);
    }
  }, [isBiometric, tryBiometric]);

  const submitPin = useCallback(
    async (digits: string) => {
      if (!lockCfg || isBiometric || !userId || !attemptsReady || checkingPinRef.current) return;
      if (!lockCfg.pinHash || !lockCfg.salt) return;
      if (digits.length !== PIN_LENGTH) return;
      if (attemptState.blockedUntil > Date.now()) return;
      checkingPinRef.current = true;
      setCheckingPin(true);
      try {
        const nextState = await pinAttempts.begin(userId);
        setAttemptState(nextState);
        setNow(Date.now());
        if (hashPin(digits, lockCfg.salt) === lockCfg.pinHash) {
          await pinAttempts.clear(userId);
          setError('');
          unlock();
        } else {
          setError('Incorrect PIN');
        }
      } catch {
        setAttemptsReady(false);
        setError('PIN protection is unavailable. Log out and sign in with your password.');
      } finally {
        setPin('');
        checkingPinRef.current = false;
        setCheckingPin(false);
      }
    },
    [lockCfg, isBiometric, userId, attemptsReady, attemptState.blockedUntil, unlock],
  );

  const onChangePin = (s: string) => {
    const digits = s.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);
    setPin(digits);
    if (digits.length === PIN_LENGTH) void submitPin(digits);
  };

  const showLogout = isBiometric ? bioCancelled : !attemptsReady || attemptState.attempts >= MAX_PIN_ATTEMPTS;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          enabled={Platform.OS === 'ios'}
        >
          <View style={styles.body}>
            <View style={[styles.badge, { borderColor: theme.accentBorder, backgroundColor: theme.accentBg }]}>
              {isBiometric ? (
                <ShieldIcon color={theme.accent} size={26} />
              ) : (
                <LockIcon color={theme.accent} size={26} />
              )}
            </View>
            <Text style={[styles.title, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
              Cipher locked
            </Text>
            <Text style={[styles.subtitle, { color: theme.textDim, fontFamily: FONTS.body }]}>
              {isBiometric
                ? 'Authenticate with your device biometric'
                : 'Enter your 4-digit PIN'}
            </Text>

            {isBiometric ? (
              <TouchableOpacity
                onPress={tryBiometric}
                disabled={bioRunning}
                style={[
                  styles.bioBtn,
                  { borderColor: theme.accentBorder, backgroundColor: theme.accentBg },
                  bioRunning && { opacity: 0.6 },
                ]}
              >
                <ShieldIcon color={theme.accent} size={14} />
                <Text style={[styles.bioLabel, { color: theme.accent, fontFamily: FONTS.bodySemiBold }]}>
                  {bioRunning ? 'Authenticating…' : bioCancelled ? 'Try again' : 'Unlock'}
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                  PIN · {pin.length}/{PIN_LENGTH}
                </Text>
                <TextInput
                  ref={pinRef}
                  value={pin}
                  onChangeText={onChangePin}
                  editable={attemptsReady && !checkingPin && secondsRemaining === 0}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={PIN_LENGTH}
                  underlineColorAndroid="transparent"
                  style={[
                    styles.pinInput,
                    { color: theme.text, borderColor: error ? theme.error : theme.border, backgroundColor: theme.surface1, fontFamily: FONTS.mono },
                  ]}
                />
              </>
            )}

            {secondsRemaining > 0 ? (
              <Text style={[styles.error, { color: theme.error, fontFamily: FONTS.body }]}>
                Too many PIN attempts. Try again in {secondsRemaining}s, or log out and use your password.
              </Text>
            ) : error ? (
              <Text style={[styles.error, { color: theme.error, fontFamily: FONTS.body }]}>
                {error}
              </Text>
            ) : null}

            {showLogout && (
              <TouchableOpacity onPress={logout} style={styles.logoutLink}>
                <Text style={[styles.logoutText, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                  CAN'T UNLOCK — LOG OUT
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  error: { fontSize: 13, textAlign: 'center', marginTop: -4 },
  bioBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14,
    borderWidth: 1, borderRadius: 12, marginTop: 8,
  },
  bioLabel: { fontSize: 14 },
  logoutLink: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  logoutText: { fontSize: 10, letterSpacing: 1.2 },
});
