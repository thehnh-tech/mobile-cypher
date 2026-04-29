import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useApp } from '../context/AppContext';
import { FONTS } from '../theme';
import { MainStackParams } from '../navigation';
import Avatar from '../components/Avatar';
import { BackIcon, CheckIcon, CloseIcon, LockIcon } from '../components/Icons';
import { api, ServerRequest } from '../api';
import { Contact } from '../db';
import {
  decryptForMe,
  unpackPayload,
  isEncryptedPayloadString,
} from '../crypto';

type Props = { navigation: StackNavigationProp<MainStackParams, 'Requests'> };

function hueFromId(id: string): number {
  return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 360;
}

function previewOf(s: string, myUserId: string, myPriv: string): string {
  if (!s) return '';
  if (!isEncryptedPayloadString(s)) return s;
  try {
    return decryptForMe(myUserId, myPriv, unpackPayload(s));
  } catch {
    return '[unable to decrypt]';
  }
}

export default function RequestsScreen({ navigation }: Props) {
  const {
    theme, token, vault, updateVault, serverRequests, refreshSync, pushToast,
  } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!vault || !token) return null;

  const accept = async (req: ServerRequest) => {
    if (busyId) return;
    setBusyId(req.id);
    try {
      const resp = await api.acceptRequest(token, req.id);

      // Add the sender to local contacts if not already known.
      const existingContact = vault.contacts.find((c) => c.id === req.fromUserId);
      if (!existingContact) {
        const newContact: Contact = {
          id: req.fromUserId,
          name: req.fromDisplayName,
          tag: req.fromTag,
          online: false,
          ai: false,
          fingerprint: req.fromFingerprint,
          avatar: { hue: hueFromId(req.fromUserId) },
        };
        await updateVault({ ...vault, contacts: [...vault.contacts, newContact] });
      }

      pushToast(`Request from ${req.fromDisplayName} accepted`, 'info');
      await refreshSync();
      navigation.navigate('Chat', { chatId: resp.conversationId });
    } catch (e: any) {
      pushToast(e?.message ?? 'Could not accept request', 'info');
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (req: ServerRequest) => {
    if (busyId) return;
    setBusyId(req.id);
    try {
      await api.declineRequest(token, req.id);
      pushToast('Request declined', 'info');
      await refreshSync();
    } catch (e: any) {
      pushToast(e?.message ?? 'Could not decline request', 'info');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <BackIcon color={theme.accent} size={20} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
              Requests
            </Text>
            <Text style={[styles.headerSub, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              {serverRequests.length} pending
            </Text>
          </View>
          <View style={{ width: 28 }} />
        </View>

        <View style={styles.e2eBadge}>
          <LockIcon color={theme.accent} size={9} />
          <Text style={[styles.e2eText, { color: theme.accent, fontFamily: FONTS.mono }]}>
            Accept to start an encrypted chat
          </Text>
        </View>

        <FlatList
          data={serverRequests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
              <View style={styles.cardHead}>
                <Avatar hue={hueFromId(item.fromUserId)} size={44} label={item.fromDisplayName} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: theme.text, fontFamily: FONTS.bodySemiBold }]} numberOfLines={1}>
                    {item.fromDisplayName}
                  </Text>
                  <Text style={[styles.tag, { color: theme.accent, fontFamily: FONTS.mono }]} numberOfLines={1}>
                    @{item.fromTag}
                  </Text>
                </View>
              </View>

              <View style={[styles.preview, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <Text
                  style={[styles.previewText, { color: theme.text, fontFamily: FONTS.body }]}
                  numberOfLines={4}
                >
                  {previewOf(item.firstMessage, vault.profile.id, vault.profile.privateKey)}
                </Text>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => decline(item)}
                  disabled={busyId === item.id}
                  style={[styles.actionBtn, { borderColor: theme.border, backgroundColor: theme.bg }]}
                  activeOpacity={0.7}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color={theme.textDim} />
                  ) : (
                    <>
                      <CloseIcon color={theme.error} size={14} />
                      <Text style={[styles.actionLabel, { color: theme.text, fontFamily: FONTS.body }]}>
                        Decline
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => accept(item)}
                  disabled={busyId === item.id}
                  style={[styles.actionBtn, { borderColor: theme.accentBorder, backgroundColor: theme.accentBg }]}
                  activeOpacity={0.7}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : (
                    <>
                      <CheckIcon color={theme.accent} size={14} />
                      <Text style={[styles.actionLabel, { color: theme.accent, fontFamily: FONTS.body }]}>
                        Accept
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
                No pending requests
              </Text>
              <Text style={[styles.emptyText, { color: theme.textDim, fontFamily: FONTS.body }]}>
                When someone sends you a first message, it will land here.
              </Text>
            </View>
          }
        />
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
  headerSub: { fontSize: 10, letterSpacing: 0.8, marginTop: 1 },
  e2eBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  e2eText: { fontSize: 9, letterSpacing: 0.8 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 15 },
  tag: { fontSize: 12, marginTop: 2 },
  preview: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  previewText: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderWidth: 1,
    borderRadius: 10,
  },
  actionLabel: { fontSize: 14 },
  empty: { padding: 32, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 15 },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
