import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePreventScreenCapture, addScreenshotListener } from 'expo-screen-capture';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal,
  Pressable, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { Message, Contact, ReplyTo } from '../db';
import {
  randomId,
  encryptForRecipients,
  decryptForMe,
  packPayload,
  unpackPayload,
  isEncryptedPayloadString,
} from '../crypto';
import { FONTS } from '../theme';
import { MainStackParams } from '../navigation';
import Avatar from '../components/Avatar';
import {
  BackIcon, SendIcon, EditIcon, TrashIcon, ShieldIcon, HeartIcon, ReplyIcon, CloseIcon,
} from '../components/Icons';
import { getAIReply, isAIError } from '../aiClient';
import { api, ServerConversation, ServerMessage } from '../api';

type Props = {
  navigation: StackNavigationProp<MainStackParams, 'Chat'>;
  route: RouteProp<MainStackParams, 'Chat'>;
};

function formatMsgTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

function hueFromId(id: string): number {
  return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 7) % 360;
}

function decryptCipher(s: string, myUserId: string, myPriv: string): string {
  if (!s) return '';
  if (!isEncryptedPayloadString(s)) return s; // tolerate legacy plaintext rows
  try {
    return decryptForMe(myUserId, myPriv, unpackPayload(s));
  } catch {
    return '[unable to decrypt]';
  }
}

function serverToMessage(m: ServerMessage, myUserId: string, myPriv: string): Message {
  return {
    id: m.id,
    from: m.senderId,
    text: decryptCipher(m.content, myUserId, myPriv),
    ts: new Date(m.createdAt).getTime(),
    likes: m.likes ?? [],
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          senderId: m.replyTo.senderId,
          senderName: m.replyTo.senderDisplayName,
          content: decryptCipher(m.replyTo.content, myUserId, myPriv),
        }
      : undefined,
  };
}

function TypingDots({ color }: { color: string }) {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.delay(300),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 4 }}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 6, height: 6, borderRadius: 3, backgroundColor: color,
            opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
            transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
          }}
        />
      ))}
    </View>
  );
}

type SysEvent = { _isSystem: true; id: string; text: string; ts: number };
type ListItem = Message | SysEvent;

interface BubbleProps {
  msg: Message;
  isMine: boolean;
  contact: Contact | undefined;
  peerName: string | undefined;
  peerHue: number | undefined;
  myUserId: string;
  accent: string;
  surface1: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  accentBg: string;
  accentBorder: string;
  error: string;
  onLongPress: (msg: Message) => void;
}

function SystemMessage({ text, accent }: { text: string; accent: string }) {
  return (
    <View style={styles.systemMsgRow}>
      <View style={[styles.systemMsgPill, { borderColor: accent }]}>
        <Text style={[styles.systemMsgText, { color: accent, fontFamily: FONTS.mono }]}>{text}</Text>
      </View>
    </View>
  );
}

