import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Image, ActivityIndicator, Alert, InteractionManager,
  Keyboard, TouchableWithoutFeedback, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { MainStackParams } from '../navigation';
import {
  BackIcon, LockIcon, CloseIcon, CheckIcon,
} from '../components/Icons';
import {
  generateKey,
  encryptStringWithKey16, decryptStringWithKey16,
  transformImagePng,
  base64ToBytes, bytesToBase64,
} from '../crypto';

const KEY_LENGTH_OPTIONS = [16, 24, 32] as const;
const MIN_KEY_LENGTH = 16;

type Props = { navigation: StackNavigationProp<MainStackParams, 'Encryption'> };

type Mode = 'encrypt' | 'decrypt';
type InputType = 'text' | 'image';

const MAX_IMAGE_DIM = 600; // cap so encryption and PNG encoding stay responsive

interface ImageSlot {
  uri: string;       // file:// URI for <Image> rendering
  width: number;
  height: number;
  bytes: Uint8Array; // raw PNG bytes (so we can run the cipher without re-decoding base64)
}

export default function EncryptionScreen({ navigation }: Props) {
  const { theme } = useApp();
  const [mode, setMode] = useState<Mode>('encrypt');
  const [inputType, setInputType] = useState<InputType>('text');

  // Text path
  const [textInput, setTextInput] = useState('');
  const [textOutput, setTextOutput] = useState(''); // ciphertext (encrypt) or plaintext (decrypt)

  // Image path
  const [inputImage, setInputImage] = useState<ImageSlot | null>(null);
  const [outputImage, setOutputImage] = useState<ImageSlot | null>(null);

  const [keyLength, setKeyLength] = useState<number>(16);
  const [key, setKey] = useState<string>(() => generateKey(16));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string>('');
  const scrollRef = useRef<ScrollView>(null);

  // Counter to ensure unique cache file names per encrypt/decrypt cycle
  // (RN <Image> caches by URI, so reusing the same path won't refresh).
  const fileCounter = useRef(0);

  const flashMsg = (s: string) => {
    setFlash(s);
    setTimeout(() => setFlash(''), 1400);
  };

  const pickImage = useCallback(async () => {
    Keyboard.dismiss();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Please grant gallery access to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      // Keep encrypted carrier bytes untouched: resizing, JPEG conversion,
      // or color conversion would invalidate authenticated pixel data.
      const asset = result.assets[0];
      const manipulated = mode === 'encrypt'
        ? await ImageManipulator.manipulateAsync(
            asset.uri,
            asset.width > MAX_IMAGE_DIM ? [{ resize: { width: MAX_IMAGE_DIM } }] : [],
            { format: ImageManipulator.SaveFormat.PNG, base64: true },
          )
        : {
            width: asset.width,
            height: asset.height,
            base64: await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }),
          };
      if (!manipulated.base64) throw new Error('Manipulator did not return base64');

      const bytes = base64ToBytes(manipulated.base64);

      // Persist a copy to a file so <Image> can render it; we keep the raw
      // bytes around for the actual cipher step.
      fileCounter.current += 1;
      const path = `${FileSystem.cacheDirectory}cipher_in_${fileCounter.current}.png`;
      await FileSystem.writeAsStringAsync(path, manipulated.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      setInputImage({
        uri: path,
        width: manipulated.width,
        height: manipulated.height,
        bytes,
      });
      setOutputImage(null);
    } catch (e: any) {
      Alert.alert('Pick failed', e?.message ?? 'Could not load image');
    } finally {
      setBusy(false);
    }
  }, [mode]);

  const saveOutputToGallery = useCallback(async () => {
    if (!outputImage) return;
    Keyboard.dismiss();
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Allow access to save to your gallery.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(outputImage.uri);
      flashMsg('Saved to gallery');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Could not save to gallery');
    }
  }, [outputImage]);

  const reset = () => {
    setTextInput('');
    setTextOutput('');
    setInputImage(null);
    setOutputImage(null);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setTextOutput('');
    setOutputImage(null);
    if (m === 'encrypt') setKey(generateKey(keyLength));
  };

  const switchKeyLength = (len: number) => {
    setKeyLength(len);
    if (mode === 'encrypt') setKey(generateKey(len));
  };

  const switchInputType = (t: InputType) => {
    setInputType(t);
    setTextOutput('');
    setOutputImage(null);
  };

  const copyKey = async () => {
    await Clipboard.setStringAsync(key);
    flashMsg('Key copied');
  };

  const copyTextOutput = async () => {
    await Clipboard.setStringAsync(textOutput);
    flashMsg('Output copied');
  };

  const pasteTextOutput = async () => {
    const s = await Clipboard.getStringAsync();
    setTextOutput(s.trim());
  };

  const regenerateKey = () => setKey(generateKey(keyLength));

  const requiredKeyLength = mode === 'encrypt' ? MIN_KEY_LENGTH : 4;
  const validKeyLength = key.length >= requiredKeyLength;

  // Take the encrypt-mode output and feed it into decrypt-mode as input —
  // makes single-device round-trip demos painless.
  const useOutputAsDecryptInput = useCallback(() => {
    if (!outputImage) return;
    setInputImage(outputImage);
    setOutputImage(null);
    setMode('decrypt');
    flashMsg('Loaded into Decrypt');
  }, [outputImage]);

  const runEncryptText = () => {
    if (!textInput.trim()) {
      Alert.alert('Empty input', 'Type some text to encrypt.');
      return;
    }
    setTextOutput(encryptStringWithKey16(textInput, key));
  };

  const runDecryptText = () => {
    if (!textOutput.trim()) {
      Alert.alert('No ciphertext', 'Paste the encrypted text into the box first.');
      return;
    }
    try {
      const pt = decryptStringWithKey16(textOutput.trim(), key);
      setTextInput(pt);
    } catch (e: any) {
      Alert.alert('Decryption failed', `${e?.message ?? String(e)}\nWrong key?`);
    }
  };

  const runImageTransform = useCallback(async () => {
    if (!inputImage) {
      Alert.alert('No image', 'Pick an image first.');
      return;
    }
    setBusy(true);
    // Defer the heavy work past the React commit so the spinner shows.
    InteractionManager.runAfterInteractions(async () => {
      try {
        const result = transformImagePng(inputImage.bytes, key, mode);
        const b64 = bytesToBase64(result.bytes);
        fileCounter.current += 1;
        const path = `${FileSystem.cacheDirectory}cipher_out_${fileCounter.current}.png`;
        await FileSystem.writeAsStringAsync(path, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setOutputImage({
          uri: path,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      } catch (e: any) {
        Alert.alert(
          mode === 'encrypt' ? 'Encryption failed' : 'Decryption failed',
          e?.message ?? String(e),
        );
      } finally {
        setBusy(false);
      }
    });
  }, [inputImage, key, mode]);

  const action = useCallback(() => {
    if (!validKeyLength) {
      Alert.alert('Invalid key', `Key must be at least ${requiredKeyLength} characters.`);
      return;
    }
    if (inputType === 'text') {
      mode === 'encrypt' ? runEncryptText() : runDecryptText();
    } else {
      void runImageTransform();
    }
  }, [validKeyLength, requiredKeyLength, inputType, mode, textInput, textOutput, key, inputImage, runImageTransform]);

  const actionLabel = mode === 'encrypt' ? 'Encrypt' : 'Decrypt';

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <BackIcon color={theme.accent} size={20} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
              Encryption
            </Text>
            <Text style={[styles.headerSub, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              AES-256 · variable key
            </Text>
          </View>
          <View style={{ width: 28 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Mode toggle */}
          <View style={[styles.segCtl, { borderColor: theme.border, backgroundColor: theme.surface1 }]}>
            <TouchableOpacity
              onPress={() => switchMode('encrypt')}
              style={[
                styles.segBtn,
                mode === 'encrypt' && { backgroundColor: theme.accentBg, borderColor: theme.accentBorder },
              ]}
            >
              <LockIcon color={mode === 'encrypt' ? theme.accent : theme.textDim} size={11} />
              <Text
                style={[
                  styles.segLabel,
                  { color: mode === 'encrypt' ? theme.accent : theme.textDim, fontFamily: FONTS.mono },
                ]}
              >
                ENCRYPT
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => switchMode('decrypt')}
              style={[
                styles.segBtn,
                mode === 'decrypt' && { backgroundColor: theme.accentBg, borderColor: theme.accentBorder },
              ]}
            >
              <CheckIcon color={mode === 'decrypt' ? theme.accent : theme.textDim} size={11} />
              <Text
                style={[
                  styles.segLabel,
                  { color: mode === 'decrypt' ? theme.accent : theme.textDim, fontFamily: FONTS.mono },
                ]}
              >
                DECRYPT
              </Text>
            </TouchableOpacity>
          </View>

          {/* Type toggle */}
          <View style={[styles.segCtl, { borderColor: theme.border, backgroundColor: theme.surface1 }]}>
            <TouchableOpacity
              onPress={() => switchInputType('text')}
              style={[styles.segBtn, inputType === 'text' && { backgroundColor: theme.accentBg }]}
            >
              <Text
                style={[
                  styles.segLabel,
                  { color: inputType === 'text' ? theme.accent : theme.textDim, fontFamily: FONTS.mono },
                ]}
              >
                TEXT
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => switchInputType('image')}
              style={[styles.segBtn, inputType === 'image' && { backgroundColor: theme.accentBg }]}
            >
              <Text
                style={[
                  styles.segLabel,
                  { color: inputType === 'image' ? theme.accent : theme.textDim, fontFamily: FONTS.mono },
                ]}
              >
                IMAGE
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Text pipeline ── */}
          {inputType === 'text' && mode === 'encrypt' && (
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>PLAINTEXT</Text>
              <TextInput
                value={textInput}
                onChangeText={setTextInput}
                placeholder="Type the message you want to encrypt"
                placeholderTextColor={theme.textDim}
                multiline
                underlineColorAndroid="transparent"
                onFocus={() => {
                  // Give the keyboard time to mount, then scroll to bring the
                  // input above it.
                  setTimeout(() => scrollRef.current?.scrollTo({ y: 220, animated: true }), 250);
                }}
                style={[
                  styles.textArea,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface1, fontFamily: FONTS.body },
                ]}
              />
            </View>
          )}

          {inputType === 'text' && mode === 'decrypt' && (
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                  CIPHERTEXT
                </Text>
                <TouchableOpacity onPress={pasteTextOutput}>
                  <Text style={[styles.smallAction, { color: theme.accent, fontFamily: FONTS.mono }]}>
                    PASTE
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={textOutput}
                onChangeText={setTextOutput}
                placeholder="Paste the encrypted text here"
                placeholderTextColor={theme.textDim}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                underlineColorAndroid="transparent"
                onFocus={() => {
                  setTimeout(() => scrollRef.current?.scrollTo({ y: 220, animated: true }), 250);
                }}
                style={[
                  styles.textArea,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface1, fontFamily: FONTS.mono, fontSize: 11 },
                ]}
              />
            </View>
          )}

          {/* ── Image pipeline ── */}
          {inputType === 'image' && (
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                {mode === 'encrypt' ? 'SOURCE IMAGE' : 'ENCRYPTED IMAGE'}
              </Text>
              {inputImage ? (
                <Image
                  source={{ uri: inputImage.uri }}
                  style={[styles.imagePreview, { aspectRatio: inputImage.width / inputImage.height }]}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.placeholder, { borderColor: theme.border, backgroundColor: theme.surface1 }]}>
                  <Text style={[styles.placeholderText, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                    No image picked
                  </Text>
                </View>
              )}
              <TouchableOpacity
                onPress={pickImage}
                disabled={busy}
                style={[
                  styles.pickBtn,
                  { backgroundColor: theme.accentBg, borderColor: theme.accentBorder },
                ]}
              >
                <Text style={[styles.pickLabel, { color: theme.accent, fontFamily: FONTS.bodySemiBold }]}>
                  {inputImage ? 'Pick another image' : 'Pick image from gallery'}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.hint, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                AES-GCM authenticated PNG · share the original PNG without resizing
              </Text>
            </View>
          )}

          {/* Key */}
          <View style={styles.section}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                KEY · {key.length} chars
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {mode === 'encrypt' && (
                  <TouchableOpacity onPress={regenerateKey}>
                    <Text style={[styles.smallAction, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                      REGENERATE
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={copyKey}>
                  <Text style={[styles.smallAction, { color: theme.accent, fontFamily: FONTS.mono }]}>
                    COPY KEY
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {mode === 'encrypt' && (
              <View style={[styles.keyLenRow, { borderColor: theme.border, backgroundColor: theme.surface1 }]}>
                {KEY_LENGTH_OPTIONS.map((len) => (
                  <TouchableOpacity
                    key={len}
                    onPress={() => switchKeyLength(len)}
                    style={[
                      styles.keyLenBtn,
                      keyLength === len && { backgroundColor: theme.accentBg, borderColor: theme.accentBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.keyLenLabel,
                        { color: keyLength === len ? theme.accent : theme.textDim, fontFamily: FONTS.mono },
                      ]}
                    >
                      {len}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              value={key}
              onChangeText={(s) => setKey(s.slice(0, 64))}
              autoCapitalize="none"
              autoCorrect={false}
              underlineColorAndroid="transparent"
              maxLength={64}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              onFocus={() => {
                setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
              }}
              style={[
                styles.keyInput,
                { color: theme.text, borderColor: validKeyLength ? theme.accentBorder : theme.error, backgroundColor: theme.surface1, fontFamily: FONTS.mono },
              ]}
            />
          </View>

          {/* Action */}
          <TouchableOpacity
            onPress={action}
            disabled={busy}
            style={[
              styles.actionBtn,
              { backgroundColor: theme.accent, borderColor: theme.accentBorder },
              busy && { opacity: 0.5 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#0a0d14" size="small" />
            ) : (
              <Text style={[styles.actionLabel, { fontFamily: FONTS.bodyBold }]}>{actionLabel}</Text>
            )}
          </TouchableOpacity>

          {flash ? (
            <Text style={[styles.flash, { color: theme.accent, fontFamily: FONTS.mono }]}>
              {flash}
            </Text>
          ) : null}

          {/* Output — text */}
          {inputType === 'text' && mode === 'encrypt' && textOutput ? (
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                  CIPHERTEXT · {textOutput.length} chars
                </Text>
                <TouchableOpacity onPress={copyTextOutput}>
                  <Text style={[styles.smallAction, { color: theme.accent, fontFamily: FONTS.mono }]}>
                    COPY OUTPUT
                  </Text>
                </TouchableOpacity>
              </View>
              <View
                style={[
                  styles.outputBox,
                  { borderColor: theme.border, backgroundColor: theme.surface1 },
                ]}
              >
                <Text
                  style={[styles.outputText, { color: theme.text, fontFamily: FONTS.mono }]}
                  selectable
                >
                  {textOutput}
                </Text>
              </View>
            </View>
          ) : null}

          {inputType === 'text' && mode === 'decrypt' && textInput ? (
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                PLAINTEXT
              </Text>
              <View
                style={[
                  styles.outputBox,
                  { borderColor: theme.accentBorder, backgroundColor: theme.surface1 },
                ]}
              >
                <Text
                  style={[styles.outputText, { color: theme.text, fontFamily: FONTS.body, fontSize: 14 }]}
                  selectable
                >
                  {textInput}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Output — image */}
          {inputType === 'image' && outputImage ? (
            <View style={styles.section}>
              <Text style={[styles.label, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                {mode === 'encrypt' ? 'ENCRYPTED IMAGE' : 'DECRYPTED IMAGE'}
              </Text>
              <Image
                source={{ uri: outputImage.uri }}
                style={[styles.imagePreview, { aspectRatio: outputImage.width / outputImage.height }]}
                resizeMode="contain"
              />
              <View style={styles.outputActionsRow}>
                <TouchableOpacity
                  onPress={saveOutputToGallery}
                  style={[
                    styles.outputAction,
                    { backgroundColor: theme.accent, borderColor: theme.accentBorder },
                  ]}
                >
                  <Text style={[styles.outputActionLabel, { color: '#0a0d14', fontFamily: FONTS.bodyBold }]}>
                    Save to gallery
                  </Text>
                </TouchableOpacity>
                {mode === 'encrypt' && (
                  <TouchableOpacity
                    onPress={useOutputAsDecryptInput}
                    style={[
                      styles.outputAction,
                      { backgroundColor: theme.accentBg, borderColor: theme.accentBorder },
                    ]}
                  >
                    <Text style={[styles.outputActionLabel, { color: theme.accent, fontFamily: FONTS.bodySemiBold }]}>
                      Test round-trip
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : null}

          <TouchableOpacity onPress={reset} style={styles.resetBtn}>
            <CloseIcon color={theme.textDim} size={12} />
            <Text style={[styles.resetLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              RESET
            </Text>
          </TouchableOpacity>
        </ScrollView>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
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
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16 },
  headerSub: { fontSize: 9, letterSpacing: 0.8, marginTop: 1 },
  body: { padding: 16, gap: 14, paddingBottom: 40 },
  segCtl: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
  },
  segLabel: { fontSize: 11, letterSpacing: 1.2 },
  section: { gap: 6 },
  label: { fontSize: 10, letterSpacing: 1.2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  smallAction: { fontSize: 10, letterSpacing: 1.2 },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 100,
    maxHeight: 220,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  keyInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 1.5,
  },
  pickBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pickLabel: { fontSize: 14 },
  imagePreview: {
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#0a0d14',
  },
  placeholder: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 60,
    alignItems: 'center',
  },
  placeholderText: { fontSize: 11, letterSpacing: 1 },
  hint: { fontSize: 9, letterSpacing: 0.8, textAlign: 'center', marginTop: 2 },
  actionBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  actionLabel: { fontSize: 15, color: '#0a0d14' },
  outputBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  outputText: { fontSize: 11, lineHeight: 16 },
  flash: { fontSize: 11, letterSpacing: 1, textAlign: 'center', marginTop: -6 },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    marginTop: 4,
  },
  resetLabel: { fontSize: 10, letterSpacing: 1.2 },
  outputActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  outputAction: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  outputActionLabel: { fontSize: 13 },
  keyLenRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  keyLenBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 0,
  },
  keyLenLabel: { fontSize: 12, letterSpacing: 0.8 },
});
