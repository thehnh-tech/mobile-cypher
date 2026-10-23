import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert,
} from 'react-native';
import * as ExpoClipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { MainStackParams } from '../navigation';
import Avatar from '../components/Avatar';
import Button from '../components/Button';
import { BackIcon } from '../components/Icons';

type Props = { navigation: StackNavigationProp<MainStackParams, 'Profile'> };

const THEMES_LIST = [
  { name: 'cyan' as const, label: 'Cyan', color: '#22d3ee' },
  { name: 'magenta' as const, label: 'Magenta', color: '#f472b6' },
  { name: 'amber' as const, label: 'Amber', color: '#fbbf24' },
  { name: 'lime' as const, label: 'Lime', color: '#4ade80' },
];

export default function ProfileScreen({ navigation }: Props) {
  const { vault, updateVault, logout, theme } = useApp();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(vault?.profile.displayName ?? '');
  const [bio, setBio] = useState(vault?.profile.bio ?? '');
  const [hue, setHue] = useState(vault?.profile.avatar.hue ?? 160);
  const [copied, setCopied] = useState(false);

  if (!vault) return null;

  const save = async () => {
    const newVault = {
      ...vault,
      profile: { ...vault.profile, displayName, bio, avatar: { hue } },
    };
    await updateVault(newVault);
    setEditing(false);
  };

  const copyTag = async () => {
    await ExpoClipboard.setStringAsync('@' + vault.profile.tag);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleThemeChange = async (themeName: typeof THEMES_LIST[0]['name']) => {
    const newVault = { ...vault, settings: { ...vault.settings, theme: themeName } };
    await updateVault(newVault);
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <BackIcon color={theme.accent} size={20} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>Profile</Text>
          <TouchableOpacity
            onPress={editing ? save : () => setEditing(true)}
            style={[
              styles.editBtn,
              editing
                ? { backgroundColor: theme.accent }
                : { borderWidth: 1, borderColor: theme.accentBorder },
            ]}
          >
            <Text
              style={[
                styles.editBtnText,
                { color: editing ? '#0a0d14' : theme.accent, fontFamily: FONTS.mono },
              ]}
            >
              {editing ? 'Save' : 'Edit'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Avatar section */}
          <View style={styles.avatarSection}>
            <Avatar hue={hue} size={90} label={displayName || vault.profile.displayName} />
            <Text style={[styles.name, { color: theme.text, fontFamily: FONTS.bodyBold }]}>
              {displayName || vault.profile.displayName}
            </Text>
            <TouchableOpacity onPress={copyTag}>
              <Text style={[styles.tag, { color: theme.accent, fontFamily: FONTS.mono }]}>
                @{vault.profile.tag} {copied ? '✓' : ''}
              </Text>
            </TouchableOpacity>

            {/* Avatar hue slider */}
            {editing && (
              <View style={styles.hueRow}>
                <Text style={[styles.hueLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>Color</Text>
                {/* Simplified hue picker with preset colors */}
                <View style={styles.huePicker}>
                  {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((h) => (
                    <TouchableOpacity
                      key={h}
                      onPress={() => setHue(h)}
                      style={[
                        styles.hueOption,
                        { backgroundColor: `hsl(${h}, 60%, 50%)` },
                        hue === h && { borderWidth: 2, borderColor: '#fff' },
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Fingerprint */}
          <View style={[styles.fpBadge, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}>
            <Text style={[styles.fpLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              KEY FINGERPRINT
            </Text>
            <Text style={[styles.fpValue, { color: theme.accent, fontFamily: FONTS.mono }]}>
              {vault.profile.fingerprint}
            </Text>
          </View>

          {/* Display name */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>Display name</Text>
            {editing ? (
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                underlineColorAndroid="transparent"
                autoCorrect={false}
                style={[styles.fieldInput, {
                  color: theme.text,
                  backgroundColor: theme.surface1,
                  borderColor: theme.border,
                  fontFamily: FONTS.body,
                }]}
              />
            ) : (
              <View style={[styles.fieldDisplay, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
                <Text style={[styles.fieldValue, { color: theme.text, fontFamily: FONTS.body }]}>
                  {displayName || vault.profile.displayName}
                </Text>
              </View>
            )}
          </View>

          {/* Bio */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>About</Text>
            {editing ? (
              <TextInput
                value={bio}
                onChangeText={setBio}
                multiline
                underlineColorAndroid="transparent"
                autoCorrect={false}
                style={[styles.fieldInput, styles.bioInput, {
                  color: theme.text,
                  backgroundColor: theme.surface1,
                  borderColor: theme.border,
                  fontFamily: FONTS.body,
                }]}
                placeholder="No bio yet"
                placeholderTextColor={theme.textDim}
              />
            ) : (
              <View style={[styles.fieldDisplay, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
                <Text style={[styles.fieldValue, { color: bio ? theme.text : theme.textDim, fontFamily: FONTS.body }]}>
                  {bio || 'No bio yet'}
                </Text>
              </View>
            )}
          </View>

          {/* AI privacy */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>AI chat</Text>
            <Text style={[styles.fieldValue, { color: theme.textDim, fontFamily: FONTS.body }]}>
              AI is provided through this app's server and Groq. Messages you send to the AI are shared with both services for processing. Provider access is configured by the server operator.
            </Text>
          </View>
          {/* Theme picker */}
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textDim, fontFamily: FONTS.mono }]}>Theme</Text>
            <View style={styles.themeRow}>
              {THEMES_LIST.map((t) => (
                <TouchableOpacity
                  key={t.name}
                  onPress={() => handleThemeChange(t.name)}
                  style={[
                    styles.themeChip,
                    { borderColor: vault.settings.theme === t.name ? t.color : theme.border },
                    vault.settings.theme === t.name && { backgroundColor: `${t.color}15` },
                  ]}
                >
                  <View style={[styles.themeDot, { backgroundColor: t.color }]} />
                  <Text style={[styles.themeLabel, {
                    color: vault.settings.theme === t.name ? t.color : theme.textDim,
                    fontFamily: FONTS.body,
                  }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Logout */}
          <View style={styles.logoutSection}>
            <Button variant="danger" onPress={handleLogout} full theme={theme}>
              Log out
            </Button>
          </View>
        </ScrollView>
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
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16 },
  editBtn: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 13 },
  content: { padding: 20, gap: 20 },
  avatarSection: { alignItems: 'center', gap: 8, paddingVertical: 8 },
  name: { fontSize: 22, letterSpacing: -0.5 },
  tag: { fontSize: 14 },
  hueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  hueLabel: { fontSize: 11 },
  huePicker: { flexDirection: 'row', gap: 6 },
  hueOption: { width: 22, height: 22, borderRadius: 11 },
  fpBadge: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  fpLabel: { fontSize: 9, letterSpacing: 1 },
  fpValue: { fontSize: 11, letterSpacing: 1.5 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
  },
  bioInput: { minHeight: 70, textAlignVertical: 'top' },
  fieldDisplay: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  fieldValue: { fontSize: 14 },
  themeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  themeDot: { width: 8, height: 8, borderRadius: 4 },
  themeLabel: { fontSize: 13 },
  logoutSection: { paddingTop: 8 },
});
