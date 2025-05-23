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
  const isReadyRef = useRef(false);
  const presenceSentRef = useRef(false);
  const usernameRef = useRef('');

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    });
  };

  const shouldSendReadRef = useRef(true);

  const handleMessage = useCallback((msg: Message) => {
    if (!msg) return;

    // ✅ 既読受信処理
    if (msg.type === 'read') {
      const readId = msg.client_id || '';
      if (!seenReadIds.current.has(readId)) {
        seenReadIds.current.add(readId);
        console.log('👁 既読受信:', msg);

        setMessages(prev => {
          const updated = prev.map(m => {
            if (m.sender === usernameRef.current && msg.userId && !m.read_by?.includes(msg.userId)) {
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

    // クライアントID補完
    if (!msg.client_id) {
      msg.client_id = `fallback-${uuidv4()}`;
    }

    const alreadySeen = seenClientIds.current.has(msg.client_id);
    if ((!msg.text || msg.text.trim() === '') && (!msg.images || msg.images.length === 0)) return;

    // ✅ isMine 判定を usernameRef で
    const isMine = msg.sender === usernameRef.current;
    console.log('🧪 sender比較: msg.sender =', msg.sender, ', username =', usernameRef.current, ', isMine =', isMine);

    const newMsg: Message = {
      ...msg,
      read_status: isMine ? (msg.read_status ?? '未読') : undefined,
      read_by: msg.read_by ?? [],
    };

    if (!alreadySeen && msg.client_id) {
      seenClientIds.current.add(msg.client_id);

    setMessages(prev => {
    let updated: Message[] = [];
    const existsIndex = prev.findIndex(m => m.client_id === msg.client_id);

    if (existsIndex !== -1) {
      updated = [...prev];
      const existing = updated[existsIndex];
      updated[existsIndex] = {
        ...existing,
        text: msg.text !== undefined ? msg.text : existing.text,
        images: (msg.images && msg.images.length > 0) ? msg.images : existing.images,
        type: msg.type !== undefined ? msg.type : existing.type,
        read_by: msg.read_by ?? existing.read_by,
        read_status: existing.read_status,
      };
    } else {
      updated = [...prev, newMsg];
    }

    messagesRef.current = updated;

    requestAnimationFrame(() => {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 30);
    });

    return updated;
  });

      // ✅ 既読送信（非自分メッセージかつ条件成立時）
      let retryCount = 0;
      const MAX_RETRY = 20;

      const trySendInstantRead = () => {
        if (!isMine && shouldSendReadRef.current && isReadyRef.current && presenceSentRef.current && typeof sendMessageRef.current === 'function') {
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
        } else if (retryCount < MAX_RETRY) {
          retryCount++;
          console.warn(`⏳ handleMessage未準備: retry = ${retryCount}, isMine=`, isMine, ', shouldSendRead=', shouldSendReadRef.current, ', isReady=', isReadyRef.current, ', presenceSent=', presenceSentRef.current);
          setTimeout(trySendInstantRead, 100);
        } else {
          console.warn('🔚 trySendInstantRead 最大リトライ到達。read送信は中断します');
        }
      };

      trySendInstantRead();
    }
  }, [userId, roomId]);

  const { sendMessage, isReady, disconnect } = useWebSocket(Number(roomId), handleMessage);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    const updateShouldSendRead = () => {
      const isVisible = document.visibilityState === 'visible';
      const isChatRoom = pathname?.startsWith(`/chat/${roomId}`);
      shouldSendReadRef.current = isVisible && isChatRoom;
      console.log('📡 visibility change: shouldSendReadRef =', shouldSendReadRef.current);
    };

    document.addEventListener('visibilitychange', updateShouldSendRead);
    updateShouldSendRead(); // 初回も実行
    return () => document.removeEventListener('visibilitychange', updateShouldSendRead);
  }, [pathname, roomId]);


  const shouldConnectNotify = !!roomId && !!userId && !Number.isNaN(Number(roomId)) && !Number.isNaN(Number(userId));

  const {
    isReady: isNotifySocketReady,
    sendNotify,
    presenceSent,
  } = useWebSocketNotify(
    shouldConnectNotify ? Number(roomId) : 0,
    shouldConnectNotify ? Number(userId) : 0,
    (notifyMsg) => {
      console.log('🧪 notifyMsg:', notifyMsg, 'userId(localStorage):', userId);
      const presenceKey = `${notifyMsg.type}-${notifyMsg.action}-${notifyMsg.userId}-${notifyMsg.roomId}`;
      if (seenPresenceIds.current.has(presenceKey)) return;
      seenPresenceIds.current.add(presenceKey);

      const notifyUserId = Number(notifyMsg.userId);
      const currentUserId = Number(userId);
      console.log('📌 比較: notifyMsg.userId:', notifyUserId, 'vs local userId:', currentUserId, '==>', notifyUserId !== currentUserId);

      if (
          notifyMsg.type === 'presence' &&
          notifyMsg.action === 'enter' &&
          notifyMsg.roomId === Number(roomId) &&
          notifyUserId !== currentUserId
        ){
          let retryCount = 0;
          const trySendRead = () => {
            console.log('🟡 presence trySendRead 実行');
            console.log('🧾 messagesRef.current:', messagesRef.current);

            const unreadMessages = messagesRef.current.filter(
              (m) =>
                m.sender !== username &&
                m.id > 0 &&
                !seenReadIds.current.has(`read-${userId}-${roomId}-${m.id}`)
            );

            if (unreadMessages.length > 0) {
              console.log(`📬 presence経由 未読メッセージ数: ${unreadMessages.length}`);

              unreadMessages.forEach((m) => {
                const readClientId = `read-${userId}-${roomId}-${m.id}`;
                seenReadIds.current.add(readClientId);
                const payload = {
                  type: 'read',
                  roomId: Number(roomId),
                  userId: Number(userId),
                  client_id: readClientId,
                  messageId: m.id,
                };
                console.log('📤 presence経由 read送信 payload:', payload);
                sendMessageRef.current(payload);
              });
            } else if (retryCount < 5) {
              retryCount++;
              console.warn('⏳ presence未読なし⇒再試行（retry =', retryCount, '）');
              setTimeout(trySendRead, 300);
            } else {
              console.warn('❗ presence経由read送信失敗（全件既読済み）⇒ fetchMessages() 呼出');
              fetchMessages();
            }
          };

          let presenceRetryCount = 0;
          const waitForReady = () => {
            console.log('🧩 waitForReadyチェック',
              'shouldSendRead=', shouldSendReadRef.current,
              'isReady=', isReadyRef.current,
              'presenceSent=', presenceSentRef.current,
              'sendMessageRef=', typeof sendMessageRef.current === 'function'
            );

            if (shouldSendReadRef.current && isReadyRef.current && presenceSentRef.current && typeof sendMessageRef.current === 'function') {
              trySendRead();
            } else if (presenceRetryCount < 20) {
              presenceRetryCount++;
              console.warn('⏳ presence handler waitForReady: retry =', presenceRetryCount);
              setTimeout(waitForReady, 100);
            } else {
              console.warn('🔚 fetchMessages waitForReady: 最大リトライ到達。次回入室時に再試行されます');
            }
          };

          waitForReady();
        }
    }
  );

  console.log('✅ presenceSent:', presenceSent, 'notifyReady:', isNotifySocketReady);

    // 👇 presenceSent を useRef に反映する useEffect を追加
  useEffect(() => {
    presenceSentRef.current = presenceSent;
    console.log('📍 presenceSentRef 更新:', presenceSentRef.current);
  }, [presenceSent]);

  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);
  
  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

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

        seenClientIds.current = new Set(filtered.map(m => m.client_id!).filter(Boolean));
        seenReadIds.current = new Set();

       let retryCount = 0;
      const trySendRead = (retry = 0) => {
        console.log('🟡 trySendRead 実行（retry =', retry, '）');
        console.log('🧾 messagesRef.current:', messagesRef.current);

        const unreadMessages = messagesRef.current.filter(
          (m) =>
            m.sender !== username &&
            m.id > 0 &&
            !seenReadIds.current.has(`read-${userId}-${roomId}-${m.id}`)
        );

          console.log('🔍 unreadCandidates:', messagesRef.current);
          messagesRef.current.forEach((m) => {
            console.log(`📌 sender比較: msg.sender="${m.sender}", username="${username}", 判定=${m.sender !== username}`);
            console.log(`🔎 msg.id=${m.id}, text="${m.text}", seenReadIdCheck=${seenReadIds.current.has(`read-${userId}-${roomId}-${m.id}`)}`);
          });
          console.log('📬 unreadMessages:', unreadMessages);

        if (unreadMessages.length > 0) {
          console.log(`📬 未読メッセージ数: ${unreadMessages.length}`);

          unreadMessages.forEach((m) => {
            const readClientId = `read-${userId}-${roomId}-${m.id}`;
            seenReadIds.current.add(readClientId);
            const payload = {
              type: 'read',
              roomId: Number(roomId),
              userId: Number(userId),
              client_id: readClientId,
              messageId: m.id,
            };
            console.log('📤 read送信 payload:', payload);
            sendMessageRef.current(payload);
          });
        } else if (retry < 2) {
          console.warn('⏳ 全件既読条件未達のため再試行へ（retry =', retry + 1, '）');
          setTimeout(() => trySendRead(retry + 1), 300);
        } else {
          console.warn('❗ trySendRead 最終失敗（既読対象なし）');
        }
      };

      let fetchRetryCount = 0;
      const waitForReady = () => {
        console.log('🧩 waitForReadyチェック',
          'shouldSendRead=', shouldSendReadRef.current,
          'isReady=', isReadyRef.current,
          'presenceSent=', presenceSentRef.current,
          'sendMessageRef=', typeof sendMessageRef.current === 'function'
        );

        if (shouldSendReadRef.current && isReadyRef.current && presenceSentRef.current && typeof sendMessageRef.current === 'function') {
          trySendRead();
          setTimeout(() => trySendRead(1), 300);
        } else if (fetchRetryCount < 20) {
          fetchRetryCount++;
          console.warn('⏳ fetchMessages waitForReady: retry =', fetchRetryCount);
          setTimeout(waitForReady, 100);
        } else {
          console.warn('🔚 fetchMessages waitForReady: 最大リトライ到達。次回入室時に再試行されます');
        }
      };
      waitForReady();

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
  }, [roomId, userId, pathname]);

  const sendUserMessage = async () => {
    const token = localStorage.getItem('token');
    if (!token || (!text.trim() && !imageFile)) return;

    if (text.trim() && imageFile) {
      alert('テキストメッセージと画像は同時に送信できません。どちらか一方を選択してください。');
      return;
    }

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

        if (!seenClientIds.current.has(finalMsg.client_id!)) {
          seenClientIds.current.add(finalMsg.client_id!);
          sendMessage(finalMsg);
        }

        setMessages(prev => {
          const updated = prev.map(m => (m.client_id === clientId ? finalMsg : m));
          messagesRef.current = updated;
          return updated;
        });

        setImageFile(null);
      } else {
        const finalTextMsg = { ...tempMsg, id: msgId };

        if (!seenClientIds.current.has(finalTextMsg.client_id!)) {
          seenClientIds.current.add(finalTextMsg.client_id!);
          sendMessage(finalTextMsg);
        }

        setText('');
      }
    } catch (err) {
      console.error('❌ メッセージ送信または画像アップロード失敗:', err);
      alert('メッセージ送信に失敗しました。もう一度お試しください。');
    }
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
                    onLoad={() => {
                      setTimeout(() => {
                        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                      }, 50);
                    }}
                  />
                ))
              }
              {isMe && (
                <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
                  {isGroup
                    ? `既読 ${(msg.read_by?.filter(id => id !== Number(userId)).length) ?? 0}`
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
