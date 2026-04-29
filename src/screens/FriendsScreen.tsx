import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, TouchableWithoutFeedback, Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { MainStackParams } from '../navigation';
import Avatar from '../components/Avatar';
import Button from '../components/Button';
import { BackIcon, SearchIcon, SendIcon } from '../components/Icons';
import * as DB from '../db';
import { api } from '../api';
import { encryptForRecipients, packPayload } from '../crypto';

type Props = { navigation: StackNavigationProp<MainStackParams, 'Friends'> };

function hueFromId(id: string): number {
  return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 360;
}

export default function FriendsScreen({ navigation }: Props) {
  const { vault, theme, token, serverConversations, refreshSync, pushToast } = useApp();
  const [tagInput, setTagInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<DB.UserRecord | 'none' | null>(null);
  const [notice, setNotice] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const [composeFor, setComposeFor] = useState<DB.UserRecord | null>(null);
  const [composeText, setComposeText] = useState('');
  const [sending, setSending] = useState(false);
  const composeInputRef = useRef<TextInput>(null);

  if (!vault || !token) return null;

  const cleanTag = tagInput.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, '');

  const search = async () => {
    if (cleanTag.length < 3) return;
    if (cleanTag === vault.profile.tag) {
      setNotice("That's your own tag");
      return;
    }
    setSearching(true);
    setNotice('');
    setResult(null);
    try {
      const found = await DB.findUserByTag(token, cleanTag);
      setResult(found ?? 'none');
    } catch (e: any) {
      setNotice(e?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const startCompose = () => {
    if (!result || result === 'none') return;
    // If we already have a conversation with this peer, just open it.
    const existingConv = serverConversations.find((c) => c.peerUserId === result.id);
    if (existingConv) {
      navigation.navigate('Chat', { chatId: existingConv.id });
      return;
    }
    setComposeText('');
    setComposeFor(result);
    setTimeout(() => composeInputRef.current?.focus(), 200);
  };

  const submitCompose = async () => {
    if (!composeFor) return;
    const text = composeText.trim();
    if (!text) return;
    setSending(true);
    try {
      if (!composeFor.publicKey) {
        throw new Error('Recipient is missing a public key (legacy account?)');
      }
      const payload = encryptForRecipients(text, [
        { userId: vault.profile.id, publicKey: vault.profile.publicKey },
        { userId: composeFor.id, publicKey: composeFor.publicKey },
      ]);
      const resp = await api.sendRequest(token, composeFor.id, packPayload(payload));
      setComposeFor(null);
      setComposeText('');
      if (resp.kind === 'message' && resp.conversationId) {
        // A conversation already existed — just navigate to it.
        await refreshSync();
        pushToast('Message sent', 'info');
        navigation.navigate('Chat', { chatId: resp.conversationId });
      } else {
        pushToast(`Request sent to @${composeFor.tag}`, 'info');
        navigation.goBack();
      }
    } catch (e: any) {
      pushToast(e?.message ?? 'Could not send', 'info');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <BackIcon color={theme.accent} size={20} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
            Add Friend
          </Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionTitle, { color: theme.textDim, fontFamily: FONTS.mono }]}>
            FIND BY @TAG
          </Text>

          <View style={styles.searchRow}>
            <TouchableWithoutFeedback onPress={() => searchInputRef.current?.focus()}>
              <View style={[styles.searchBar, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
                <Text style={[styles.prefix, { color: theme.accent, fontFamily: FONTS.mono }]}>@</Text>
                <TextInput
                  ref={searchInputRef}
                  value={tagInput}
                  onChangeText={setTagInput}
                  placeholder="username"
                  placeholderTextColor={theme.textDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  underlineColorAndroid="transparent"
                  textAlignVertical="center"
                  style={[styles.searchInput, { color: theme.text, fontFamily: FONTS.body }]}
                  onSubmitEditing={search}
                />
              </View>
            </TouchableWithoutFeedback>
            <TouchableOpacity
              onPress={search}
              disabled={cleanTag.length < 3 || searching}
              style={[
                styles.searchBtn,
                { backgroundColor: cleanTag.length >= 3 ? theme.accent : theme.surface1 },
              ]}
              activeOpacity={0.8}
            >
              {searching ? (
                <ActivityIndicator color="#0a0d14" size="small" />
              ) : (
                <SearchIcon color={cleanTag.length >= 3 ? '#0a0d14' : theme.textDim} size={16} />
              )}
            </TouchableOpacity>
          </View>

          {notice ? (
            <Text style={[styles.notice, { color: theme.textDim, fontFamily: FONTS.body }]}>{notice}</Text>
          ) : null}

          {result === 'none' && (
            <View style={[styles.resultBox, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
              <Text style={[styles.noResult, { color: theme.textDim, fontFamily: FONTS.body }]}>
                No user found with @{cleanTag}
              </Text>
            </View>
          )}

          {result && result !== 'none' && (
            <View style={[styles.resultBox, { backgroundColor: theme.surface1, borderColor: theme.accentBorder }]}>
              <View style={styles.resultUser}>
                <Avatar hue={hueFromId(result.id)} size={48} label={result.displayName} />
                <View style={styles.resultInfo}>
                  <Text style={[styles.resultName, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
                    {result.displayName}
                  </Text>
                  <Text style={[styles.resultTag, { color: theme.accent, fontFamily: FONTS.mono }]}>
                    @{result.tag}
                  </Text>
                  {result.fingerprint && (
                    <View style={[styles.fpBadge, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}>
                      <Text style={[styles.fpText, { color: theme.accent, fontFamily: FONTS.mono }]}>
                        {result.fingerprint.slice(0, 19)}…
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <Button onPress={startCompose} full theme={theme}>
                {serverConversations.find((c) => c.peerUserId === (result as DB.UserRecord).id)
                  ? 'Open chat'
                  : 'Send a message'}
              </Button>
            </View>
          )}

          {/* Active conversations from server */}
          {serverConversations.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: theme.textDim, fontFamily: FONTS.mono, marginTop: 8 }]}>
                CONVERSATIONS ({serverConversations.length})
              </Text>
              {serverConversations.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.friendRow, { borderColor: theme.border }]}
                  onPress={() => navigation.navigate('Chat', { chatId: c.id })}
                  activeOpacity={0.7}
                >
                  <Avatar hue={hueFromId(c.peerUserId)} size={44} label={c.peerDisplayName} />
                  <View style={styles.friendInfo}>
                    <Text style={[styles.friendName, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
                      {c.peerDisplayName}
                    </Text>
                    <Text style={[styles.friendTag, { color: theme.accent, fontFamily: FONTS.mono }]}>
                      @{c.peerTag}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Compose-first-message modal */}
      <Modal
        visible={!!composeFor}
        transparent
        animationType="fade"
        onRequestClose={() => !sending && setComposeFor(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !sending && setComposeFor(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalCenter}
          >
            <Pressable
              style={[styles.modalCard, { backgroundColor: theme.surface1, borderColor: theme.accentBorder }]}
              onPress={(e) => e.stopPropagation()}
            >
              {composeFor && (
                <>
                  <Text style={[styles.modalTitle, { color: theme.textDim, fontFamily: FONTS.mono }]}>
                    SEND REQUEST TO
                  </Text>
                  <View style={styles.modalUser}>
                    <Avatar hue={hueFromId(composeFor.id)} size={40} label={composeFor.displayName} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modalName, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
                        {composeFor.displayName}
                      </Text>
                      <Text style={[styles.modalTag, { color: theme.accent, fontFamily: FONTS.mono }]}>
                        @{composeFor.tag}
                      </Text>
                    </View>
                  </View>
                  <TextInput
                    ref={composeInputRef}
                    value={composeText}
                    onChangeText={setComposeText}
                    placeholder="Write your first message…"
                    placeholderTextColor={theme.textDim}
                    multiline
                    autoCorrect={false}
                    underlineColorAndroid="transparent"
                    style={[
                      styles.modalInput,
                      { color: theme.text, borderColor: theme.border, fontFamily: FONTS.body },
                    ]}
                  />
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      onPress={() => setComposeFor(null)}
                      disabled={sending}
                      style={[styles.modalBtn, { borderColor: theme.border }]}
                    >
                      <Text style={[styles.modalBtnText, { color: theme.text, fontFamily: FONTS.body }]}>
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={submitCompose}
                      disabled={!composeText.trim() || sending}
                      style={[
                        styles.modalBtn,
                        styles.modalBtnPrimary,
                        {
                          backgroundColor: composeText.trim() ? theme.accent : theme.surface2,
                          borderColor: theme.accentBorder,
                        },
                      ]}
                    >
                      {sending ? (
                        <ActivityIndicator color="#0a0d14" size="small" />
                      ) : (
                        <>
                          <SendIcon color={composeText.trim() ? '#0a0d14' : theme.textDim} size={14} />
                          <Text
                            style={[
                              styles.modalBtnText,
                              { color: composeText.trim() ? '#0a0d14' : theme.textDim, fontFamily: FONTS.bodySemiBold },
                            ]}
                          >
                            Send
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
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
  content: { padding: 20, gap: 14 },
  sectionTitle: { fontSize: 10, letterSpacing: 1.2, marginBottom: -4 },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 48,
    gap: 4,
  },
  prefix: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 15, padding: 0, margin: 0 },
  searchBtn: {
    width: 46,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: { fontSize: 13, textAlign: 'center' },
  resultBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  resultUser: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultInfo: { flex: 1, gap: 2 },
  resultName: { fontSize: 16 },
  resultTag: { fontSize: 13 },
  fpBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
  fpText: { fontSize: 9, letterSpacing: 1 },
  noResult: { fontSize: 14, textAlign: 'center', paddingVertical: 8 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  friendInfo: { flex: 1 },
  friendName: { fontSize: 15 },
  friendTag: { fontSize: 12, marginTop: 2 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  modalTitle: { fontSize: 10, letterSpacing: 1.2 },
  modalUser: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalName: { fontSize: 16 },
  modalTag: { fontSize: 12, marginTop: 2 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 90,
    maxHeight: 180,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 8 },
  modalBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  modalBtnPrimary: {},
  modalBtnText: { fontSize: 14 },
});
