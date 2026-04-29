import React, { useState, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { useApp } from '../context/AppContext';
import { Chat, Contact } from '../db';
import { ServerConversation } from '../api';
import {
  decryptForMe,
  unpackPayload,
  isEncryptedPayloadString,
} from '../crypto';
import { FONTS, Theme } from '../theme';
import { MainStackParams } from '../navigation';
import Avatar from '../components/Avatar';
import { SearchIcon, AddFriendIcon, LockIcon, InboxIcon, ShieldIcon } from '../components/Icons';

type Props = { navigation: StackNavigationProp<MainStackParams, 'ChatList'> };

interface ListEntry {
  id: string;             // chat id used for navigation
  title: string;
  hue: number;
  preview: string;
  ts: number;             // for sorting
  timeLabel: string;
  isAI: boolean;
  unread: number;
  online: boolean;
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
  if (diffH < 24 && d.getDate() === now.getDate()) {
    return d.toTimeString().slice(0, 5);
  }
  if (diffH < 48) return 'Yesterday';
  if (diffH < 24 * 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function hueFromId(id: string): number {
  return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 360;
}

function buildLocalEntry(chat: Chat, contacts: Contact[], currentUserId: string): ListEntry | null {
  // Only render local DM entries that are AI bots — human DMs go through the
  // server channel now and are listed via serverConversations instead.
  const peer = chat.kind === 'dm' ? contacts.find((c) => c.id === chat.participants[0]) : null;
  if (chat.kind === 'dm' && !peer?.ai) return null;

  const title = peer ? peer.name : chat.name ?? 'Group';
  const hue = peer ? peer.avatar.hue : 160;
  const lastMsg = chat.messages[chat.messages.length - 1];
  const preview = lastMsg
    ? lastMsg.deleted
      ? 'Message deleted'
      : lastMsg.from === currentUserId
      ? `You: ${lastMsg.text}`
      : lastMsg.text
    : 'No messages yet';
  const ts = lastMsg?.ts ?? 0;

  return {
    id: chat.id,
    title,
    hue,
    preview,
    ts,
    timeLabel: ts ? formatTime(ts) : '',
    isAI: peer?.ai ?? false,
    unread: chat.unread,
    online: peer?.online ?? false,
  };
}

function buildServerEntry(
  conv: ServerConversation,
  myUserId: string,
  myPriv: string,
): ListEntry {
  const ts = new Date(conv.lastMessageAt).getTime();
  let preview = conv.lastMessage || 'No messages yet';
  if (conv.lastMessage && isEncryptedPayloadString(conv.lastMessage)) {
    try {
      preview = decryptForMe(myUserId, myPriv, unpackPayload(conv.lastMessage));
    } catch {
      preview = '[encrypted]';
    }
  }
  return {
    id: conv.id,
    title: conv.peerDisplayName,
    hue: hueFromId(conv.peerUserId),
    preview,
    ts,
    timeLabel: ts ? formatTime(ts) : '',
    isAI: false,
    unread: 0,
    online: false,
  };
}

function ChatRow({
  entry, theme, onOpen,
}: { entry: ListEntry; theme: Theme; onOpen: (id: string) => void }) {
  return (
    <TouchableOpacity
      onPress={() => onOpen(entry.id)}
      style={[styles.chatRow, { borderBottomColor: theme.border }]}
      activeOpacity={0.7}
    >
      <View style={{ position: 'relative' }}>
        <Avatar hue={entry.hue} size={50} label={entry.title} />
        {entry.online && (
          <View style={[styles.onlineDot, { borderColor: '#05070d', backgroundColor: '#4ade80' }]} />
        )}
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatTop}>
          <Text style={[styles.chatName, { color: theme.text, fontFamily: FONTS.bodySemiBold }]} numberOfLines={1}>
            {entry.title}
          </Text>
          {entry.isAI && (
            <View style={[styles.aiBadge, { backgroundColor: theme.accent }]}>
              <Text style={[styles.aiBadgeText, { fontFamily: FONTS.mono }]}>AI</Text>
            </View>
          )}
          <Text style={{ flex: 1 }} />
          {entry.timeLabel ? (
            <Text style={[styles.time, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              {entry.timeLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.chatBottom}>
          <Text style={[styles.preview, { color: theme.textDim, fontFamily: FONTS.body }]} numberOfLines={1}>
            {entry.preview}
          </Text>
          {entry.unread > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
              <Text style={[styles.unreadText, { fontFamily: FONTS.mono }]}>{entry.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatListScreen({ navigation }: Props) {
  const { vault, theme, serverConversations, serverRequests } = useApp();
  const [search, setSearch] = useState('');
  const searchRef = useRef<TextInput>(null);

  const entries = useMemo<ListEntry[]>(() => {
    if (!vault) return [];
    const local = vault.chats
      .map((c) => buildLocalEntry(c, vault.contacts, vault.profile.id))
      .filter((e): e is ListEntry => e !== null);
    const fromServer = serverConversations.map((c) =>
      buildServerEntry(c, vault.profile.id, vault.profile.privateKey),
    );
    return [...local, ...fromServer].sort((a, b) => b.ts - a.ts);
  }, [vault, serverConversations]);

  if (!vault) return null;

  const filtered = entries.filter(
    (e) => !search || e.title.toLowerCase().includes(search.toLowerCase()),
  );

  const requestsBadge = serverRequests.length;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <Avatar hue={vault.profile.avatar.hue} size={38} label={vault.profile.displayName} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodyBold }]}>Chats</Text>
            <Text style={[styles.headerTag, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              @{vault.profile.tag}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Encryption')}
            style={[styles.iconBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}
          >
            <ShieldIcon color={theme.accent} size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Requests')}
            style={[styles.iconBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}
          >
            <InboxIcon color={theme.accent} size={18} />
            {requestsBadge > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.accent, borderColor: theme.bg }]}>
                <Text style={[styles.badgeText, { fontFamily: FONTS.mono }]}>{requestsBadge}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Friends')}
            style={[styles.iconBtn, { backgroundColor: theme.accentBg, borderColor: theme.accentBorder }]}
          >
            <AddFriendIcon color={theme.accent} size={20} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <TouchableWithoutFeedback onPress={() => searchRef.current?.focus()}>
            <View style={[styles.searchBar, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
              <SearchIcon color={theme.textDim} size={16} />
              <TextInput
                ref={searchRef}
                value={search}
                onChangeText={setSearch}
                placeholder="Search chats"
                placeholderTextColor={theme.textDim}
                underlineColorAndroid="transparent"
                style={[styles.searchInput, { color: theme.text, fontFamily: FONTS.body }]}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>

        {/* E2E badge */}
        <View style={styles.e2eBadge}>
          <LockIcon color={theme.accent} size={9} />
          <Text style={[styles.e2eText, { color: theme.accent, fontFamily: FONTS.mono }]}>
            All messages encrypted
          </Text>
        </View>

        {/* Chat list */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChatRow
              entry={item}
              theme={theme}
              onOpen={(id) => navigation.navigate('Chat', { chatId: id })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.textDim, fontFamily: FONTS.body }]}>
                {search ? `No chats match "${search}"` : 'Add a friend to start chatting.'}
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
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
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 24, letterSpacing: -0.5, lineHeight: 28 },
  headerTag: { fontSize: 12, marginTop: 1 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4, right: -4,
    minWidth: 18, height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#0a0d14' },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0, margin: 0 },
  e2eBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 20, paddingBottom: 6,
  },
  e2eText: { fontSize: 9, letterSpacing: 0.8 },
  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  onlineDot: {
    position: 'absolute', bottom: -1, right: -1,
    width: 11, height: 11, borderRadius: 6, borderWidth: 2,
  },
  chatInfo: { flex: 1, minWidth: 0 },
  chatTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  chatName: { fontSize: 15, flexShrink: 1 },
  aiBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  aiBadgeText: { fontSize: 9, fontWeight: '700', color: '#0a0d14' },
  time: { fontSize: 11 },
  chatBottom: { flexDirection: 'row', alignItems: 'center' },
  preview: { flex: 1, fontSize: 13 },
  unreadBadge: {
    minWidth: 18, height: 18, paddingHorizontal: 6,
    borderRadius: 9, alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { fontSize: 11, color: '#0a0d14', fontWeight: '700' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