function MessageBubble({
  msg, isMine, contact, peerName, peerHue, myUserId,
  accent, surface1, surface2, border, text, textDim, accentBg, accentBorder, error,
  onLongPress,
}: BubbleProps) {
  if (msg.deleted) {
    return (
      <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
        <Text style={[styles.deletedText, { color: textDim, fontFamily: FONTS.body }]}>
          Message deleted
        </Text>
      </View>
    );
  }

  const avatarLabel = contact?.name ?? peerName ?? '?';
  const avatarHue = contact?.avatar.hue ?? peerHue ?? 200;
  const likes = msg.likes ?? [];
  const iLiked = likes.includes(myUserId);

  return (
    <TouchableOpacity
      onLongPress={() => onLongPress(msg)}
      activeOpacity={0.85}
      style={[styles.msgRow, isMine && styles.msgRowMine]}
    >
      {!isMine && (
        <Avatar hue={avatarHue} size={28} label={avatarLabel} glow={false} />
      )}
      <View style={{ maxWidth: '78%' }}>
        <View
          style={[
            styles.bubble,
            isMine
              ? { backgroundColor: accentBg, borderColor: accentBorder, borderWidth: 1 }
              : { backgroundColor: surface1, borderColor: border, borderWidth: 1 },
          ]}
        >
          {msg.replyTo && (
            <View
              style={[
                styles.replyQuote,
                { borderLeftColor: accent, backgroundColor: surface2 },
              ]}
            >
              <Text
                style={[styles.replyQuoteName, { color: accent, fontFamily: FONTS.mono }]}
                numberOfLines={1}
              >
                {msg.replyTo.senderId === myUserId ? 'You' : msg.replyTo.senderName}
              </Text>
              <Text
                style={[styles.replyQuoteText, { color: textDim, fontFamily: FONTS.body }]}
                numberOfLines={2}
              >
                {msg.replyTo.content}
              </Text>
            </View>
          )}
          <Text style={[styles.bubbleText, { color: text, fontFamily: FONTS.body }]}>
            {msg.text}
          </Text>
          <View style={styles.bubbleMeta}>
            {msg.edited && (
              <Text style={[styles.editedLabel, { color: textDim, fontFamily: FONTS.mono }]}>edited</Text>
            )}
            <Text style={[styles.msgTime, { color: textDim, fontFamily: FONTS.mono }]}>
              {formatMsgTime(msg.ts)}
            </Text>
          </View>
        </View>
        {likes.length > 0 && (
          <View
            style={[
              styles.likeBadge,
              isMine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
              { backgroundColor: surface2, borderColor: border },
            ]}
          >
            <HeartIcon color={iLiked ? error : textDim} size={11} filled={iLiked} />
            {likes.length > 1 && (
              <Text style={[styles.likeCount, { color: textDim, fontFamily: FONTS.mono }]}>
                {likes.length}
              </Text>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ChatScreen({ navigation, route }: Props) {
  const { chatId } = route.params;
  const {
    vault, updateVault, theme, token, serverConversations, refreshSync,
  } = useApp();

  const [inputText, setInputText] = useState('');
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [aiTyping, setAiTyping] = useState(false);
  const [serverMessages, setServerMessages] = useState<Message[]>([]);
  const flatListRef = useRef<FlatList>(null);
  const [systemEvents, setSystemEvents] = useState<SysEvent[]>([]);

  usePreventScreenCapture();

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = addScreenshotListener(() => {
      setSystemEvents((prev) => [
        ...prev,
        { _isSystem: true, id: randomId(), text: '⚠ Screenshot attempt detected', ts: Date.now() },
      ]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  if (!vault) return null;

  const localChat = vault.chats.find((c) => c.id === chatId);
  const serverConv: ServerConversation | undefined =
    !localChat ? serverConversations.find((c) => c.id === chatId) : undefined;

  if (!localChat && !serverConv) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[{ color: theme.textDim, fontFamily: FONTS.body }]}>Conversation not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={[{ color: theme.accent, fontFamily: FONTS.mono }]}>← Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isServer = !!serverConv;
  const isAI =
    !!localChat &&
    localChat.kind === 'dm' &&
    !!vault.contacts.find((c) => c.id === localChat.participants[0])?.ai;

  const localContact: Contact | undefined =
    localChat && localChat.kind === 'dm'
      ? vault.contacts.find((c) => c.id === localChat.participants[0])
      : undefined;

  const peerName = serverConv ? serverConv.peerDisplayName : undefined;
  const peerHue = serverConv ? hueFromId(serverConv.peerUserId) : undefined;
  const title = localContact
    ? localContact.name
    : serverConv ? serverConv.peerDisplayName : localChat?.name ?? 'Chat';

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ── Server long-polling loop ────────────────────────────────
  // Replaces interval polling. Each call hangs up to ~25s on the server until
  // a new message arrives or timeout, then we re-issue immediately. Updates
  // (likes, replies) bubble back through the same channel.
  const serverMessagesRef = useRef<Message[]>([]);
  serverMessagesRef.current = serverMessages;

  useEffect(() => {
    if (!isServer || !serverConv || !token) return;
    let cancelled = false;

    const mergeIncoming = (incoming: ServerMessage[]) => {
      if (incoming.length === 0) return;
      setServerMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const sm of incoming) byId.set(sm.id, serverToMessage(sm, vault.profile.id, vault.profile.privateKey));
        return Array.from(byId.values()).sort((a, b) => a.ts - b.ts);
      });
      scrollToEnd();
    };

    const loop = async () => {
      // Initial fetch (full history).
      try {
        const { messages } = await api.getMessages(token, serverConv.id);
        if (cancelled) return;
        mergeIncoming(messages);
      } catch {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 2000));
      }

      // Long-poll loop using the latest msg ts as the watermark.
      while (!cancelled) {
        const latest = serverMessagesRef.current[serverMessagesRef.current.length - 1];
        const sinceIso = latest ? new Date(latest.ts).toISOString() : undefined;
        try {
          const { messages } = await api.getMessages(token, serverConv.id, {
            since: sinceIso,
            wait: true,
          });
          if (cancelled) return;
          mergeIncoming(messages);
        } catch {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };

    void loop();
    return () => {
      cancelled = true;
    };
  }, [isServer, serverConv?.id, token, scrollToEnd]);

  // ── Send handlers ───────────────────────────────────────────
  const sendLocalMessage = useCallback(async () => {
    if (!localChat) return;
    const text = inputText.trim();
    if (!text) return;

    const newMsg: Message = {
      id: randomId(),
      from: vault.profile.id,
      text,
      ts: Date.now(),
      ...(replyingTo
        ? {
            replyTo: {
              id: replyingTo.id,
              senderId: replyingTo.from,
              senderName:
                replyingTo.from === vault.profile.id
                  ? vault.profile.displayName
                  : localContact?.name ?? 'Unknown',
              content: replyingTo.text.slice(0, 200),
            },
          }
        : {}),
    };

    const updatedChats = vault.chats.map((c) => {
      if (c.id !== localChat.id) return c;
      return { ...c, messages: [...c.messages, newMsg], unread: 0 };
    });

    setInputText('');
    setReplyingTo(null);
    await updateVault({ ...vault, chats: updatedChats });
    scrollToEnd();

    if (isAI && localContact) {
      setAiTyping(true);
      scrollToEnd();
      try {
        const replyText = await getAIReply(
          [...localChat.messages, newMsg],
          vault.profile.id,
          localContact.id,
          vault.settings.aiApiKey,
        );
        const aiMsg: Message = {
          id: randomId(),
          from: localContact.id,
          text: replyText,
          ts: Date.now(),
        };
        const withAI = updatedChats.map((c) => {
          if (c.id !== localChat.id) return c;
          return { ...c, messages: [...c.messages, aiMsg] };
        });
        setAiTyping(false);
        await updateVault({ ...vault, chats: withAI });
        scrollToEnd();
      } catch (e) {
        setAiTyping(false);
        const errText = isAIError(e) ? `[AI error: ${e.message}]` : '[AI failed to respond]';
        const errMsg: Message = {
          id: randomId(),
          from: localContact.id,
          text: errText,
          ts: Date.now(),
        };
        const withErr = updatedChats.map((c) => {
          if (c.id !== localChat.id) return c;
          return { ...c, messages: [...c.messages, errMsg] };
        });
        await updateVault({ ...vault, chats: withErr });
        scrollToEnd();
      }
    }
  }, [inputText, replyingTo, vault, localChat, isAI, localContact, updateVault, scrollToEnd]);

  const sendServerMessage = useCallback(async () => {
    if (!serverConv || !token) return;
    const text = inputText.trim();
    if (!text) return;

    const replySnapshot: ReplyTo | undefined = replyingTo
      ? {
          id: replyingTo.id,
          senderId: replyingTo.from,
          senderName:
            replyingTo.from === vault.profile.id
              ? vault.profile.displayName
              : serverConv.peerDisplayName,
          content: replyingTo.text.slice(0, 200),
        }
      : undefined;

    setInputText('');
    setReplyingTo(null);

    const optimistic: Message = {
      id: `pending_${randomId()}`,
      from: vault.profile.id,
      text,
      ts: Date.now(),
      likes: [],
      ...(replySnapshot ? { replyTo: replySnapshot } : {}),
    };
    setServerMessages((prev) => [...prev, optimistic]);
    scrollToEnd();

    try {
      const payload = encryptForRecipients(text, [
        { userId: vault.profile.id, publicKey: vault.profile.publicKey },
        { userId: serverConv.peerUserId, publicKey: serverConv.peerPublicKey },
      ]);
      const created = await api.sendMessage(
        token,
        serverConv.id,
        packPayload(payload),
        replySnapshot?.id,
      );
      setServerMessages((prev) =>
        prev
          .filter((m) => m.id !== optimistic.id)
          .concat(serverToMessage(created, vault.profile.id, vault.profile.privateKey))
          .sort((a, b) => a.ts - b.ts),
      );
      void refreshSync();
    } catch (e: any) {
      setServerMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setSystemEvents((prev) => [
        ...prev,
        {
          _isSystem: true,
          id: randomId(),
          text: `⚠ Failed to send: ${e?.message ?? 'unknown error'}`,
          ts: Date.now(),
        },
      ]);
    }
  }, [inputText, replyingTo, serverConv, token, vault.profile.id, vault.profile.displayName, refreshSync, scrollToEnd]);

  const sendMessage = isServer ? sendServerMessage : sendLocalMessage;

  const sendEditedMessage = useCallback(async () => {
    if (!editingMsg || !inputText.trim() || !localChat) return;
    const text = inputText.trim();
    const updatedChats = vault.chats.map((c) => {
      if (c.id !== localChat.id) return c;
      return {
        ...c,
        messages: c.messages.map((m) =>
          m.id === editingMsg.id ? { ...m, text, edited: true } : m,
        ),
      };
    });
    setInputText('');
    setEditingMsg(null);
    await updateVault({ ...vault, chats: updatedChats });
  }, [editingMsg, inputText, vault, localChat, updateVault]);

  const deleteMessage = useCallback(
    async (msgId: string) => {
      if (!localChat) return;
      const updatedChats = vault.chats.map((c) => {
        if (c.id !== localChat.id) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, deleted: true, text: '' } : m,
          ),
        };
      });
      await updateVault({ ...vault, chats: updatedChats });
    },
    [vault, localChat, updateVault],
  );

  const toggleLike = useCallback(
    async (msg: Message) => {
      if (isServer && serverConv && token) {
        const myId = vault.profile.id;
        // Optimistic toggle.
        setServerMessages((prev) =>
          prev.map((m) => {
            if (m.id !== msg.id) return m;
            const cur = m.likes ?? [];
            return cur.includes(myId)
              ? { ...m, likes: cur.filter((u) => u !== myId) }
              : { ...m, likes: [...cur, myId] };
          }),
        );
        try {
          const updated = await api.likeMessage(token, serverConv.id, msg.id);
          setServerMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? serverToMessage(updated, vault.profile.id, vault.profile.privateKey) : m)),
          );
        } catch {
          // Roll back on failure.
          setServerMessages((prev) =>
            prev.map((m) => {
              if (m.id !== msg.id) return m;
              const cur = m.likes ?? [];
              return cur.includes(myId)
                ? { ...m, likes: cur.filter((u) => u !== myId) }
                : { ...m, likes: [...cur, myId] };
            }),
          );
        }
        return;
      }
      // Local AI chat: just update vault.
      if (!localChat) return;
      const myId = vault.profile.id;
      const updatedChats = vault.chats.map((c) => {
        if (c.id !== localChat.id) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== msg.id) return m;
            const cur = m.likes ?? [];
            return cur.includes(myId)
              ? { ...m, likes: cur.filter((u) => u !== myId) }
              : { ...m, likes: [...cur, myId] };
          }),
        };
      });
      await updateVault({ ...vault, chats: updatedChats });
    },
    [isServer, serverConv, token, vault, localChat, updateVault],
  );

  const handleLongPress = (msg: Message) => {
    if (msg.deleted) return;
    setActionMsg(msg);
  };

  const messages: Message[] = isServer ? serverMessages : localChat?.messages ?? [];
  const allItems: ListItem[] = [...messages, ...systemEvents].sort((a, b) => a.ts - b.ts);

  const isMyActionMsg = actionMsg ? actionMsg.from === vault.profile.id : false;
  const canEditDelete = !isServer && isMyActionMsg && !isAI; // edit/delete only on own non-AI local messages — currently none of those exist after refactor, but keep the flag for the AI bot too if mine

  // Allow edit/delete on own AI-chat messages (local) only — server messages are immutable for now.
  const canEditDeleteFinal = !isServer && isMyActionMsg;

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.matrixBg, { opacity: 0.04, pointerEvents: 'none' }]}>
        <Text style={[styles.matrixText, { color: theme.accent }]}>
          {'01010110010101110100011101010010010001100101100101010010\n'.repeat(40)}
        </Text>
      </View>

      <SafeAreaView style={{ flex: 1 }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <BackIcon color={theme.accent} size={20} />
          </TouchableOpacity>
          <Avatar
            hue={localContact?.avatar.hue ?? peerHue ?? 200}
            size={36}
            label={title}
          />
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerTitle, { color: theme.text, fontFamily: FONTS.bodySemiBold }]}>
                {title}
              </Text>
              {isAI && (
                <View style={[styles.aiBadge, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.aiBadgeText, { fontFamily: FONTS.mono }]}>AI</Text>
                </View>
              )}
            </View>
            <View style={styles.headerSub}>
              <ShieldIcon color={theme.accent} size={9} />
              <Text style={[styles.headerSubText, { color: theme.accent, fontFamily: FONTS.mono }]}>
                encrypted
              </Text>
              {localContact?.online && (
                <View style={[styles.onlineDot, { backgroundColor: '#4ade80' }]} />
              )}
            </View>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          enabled={Platform.OS === 'ios'}
        >
          <FlatList<ListItem>
            ref={flatListRef}
            data={allItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => {
              if ('_isSystem' in item) {
                return <SystemMessage text={item.text} accent={theme.accent} />;
              }
              return (
                <MessageBubble
                  msg={item}
                  isMine={item.from === vault.profile.id}
                  contact={localContact}
                  peerName={peerName}
                  peerHue={peerHue}
                  myUserId={vault.profile.id}
                  accent={theme.accent}
                  surface1={theme.surface1}
                  surface2={theme.surface2}
                  border={theme.border}
                  text={theme.text}
                  textDim={theme.textDim}
                  accentBg={theme.accentBg}
                  accentBorder={theme.accentBorder}
                  error={theme.error}
                  onLongPress={handleLongPress}
                />
              );
            }}
            onContentSizeChange={scrollToEnd}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              aiTyping ? (
                <View style={styles.typingRow}>
                  {localContact && <Avatar hue={localContact.avatar.hue} size={28} label={localContact.name} glow={false} />}
                  <View style={[styles.typingBubble, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
                    <TypingDots color={theme.accent} />
                  </View>
                </View>
              ) : null
            }
          />

          {(editingMsg || replyingTo) && (
            <View
              style={[
                styles.composerBanner,
                { backgroundColor: theme.surface1, borderTopColor: theme.accentBorder },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.composerLabel, { color: theme.accent, fontFamily: FONTS.mono }]}>
                  {editingMsg ? 'EDITING MESSAGE' : `REPLYING TO ${
                    replyingTo!.from === vault.profile.id
                      ? 'YOURSELF'
                      : (localContact?.name ?? peerName ?? '').toUpperCase()
                  }`}
                </Text>
                {replyingTo && (
                  <Text
                    style={[styles.composerPreview, { color: theme.textDim, fontFamily: FONTS.body }]}
                    numberOfLines={1}
                  >
                    {replyingTo.text}
                  </Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (editingMsg) {
                    setEditingMsg(null);
                    setInputText('');
                  } else {
                    setReplyingTo(null);
                  }
                }}
                style={{ padding: 6 }}
              >
                <CloseIcon color={theme.textDim} size={14} />
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.inputBar, { backgroundColor: theme.surface1, borderTopColor: theme.border }]}>
            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message…"
              placeholderTextColor={theme.textDim}
              multiline
              underlineColorAndroid="transparent"
              autoCorrect={false}
              style={[styles.input, { color: theme.text, fontFamily: FONTS.body, borderColor: theme.border }]}
              onSubmitEditing={editingMsg ? sendEditedMessage : sendMessage}
            />
            <TouchableOpacity
              onPress={editingMsg ? sendEditedMessage : sendMessage}
              disabled={!inputText.trim()}
              style={[
                styles.sendBtn,
                { backgroundColor: inputText.trim() ? theme.accent : theme.surface2 },
              ]}
              activeOpacity={0.8}
            >
              <SendIcon color={inputText.trim() ? '#0a0d14' : theme.textDim} size={16} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={!!actionMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMsg(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setActionMsg(null)}>
          <View style={[styles.actionSheet, { backgroundColor: theme.surface1, borderColor: theme.border }]}>
            <Text style={[styles.actionTitle, { color: theme.textDim, fontFamily: FONTS.mono }]}>
              Message actions
            </Text>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                if (actionMsg) void toggleLike(actionMsg);
                setActionMsg(null);
              }}
            >
              <HeartIcon
                color={theme.error}
                size={16}
                filled={actionMsg ? (actionMsg.likes ?? []).includes(vault.profile.id) : false}
              />
              <Text style={[styles.actionLabel, { color: theme.text, fontFamily: FONTS.body }]}>
                {actionMsg && (actionMsg.likes ?? []).includes(vault.profile.id) ? 'Unlike' : 'Like'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                if (actionMsg) {
                  setReplyingTo(actionMsg);
                  setEditingMsg(null);
                }
                setActionMsg(null);
              }}
            >
              <ReplyIcon color={theme.accent} size={16} />
              <Text style={[styles.actionLabel, { color: theme.text, fontFamily: FONTS.body }]}>
                Reply
              </Text>
            </TouchableOpacity>
            {canEditDeleteFinal && (
              <>
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => {
                    if (actionMsg) {
                      setEditingMsg(actionMsg);
                      setInputText(actionMsg.text);
                      setReplyingTo(null);
                    }
                    setActionMsg(null);
                  }}
                >
                  <EditIcon color={theme.accent} size={16} />
                  <Text style={[styles.actionLabel, { color: theme.text, fontFamily: FONTS.body }]}>
                    Edit
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => {
                    if (actionMsg) deleteMessage(actionMsg.id);
                    setActionMsg(null);
                  }}
                >
                  <TrashIcon color={theme.error} size={16} />
                  <Text style={[styles.actionLabel, { color: theme.error, fontFamily: FONTS.body }]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  matrixBg: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  matrixText: { fontSize: 8, lineHeight: 14, letterSpacing: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  headerInfo: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 16 },
  aiBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  aiBadgeText: { fontSize: 9, fontWeight: '700', color: '#0a0d14' },
  headerSub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerSubText: { fontSize: 9, letterSpacing: 0.8 },
  onlineDot: { width: 6, height: 6, borderRadius: 3 },
  messageList: { padding: 12, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 4 },
  msgRowMine: { flexDirection: 'row-reverse' },
  typingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 4 },
  typingBubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleMeta: { flexDirection: 'row', gap: 4, marginTop: 2, justifyContent: 'flex-end' },
  editedLabel: { fontSize: 9, letterSpacing: 0.5 },
  msgTime: { fontSize: 9 },
  replyQuote: {
    borderLeftWidth: 3,
    borderRadius: 6,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 5,
    marginBottom: 6,
  },
  replyQuoteName: { fontSize: 10, letterSpacing: 0.6, marginBottom: 1 },
  replyQuoteText: { fontSize: 12, lineHeight: 16 },
  likeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: -6,
  },
  likeCount: { fontSize: 10 },
  systemMsgRow: { alignItems: 'center', marginVertical: 6 },
  systemMsgPill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, opacity: 0.75 },
  systemMsgText: { fontSize: 9, letterSpacing: 0.8 },
  deletedText: { fontSize: 13, fontStyle: 'italic', paddingHorizontal: 12, paddingVertical: 4 },
  composerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  composerLabel: { fontSize: 10, letterSpacing: 0.8 },
  composerPreview: { fontSize: 12, marginTop: 2 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 100,
    minHeight: 38,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  actionSheet: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 8,
  },
  actionTitle: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionLabel: { fontSize: 15 },
});
