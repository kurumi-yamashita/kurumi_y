// ✅ ChatRoomPage.tsx（read_by 対応） ※ presence-read修正・最新messages対応版（前後半適用済）

'use client';

import { useParams, useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import { FiLogOut, FiChevronLeft, FiUserX } from 'react-icons/fi';
import { useWebSocket } from '@/utils/useWebSocket';
import { useWebSocketNotify } from '@/utils/useWebSocketNotify';
import { v4 as uuidv4 } from 'uuid';

type Message = {
  id: number;
  text: string;
  sender: string;
  read_count?: number;
  read_status?: string;
  read_by?: number[];
  images?: string[];
  type?: string;
  userId?: number;
  client_id?: string;
  roomId?: number;
};

export default function ChatRoomPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const roomIdRaw = params?.roomId;
  const roomId = Array.isArray(roomIdRaw) ? roomIdRaw[0] : roomIdRaw ?? '';

  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [isGroup, setIsGroup] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);

  const seenClientIds = useRef<Set<string>>(new Set());
  const seenReadIds = useRef<Set<string>>(new Set());
  const seenPresenceIds = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendMessageRef = useRef<(data: any) => void>(() => {});

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    });
  };

  const isChatRoomPage = pathname?.startsWith(`/chat/${roomId}`);
  const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
  const shouldSendRead = isChatRoomPage && isVisible;

  const isReadyRef = useRef(false);

  const handleMessage = useCallback((msg: Message) => {
    if (!msg) return;

    if (msg.type === 'read') {
      const readId = msg.client_id || '';
      if (!seenReadIds.current.has(readId)) {
        seenReadIds.current.add(readId);
        console.log('👁 既読受信:', msg);

        setMessages(prev => {
          const updated = prev.map(m => {
            if (m.sender === username && msg.userId && !m.read_by?.includes(msg.userId)) {
              return {
                ...m,
                read_by: [...(m.read_by || []), msg.userId],
              };
            }
            return m;
          });
          messagesRef.current = updated;
          return updated;
        });
      }
      return;
    }

    if (!msg.client_id) {
      msg.client_id = `fallback-${uuidv4()}`;
    }

    const alreadySeen = seenClientIds.current.has(msg.client_id);
    if (!msg.text?.trim() && (!msg.images || msg.images.length === 0)) return;

    const isMine = msg.sender === username;
    const newMsg: Message = {
      ...msg,
      read_status: isMine ? (msg.read_status ?? '未読') : undefined,
      read_by: msg.read_by ?? [],
    };

    if (!alreadySeen && msg.client_id) {
      seenClientIds.current.add(msg.client_id);

      setMessages(prev => {
        if (prev.some(m => m.client_id === msg.client_id)) return prev;
        const updated = [...prev, newMsg];
        messagesRef.current = updated;
        return updated;
      });

      if (!isMine && shouldSendRead && isReadyRef.current && presenceSent && typeof sendMessageRef.current === 'function') {
        const readClientId = `read-${userId}-${roomId}-${uuidv4()}`;
        seenReadIds.current.add(readClientId);
        const payload = {
          type: 'read',
          roomId: Number(roomId),
          userId: Number(userId),
          client_id: readClientId,
          messageId: msg.id,
        };
        console.log('📤 新規追加直後read送信:', payload);
        sendMessageRef.current(payload);
      }
    }
  }, [username, userId, roomId, shouldSendRead]);

  const { sendMessage, isReady, disconnect } = useWebSocket(Number(roomId), handleMessage);
  sendMessageRef.current = sendMessage;
  const shouldConnectNotify = !!roomId && !!userId && !Number.isNaN(Number(roomId)) && !Number.isNaN(Number(userId));
  const {
    isReady: isNotifySocketReady,
    sendNotify,
    presenceSent,
  } = useWebSocketNotify(
    shouldConnectNotify ? Number(roomId) : 0,
    shouldConnectNotify ? Number(userId) : 0,
    (notifyMsg) => {
      const presenceKey = `${notifyMsg.type}-${notifyMsg.action}-${notifyMsg.userId}-${notifyMsg.roomId}`;
      if (seenPresenceIds.current.has(presenceKey)) return;
      seenPresenceIds.current.add(presenceKey);

      if (
        notifyMsg.type === 'presence' &&
        notifyMsg.action === 'enter' &&
        notifyMsg.roomId === Number(roomId) &&
        notifyMsg.userId !== Number(userId)
      ) {
        const trySendRead = () => {
          const latestMsg = messagesRef.current
            .filter((m) => m.sender !== username && m.id > 0)
            .at(-1);

          if (
            latestMsg &&
            !seenReadIds.current.has(`read-${userId}-${roomId}-${latestMsg.id}`)
          ) {
            const readClientId = `read-${userId}-${roomId}-${uuidv4()}`;
            seenReadIds.current.add(readClientId);
            const payload = {
              type: 'read',
              roomId: Number(roomId),
              userId: Number(userId),
              client_id: readClientId,
              messageId: latestMsg.id,
            };
            console.log('📤 presence経由read送信（再試行含む）:', payload);
            sendMessageRef.current(payload);
          }
        };

        trySendRead();
        setTimeout(trySendRead, 300);
      }
    }
  );

  console.log('✅ presenceSent:', presenceSent, 'notifyReady:', isNotifySocketReady);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!roomId || !userId || Number.isNaN(Number(roomId)) || Number.isNaN(Number(userId))) {
        console.warn('❗ ping送信中止: roomId または userId が未定義');
        return;
      }
      sendNotify({ type: 'ping' });
    }, 30000);
    return () => clearInterval(interval);
  }, [sendNotify, roomId, userId]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUsername = localStorage.getItem('username');
    const uid = localStorage.getItem('userId');
    if (!token || !uid) {
      router.push('/');
      return;
    }
    setUserId(uid);
    if (storedUsername) setUsername(storedUsername);
    setIsAppReady(true);

    const handleUnload = () => localStorage.clear();
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [router]);

  const fetchMessages = () => {
    const token = localStorage.getItem('token');
    if (!roomId || !token || !userId) return;

    fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const filtered = data
            .filter((msg: Message) => msg.text?.trim() || (msg.images && msg.images.length > 0))
            .map(msg => ({
              ...msg,
              read_status: msg.sender === username ? msg.read_status : undefined,
              read_by: msg.read_by ?? [],
            }));
        setMessages(() => {
          messagesRef.current = filtered;
          return filtered;
        });

        // ルーム再入室で二重既読を避けるため、過去既読read_idもリセット
        seenClientIds.current = new Set(filtered.map(m => m.client_id!).filter(Boolean));
        seenReadIds.current = new Set();

          // 過去メッセージに対して read 送信
          if (
            shouldSendRead &&
            isReadyRef.current &&
            presenceSent &&
            typeof sendMessageRef.current === 'function'
          ) {
            const latestMsg = filtered
              .filter((m: Message) => m.sender !== username)
              .at(-1); // 🔍 最後の相手メッセージを取得

            if (latestMsg) {
              const readClientId = `read-${userId}-${roomId}-${uuidv4()}`;
              seenReadIds.current.add(readClientId);
              const payload = {
                type: 'read',
                roomId: Number(roomId),
                userId: Number(userId),
                client_id: readClientId,
                messageId: latestMsg.id,
              };
              console.log('📤 初期表示時read送信:', payload);
              sendMessageRef.current(payload);
            }
          }

          setTimeout(scrollToBottom, 100);
        }
      })
      .catch(err => console.error('❌ メッセージ取得失敗:', err));
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!roomId || !token || !userId) return;

    fetch(`http://localhost:8080/api/rooms/name?roomId=${roomId}&userId=${userId}`)
      .then(res => res.json())
      .then(data => {
        setRoomName(data.roomName);
        setMemberCount(data.memberCount);
        setIsGroup(data.isGroup === true);
      })
      .catch(err => console.error('ルーム名取得失敗:', err));

    fetchMessages();
  }, [roomId, userId, isVisible, pathname]);

  const sendUserMessage = async () => {
    const token = localStorage.getItem('token');
    if (!token || (!text.trim() && !imageFile)) return;

    const clientId = uuidv4();
    let uploadedImageUrls: string[] = [];

    const tempMsg: Message = {
      type: 'message',
      text,
      sender: username,
      read_status: '未読',
      read_by: [Number(userId)],
      client_id: clientId,
      userId: Number(userId),
      roomId: Number(roomId),
      images: [],
      id: 0,
    };

    setMessages(prev => {
      const updated = [...prev, tempMsg];
      messagesRef.current = updated;
      return updated;
    });
    scrollToBottom();

    try {
      const res = await fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text, client_id: clientId }),
      });

      const posted = await res.json();
      const msgId = posted?.id;
      if (!msgId) throw new Error('メッセージID取得失敗');

      if (imageFile) {
        const formData = new FormData();
        formData.append('image', imageFile);
        formData.append('message_id', msgId);
        const uploadRes = await fetch(`http://localhost:8080/api/upload?roomId=${roomId}`, {
          method: 'POST',
          body: formData,
        });
        const result = await uploadRes.json();
        if (Array.isArray(result.urls)) {
          uploadedImageUrls = result.urls;
        }
        const updatedMsg: Message = {
          ...tempMsg,
          id: msgId,
          images: uploadedImageUrls,
        };
        const finalMsg = { ...updatedMsg };
        setMessages(prev => prev.map(m => (m.client_id === clientId ? finalMsg : m)));

        if (!seenClientIds.current.has(finalMsg.client_id!)) {
          seenClientIds.current.add(finalMsg.client_id!);
          sendMessage(finalMsg);
        }
      } else {
        const finalTextMsg = { ...tempMsg, id: msgId };

        if (!seenClientIds.current.has(finalTextMsg.client_id!)) {
          seenClientIds.current.add(finalTextMsg.client_id!);
          sendMessage(finalTextMsg);
        }
      }
    } catch (err) {
      console.error('❌ メッセージ送信または画像アップロード失敗:', err);
      alert('メッセージ送信に失敗しました。もう一度お試しください。');
    }

    setText('');
    setImageFile(null);
  };

  const handleLogout = () => {
    if (window.confirm('本当にログアウトしますか？')) {
      disconnect();
      localStorage.clear();
      router.push('/');
    }
  };

  const handleLeaveRoom = async () => {
    if (!userId || !window.confirm('本当にこのルームから脱退しますか？')) return;
    const res = await fetch('http://localhost:8080/api/rooms/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: Number(roomId), userId: Number(userId) }),
    });
    if (res.ok) {
      disconnect();
      router.push('/rooms');
    } else {
      alert('ルーム脱退に失敗しました');
    }
  };

  return (
    <div style={{
      maxWidth: '600px',
      margin: '40px auto',
      padding: '24px',
      border: '1px solid #ddd',
      borderRadius: '8px',
      boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
      backgroundColor: 'white',
      position: 'relative'
    }}>
      <FiLogOut size={20} onClick={handleLogout} title="ログアウト"
        style={{ position: 'absolute', top: '16px', right: '16px', cursor: 'pointer', color: '#666' }} />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
        <FiChevronLeft size={20} onClick={() => router.push('/rooms')}
          style={{ cursor: 'pointer', marginRight: '8px', color: '#2563eb' }} title="ルーム選択に戻る" />
        <div style={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
            {roomName || `ルーム ${roomId}`} {isGroup && memberCount !== null ? `（${memberCount}）` : ''}
          </h2>
          {isGroup && (
            <FiUserX size={18} title="ルームから脱退" onClick={handleLeaveRoom}
              style={{ cursor: 'pointer', color: 'crimson', marginLeft: '8px' }} />
          )}
        </div>
      </div>

      <div style={{
        border: '1px solid #ccc',
        padding: '16px',
        height: '400px',
        overflowY: 'scroll',
        backgroundColor: '#f9f9f9',
        marginBottom: '16px'
      }}>
        {messages.map((msg, index) => {
          const isMe = msg.sender === username;
          const key = msg.client_id || `msg-${msg.id}-${msg.sender}-${index}`;
          const isValidMessage = msg && (msg.text?.trim() || (msg.images && msg.images.length > 0));
          if (!isValidMessage) return null;

          return (
            <div key={`${key}-${index}`} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isMe ? 'flex-end' : 'flex-start',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '12px', marginBottom: '4px' }}>{msg.sender}</div>
              {msg.text?.trim() && (
                <div style={{
                  backgroundColor: isMe ? '#dbeafe' : '#e5e7eb',
                  padding: '8px 12px',
                  borderRadius: '12px',
                  maxWidth: '60%',
                  wordBreak: 'break-word'
                }}>
                  {msg.text}
                </div>
              )}
              {Array.isArray(msg.images) && msg.images.length > 0 &&
                msg.images.map((url, idx) => (
                  <img
                    key={`${msg.id}-img-${idx}`}
                    src={url}
                    alt="添付画像"
                    style={{ maxWidth: '240px', marginTop: '6px', borderRadius: '8px', border: '1px solid #ccc' }}
                  />
                ))
              }
              {isMe && (
                <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
                  {isGroup
                    ? `既読 ${msg.read_by?.length ?? 0}`
                    : (msg.read_by && msg.read_by.length > 1 ? "既読" : "未読")}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} style={{ height: '1px' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="メッセージを入力"
          style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImageFile(e.target.files?.[0] || null)}
        />
        <button
          onClick={sendUserMessage}
          style={{
            backgroundColor: '#2563eb',
            color: 'white',
            padding: '8px 16px',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          送信
        </button>
      </div>
    </div>
  );
}
