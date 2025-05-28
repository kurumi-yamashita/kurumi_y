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
  content?: string;
  roomId?: number;
  replyTo?: {
    name: string;
    text: string;
    client_id?: string;
  };
};

type OutgoingMessage = {
  type: string;
  text?: string;
  content?: string;
  images?: string[];
  client_id: string;
  roomId: number;
  replyTo?: {
    name: string;
    text: string;
    client_id?: string;
  };
};

export default function ChatRoomPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const roomIdRaw = params?.roomId;
  const roomId = Array.isArray(roomIdRaw) ? roomIdRaw[0] : roomIdRaw ?? '';

  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const bubbleRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [username, setUsername] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState('');
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const [replyTo, setReplyTo] = useState<{ name: string; text: string; client_id?: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);
  const [showStampPicker, setShowStampPicker] = useState(false);
  const [stampToSend, setStampToSend] = useState<string | null>(null);
  const [isOnlyStamp, setIsOnlyStamp] = useState(false);

  const handleContextMenu = (e: React.MouseEvent, msg: Message) => {
    e.preventDefault();
    const el = bubbleRefs.current[msg.client_id || ''];
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const isMe = msg.sender === username;

    const x = isMe ? rect.right + 4 : rect.left - 124;
    const y = rect.top + window.scrollY;

    setContextMenu({
      x,
      y,
      msg,
    });
  };

  const handleCloseContextMenu = () => {
    setContextMenu(null);
  };

  const getMenuItemsWithHandlers = (msg: Message) => {
    const isMe = msg.sender === username;
    const isImage = Array.isArray(msg.images) && msg.images.length > 0 && msg.type === 'message';
    const isStamp = msg.type === 'stamp';
    const isText = !!msg.text && msg.type === 'message';

    const handleClick = (label: string) => {
      switch (label) {
        case 'リプライ':
          setReplyTo({ name: msg.sender, text: msg.text || '[画像]' });
          setText('');
          break;

        case 'コピー':
          if (msg.text) navigator.clipboard.writeText(msg.text);
          break;

        case '送信取消':
          fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
            body: JSON.stringify({
              text: '',
              client_id: msg.client_id,
              images: [],
              type: 'deleted',
            }),
          }).then(res => {
            if (!res.ok) console.warn('❌ サーバー側削除失敗');
          });

          setMessages((prev) =>
            prev.map((m) =>
              m.client_id === msg.client_id ? { ...m, type: 'deleted', text: '', images: [] } : m
            )
          );
          break;

        case '消去':
          fetch(`http://localhost:8080/api/message/delete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
            body: JSON.stringify({ client_id: msg.client_id }),
          }).then(res => {
            if (res.ok) {
              setMessages((prev) =>
                prev.filter((m) => m.client_id !== msg.client_id)
              );
            } else {
              alert('削除に失敗しました');
            }
          });
          break;

        case '拡大':
          if (msg.images && msg.images.length > 0) {
            setModalImageUrl(msg.images[0]);
          }
          break;

        default:
          alert(`${label} 機能は未実装です`);
      }

      setContextMenu(null);
    };

  return [
    { label: 'リプライ', show: !(isImage || isStamp) },
    { label: 'コピー', show: !(isImage || isStamp) },
    { label: '消去', show: true },
    { label: '送信取消', show: isMe },
  ]
      .filter((item) => item.show)
      .map((item) => ({
        ...item,
        onClick: () => handleClick(item.label),
      }));
  };

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

  const toggleStampPicker = () => {
    setShowStampPicker((prev) => !prev);
  };

  const waitForReady = async (): Promise<void> => {
    const MAX_RETRY = 20;
    let retry = 0;

    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (
          isReadyRef.current &&
          presenceSentRef.current &&
          typeof sendMessageRef.current === 'function'
        ) {
          resolve();
        } else if (retry < MAX_RETRY) {
          retry++;
          setTimeout(check, 100);
        } else {
          console.warn('⏳ waitForReady 最大リトライ到達');
          reject(new Error('waitForReady timed out'));
        }
      };
      check();
    });
  };

  const waitForSendMessageRefReady = async () => {
    const MAX_WAIT = 20;
    let count = 0;
    while (!sendMessageRef.current && count < MAX_WAIT) {
      console.warn("⏳ sendMessageRef.current を待機中（", count, "）");
      await new Promise((res) => setTimeout(res, 100));
      count++;
    }
    if (!sendMessageRef.current) {
      throw new Error("sendMessageRef.current が未定義のままです");
    }
  };

  const handleStampSelect = async (fileName: string) => {
    setShowStampPicker(false);
    setStampToSend(null);
    setIsOnlyStamp(false);
    console.log("🎯 handleStampSelect呼び出し開始:", fileName);

    if (!userId || !username) {
      console.error("❌ handleStampSelect: userId または username が未設定のため送信中止");
      return;
    }

    const token = localStorage.getItem("token");
    const clientId = `stamp-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${crypto.randomUUID()}`;

    const payload = {
      type: "stamp",
      text: "", // 必ず空に
      content: fileName,
      images: [],
      client_id: clientId,
      roomId: Number(roomId),
    };

    try {
      const res = await fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      const msgId = data?.id;

      const finalMsg = {
        ...payload,
        id: msgId,
        sender: username,
        userId: Number(userId),
        read_by: [Number(userId)],
        images: [`/Stamps/${fileName}`],
      };

      const MAX_RETRY = 20;
      const trySend = async (retry = 0): Promise<void> => {
        
        if (
          sendMessageRef.current &&
          isReadyRef.current &&
          presenceSentRef.current &&
          userId &&
          !seenClientIds.current.has(clientId)
        ) {
          seenClientIds.current.add(clientId);
          await waitForReady();
          await waitForSendMessageRefReady();

          if (!sendMessageRef.current) {
            console.error("❌ sendMessageRef.current が未設定のため送信中止");
            return;
          }

          sendMessageRef.current(finalMsg);
          console.log("✅ スタンプ送信に成功しました: ", finalMsg);

          setMessages((prev) => {
            const updated = [...prev, finalMsg];
            messagesRef.current = updated;
            return updated;
          });
          scrollToBottom();

          setShowStampPicker(false);
          setStampToSend(null);
          setIsOnlyStamp(false);
        } else if (retry < MAX_RETRY) {
          console.log("🔁 trySend() 再試行: retry =", retry + 1);
          setTimeout(() => {
            trySend(retry + 1).catch((err) => console.error("❌ trySend中にエラー:", err));
          }, 100);
        } else {
          console.warn("⚠️ スタンプ送信失敗（最大リトライ到達）", {
            sendMessageRef: sendMessageRef.current,
            isReady: isReadyRef.current,
            presenceSent: presenceSentRef.current,
          });
        }
      };

      trySend().catch((err) => console.error("❌ trySend失敗:", err));
    } catch (err) {
      console.error("❌ handleStampSelect 内部エラー:", err);
    }
  };

  const shouldSendReadRef = useRef(true);

  const sendStamp = (filename: string) => {
    const clientId = `stamp-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${crypto.randomUUID()}`;
    const payload: OutgoingMessage = {
      roomId: Number(roomId),
      type: "stamp",
      text: filename,
      content: filename,
      client_id: clientId,
    };
    console.log("🎠 Sending stamp payload:", payload);
    sendMessageRef.current?.(payload);
  };

  const handleMessage = useCallback(
    (msg: Message) => {
      if (!msg) return;

      // ✅ 既読処理
      if (msg.type === 'read') {
        const readId = msg.client_id || '';
        if (!seenReadIds.current.has(readId)) {
          seenReadIds.current.add(readId);
          console.log('👁 既読受信:', msg);

          setMessages((prev) => {
            const updated = prev.map((m) => {
              // read_by が存在しなければ空配列に初期化
              const currentReadBy = m.read_by || [];

              if (
                m.sender === usernameRef.current &&
                msg.userId &&
                !currentReadBy.includes(msg.userId)
              ) {
                return {
                  ...m,
                  read_by: [...currentReadBy, msg.userId],
                };
              }

              // 読み取り対象じゃなくても read_by が undefined なら初期化しておく（UI反映の安定化）
              if (!m.read_by) {
                return {
                  ...m,
                  read_by: [],
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

      // ✅ 消去（delete）受信時
      if (msg.type === 'delete') {
        console.log('🗑 消去を受信:', msg.client_id);
        setMessages((prev) => prev.filter((m) => m.client_id !== msg.client_id));
        return;
      }

      // ✅ 送信取消（deleted）受信時
      if (msg.type === 'deleted') {
        console.log('🚫 送信取消を受信:', msg.client_id);
        setMessages((prev) =>
          prev.map((m) =>
            m.client_id === msg.client_id
              ? {
                  ...m,
                  type: "deleted",
                  text: `${msg.sender}が送信を取り消しました`,
                  images: [],
                }
              : m
          )
        );
        return;
      }

      // ✅ スタンプメッセージ専用処理（再入室後の表示に必要）
      if (msg.type === "stamp") {
        console.log("🧸 stamp message client_id:", msg.client_id, "msg:", msg);
        const isMine = msg.sender === username;

        msg.images = [`/Stamps/${msg.content}`];

        setMessages((prev) => [...prev, msg]);

        // スタンプでも既読を送信する（自分以外のメッセージに対して）
        if (
          !isMine &&
          shouldSendReadRef.current &&
          isReadyRef.current &&
          presenceSentRef.current &&
          typeof sendMessageRef.current === 'function'
        ) {
          const readClientId = `read-${userId}-${roomId}-${uuidv4()}`;
          seenReadIds.current.add(readClientId);
          const payload = {
            type: 'read',
            roomId: Number(roomId),
            userId: Number(userId),
            client_id: readClientId,
            messageId: msg.id,
          };
          console.log('📤 スタンプ受信時のread送信:', payload);
          sendMessageRef.current(payload);
        }
      }

      // 🔽 stamp タイプのときは images に明示的にURLを追加
      if (msg.type === 'stamp' && msg.content) {
        msg.images = [`/Stamps/${msg.content}`];
      }

      // ✅ 通常メッセージ処理
      if (!msg.client_id) {
        msg.client_id = `fallback-${uuidv4()}`;
      }

      const alreadySeen = seenClientIds.current.has(msg.client_id);
      if ((!msg.text || msg.text.trim() === '') && (!msg.images || msg.images.length === 0)) return;

      const isMine = msg.sender === usernameRef.current;
      console.log(
        '🧪 sender比較: msg.sender =',
        msg.sender,
        ', username =',
        usernameRef.current,
        ', isMine =',
        isMine
      );

      const newMsg: Message = {
        ...msg,
        content: msg.type === "stamp" ? msg.text : msg.content,
        read_status: isMine ? msg.read_status ?? '未読' : undefined,
        read_by: msg.read_by ?? [],
      };

      if (!alreadySeen && msg.client_id) {
        seenClientIds.current.add(msg.client_id);

        setMessages((prev) => {
          let updated: Message[] = [];
          const existsIndex = prev.findIndex((m) => m.client_id === msg.client_id);

          if (existsIndex !== -1) {
            updated = [...prev];
            const existing = updated[existsIndex];
            updated[existsIndex] = {
              ...existing,
              text: msg.text !== undefined ? msg.text : existing.text,
              images: msg.images && msg.images.length > 0 ? msg.images : existing.images,
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

        let retryCount = 0;
        const MAX_RETRY = 20;

        const trySendInstantRead = () => {
          if (
            !isMine &&
            shouldSendReadRef.current &&
            isReadyRef.current &&
            presenceSentRef.current &&
            typeof sendMessageRef.current === 'function'
          ) {
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
            console.warn(
              `⏳ handleMessage未準備: retry = ${retryCount}, isMine=`,
              isMine,
              ', shouldSendRead=',
              shouldSendReadRef.current,
              ', isReady=',
              isReadyRef.current,
              ', presenceSent=',
              presenceSentRef.current
            );
            setTimeout(trySendInstantRead, 100);
          } else {
            console.warn('🔚 trySendInstantRead 最大リトライ到達。read送信は中断します');
          }
        };

        trySendInstantRead();
      }
    },
    [userId, roomId]
  );

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
    updateShouldSendRead();
    return () => document.removeEventListener('visibilitychange', updateShouldSendRead);
  }, [pathname, roomId]);

  const shouldConnectNotify =
    !!roomId && !!userId && !Number.isNaN(Number(roomId)) && !Number.isNaN(Number(userId));

  const { isReady: isNotifySocketReady, sendNotify, presenceSent } = useWebSocketNotify(
    shouldConnectNotify ? Number(roomId) : 0,
    shouldConnectNotify ? Number(userId) : 0,
    (notifyMsg) => {
      console.log('🧪 notifyMsg:', notifyMsg, 'userId(localStorage):', userId);
      const presenceKey = `${notifyMsg.type}-${notifyMsg.action}-${notifyMsg.userId}-${notifyMsg.roomId}`;
      if (seenPresenceIds.current.has(presenceKey)) return;
      seenPresenceIds.current.add(presenceKey);

      const notifyUserId = Number(notifyMsg.userId);
      const currentUserId = Number(userId);
      console.log(
        '📌 比較: notifyMsg.userId:',
        notifyUserId,
        'vs local userId:',
        currentUserId,
        '==>',
        notifyUserId !== currentUserId
      );

      if (
        notifyMsg.type === 'presence' &&
        notifyMsg.action === 'enter' &&
        notifyMsg.roomId === Number(roomId) &&
        notifyUserId !== currentUserId
      ) {
        let retryCount = 0;
        const trySendRead = () => {
          console.log('🟡 presence trySendRead 実行');
          console.log('🧾 messagesRef.current:', messagesRef.current);

        const unreadMessages = messagesRef.current.filter(
          (m) =>
            m.sender !== username &&
            m.id > 0 &&
            !seenReadIds.current.has(`read-${userId}-${roomId}-${m.id}`) &&
            m.type !== 'deleted' // ✅ 削除されたものには既読送信不要
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
          console.log(
            '🧩 waitForReadyチェック',
            'shouldSendRead=',
            shouldSendReadRef.current,
            'isReady=',
            isReadyRef.current,
            'presenceSent=',
            presenceSentRef.current,
            'sendMessageRef=',
            typeof sendMessageRef.current === 'function'
          );

          if (
            shouldSendReadRef.current &&
            isReadyRef.current &&
            presenceSentRef.current &&
            typeof sendMessageRef.current === 'function'
          ) {
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

  useEffect(() => {
    const handleDismiss = () => setContextMenu(null);

    document.addEventListener('click', handleDismiss);
    document.addEventListener('scroll', handleDismiss, true);

    return () => {
      document.removeEventListener('mousedown', handleDismiss);
      document.removeEventListener('scroll', handleDismiss, true);
      document.removeEventListener('contextmenu', handleDismiss);
    };
  }, []);

  const fetchMessages = () => {
    const token = localStorage.getItem('token');
    if (!roomId || !token || !userId) return;

    fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log("🟠 fetchMessages data:", data);
    if (Array.isArray(data)) {
    const filtered = data.map((msg: Message) => {
      const isStamp = msg.type === "stamp";
      const images =
        isStamp && msg.text
          ? [`/Stamps/${msg.text}`]
          : msg.images ?? [];

      return {
        ...msg,
        text: msg.type === 'deleted'
          ? `${msg.sender}が送信を取り消しました`
          : (msg.type === 'stamp' ? '' : msg.text),
        read_status: msg.sender === username ? msg.read_status : undefined,
        read_by: msg.read_by ?? [],
        type: msg.type,
        images, // ← ここで上で定義した変数を使用！
        replyTo:
          msg.replyTo && msg.replyTo.name && msg.replyTo.text
            ? {
                name: msg.replyTo.name,
                text: msg.replyTo.text,
                client_id: msg.replyTo.client_id || '',
              }
            : undefined,
      };
    });

      setMessages(() => {
        messagesRef.current = filtered;
        return filtered;
      });

      seenClientIds.current = new Set(
        filtered.map((m) => m.client_id!).filter(Boolean)
      );
      seenReadIds.current = new Set();

      let retryCount = 0;
      const trySendRead = (retry = 0) => {
        console.log('🟡 trySendRead 実行（retry =', retry, '）');
        console.log('🧾 messagesRef.current:', messagesRef.current);

      const unreadMessages = messagesRef.current.filter(
        (m) =>
          m.sender !== username &&
          m.id > 0 &&
          !seenReadIds.current.has(`read-${userId}-${roomId}-${m.id}`) &&
          m.type !== 'deleted' // ✅ 削除されたものには既読送信不要
      );

        if (unreadMessages.length > 0) {
          unreadMessages.forEach((m) => {
            const readClientId = `read-${userId}-${roomId}-${m.id}`;
            if (!seenReadIds.current.has(readClientId)) {
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
            }
          });
        }

        // 🚨 読み込み直後はまだ未読が存在しない可能性もあるため、再確認を試みる
        if (retry < 2) {
          console.warn('⏳ 全件既読条件未達のため再試行へ（retry =', retry + 1, '）');
          setTimeout(() => trySendRead(retry + 1), 300);
        } else {
          console.warn('🔚 trySendRead 最終失敗（既読対象なし or 全送信済）');
        }
      };

      let fetchRetryCount = 0;
      const waitForReady = () => {
        console.log(
          '🧩 waitForReadyチェック',
          'shouldSendRead=',
          shouldSendReadRef.current,
          'isReady=',
          isReadyRef.current,
          'presenceSent=',
          presenceSentRef.current,
          'sendMessageRef=',
          typeof sendMessageRef.current === 'function'
        );

        if (
          shouldSendReadRef.current &&
          isReadyRef.current &&
          presenceSentRef.current &&
          typeof sendMessageRef.current === 'function'
        ) {
          trySendRead();
          setTimeout(() => trySendRead(1), 300);
        } else if (fetchRetryCount < 20) {
          fetchRetryCount++;
          console.warn('⏳ fetchMessages waitForReady: retry =', fetchRetryCount);
          setTimeout(waitForReady, 100);
        } else {
          console.warn(
            '🔚 fetchMessages waitForReady: 最大リトライ到達。次回入室時に再試行されます'
          );
        }
      };

      waitForReady();
      setTimeout(scrollToBottom, 100);
    }
      })
      .catch((err) => console.error('❌ メッセージ取得失敗:', err));
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!roomId || !token || !userId) return;

    fetch(`http://localhost:8080/api/rooms/name?roomId=${roomId}&userId=${userId}`)
      .then((res) => res.json())
      .then((data) => {
        setRoomName(data.roomName);
        setMemberCount(data.memberCount);
        setIsGroup(data.isGroup === true);
      })
      .catch((err) => console.error('ルーム名取得失敗:', err));

    fetchMessages();
  }, [roomId, userId, pathname]);

  const sendUserMessage = async () => {
    const token = localStorage.getItem('token');
    if (!token || (!text.trim() && !imageFile)) return;

    if (text.trim() && imageFile) {
      alert('テキストメッセージと画像は同時に送信できません。どちらか一方を選択してください。');
      return;
    }

    const clientId = `stamp-${userId}-${Date.now()}`;
    let uploadedImageUrls: string[] = [];

    const isStamp = stampToSend !== null;
    const type = isStamp ? "stamp" : "message";

    const tempMsg: Message = {
      type,
      sender: username,
      read_status: "未読",
      read_by: [Number(userId)],
      client_id: clientId,
      userId: Number(userId),
      roomId: Number(roomId),
      images: isStamp ? [`/Stamps/${text}`] : uploadedImageUrls,
      text: isStamp ? '' : text,
      id: 0,
      ...(replyTo ? { replyTo } : {}),
    };

    setMessages((prev) => {
      const updated = [...prev, tempMsg];
      messagesRef.current = updated;
      return updated;
    });
    scrollToBottom();

    try {
      const payload: any = {
        text,
        client_id: clientId,
        ...(replyTo ? { replyTo } : {}),
      };

      if (replyTo && replyTo.client_id) {
        payload.replyTo = {
          name: replyTo.name,
          text: replyTo.text,
          client_id: replyTo.client_id,
        };
      } else if (replyTo) {
        console.warn('⚠️ replyTo は存在するが client_id が未定義です:', replyTo);
      }

      const res = await fetch(`http://localhost:8080/api/chat?roomId=${roomId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const posted = await res.json();
      const msgId = posted?.id;
      if (!msgId) throw new Error('メッセージID取得失敗');

      if (imageFile) {
        const formData = new FormData();
          formData.append('message_id', msgId);
          formData.append('image', imageFile);
          formData.append('client_id', clientId);
          if (replyTo?.client_id !== undefined && replyTo.client_id !== '') {
            console.log("✅ replyTo.client_id:", replyTo.client_id);
            formData.append('reply_client_id', replyTo.client_id);
          } else {
            console.warn("⚠️ replyTo.client_id が未定義または空です:", replyTo);
          }
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
          ...(replyTo ? { replyTo } : {}),
        };
        const finalMsg = { ...updatedMsg };

        if (!seenClientIds.current.has(finalMsg.client_id!)) {
          seenClientIds.current.add(finalMsg.client_id!);
          sendMessage(finalMsg);
        }

        setMessages((prev) => {
          const updated = prev.map((m) => (m.client_id === clientId ? finalMsg : m));
          messagesRef.current = updated;
          return updated;
        });

        setImageFile(null);
        setReplyTo(null);
      } else {
        const finalTextMsg = { ...tempMsg, id: msgId };

        if (!seenClientIds.current.has(finalTextMsg.client_id!)) {
          seenClientIds.current.add(finalTextMsg.client_id!);
          sendMessage(finalTextMsg);
        }

        setText('');
        setReplyTo(null);
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
      overflowX: 'hidden',
      backgroundColor: '#f9f9f9',
      marginBottom: '16px'
    }}>
    {messages.map((msg, index) => {
      const isMe = msg.sender === username;
      const key = msg.client_id || `msg-${msg.id}-${msg.sender}-${index}`;
      const isOnlyStamp =
        msg.images?.length === 1 &&
        msg.images[0].includes('/Stamps/') &&
        (!msg.text || msg.text.trim() === '');

    const isValidMessage =
      msg &&
      (
        msg.type === 'stamp' || // ← スタンプも有効と見なす
        msg.text?.trim() ||
        (msg.images && msg.images.length > 0)
      );

    if (msg.type === 'deleted') {
      return (
        <div
          key={`${key}-${index}`}
          style={{
            textAlign: 'center',
            fontSize: '0.85rem',
            color: '#888',
            margin: '10px 0',
          }}
        >
          {msg.text || `${msg.sender}が送信を取り消しました`}
        </div>
      );
    }

    if (msg.type === 'stamp' && Array.isArray(msg.images) && msg.images.length > 0) {
      console.log('🧸 stamp message client_id:', msg.client_id, 'msg:', msg);
      return (
        <div
          key={`${key}-${index}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMe ? 'flex-end' : 'flex-start',
            padding: '8px 0',
            position: 'relative',
          }}
        >
          <div style={{ fontSize: '12px', marginBottom: '4px' }}>{msg.sender}</div>
          <img
            ref={(el) => {
              if (msg.client_id) {
                bubbleRefs.current[msg.client_id] = el;
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                msg,
              });
            }}
            src={msg.images[0]}
            alt={`stamp-${index}`}
            style={{
              maxWidth: '150px',
              maxHeight: '150px',
              objectFit: 'contain',
              border: 'none',
              cursor: 'pointer',
            }}
          />
          {isMe && (
            <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
              {isGroup
                ? `既読 ${(msg.read_by?.filter((id) => id !== Number(userId)).length) ?? 0}`
                : msg.read_by && msg.read_by.length > 1
                  ? '既読'
                  : '未読'}
            </div>
          )}
        </div>
      );
    }

    if (!isValidMessage) return null;

    const isContextTarget = contextMenu?.msg?.client_id === msg.client_id;

      return (
        <div
          key={`${key}-${index}`}
          ref={(el) => {
            if (msg.client_id) {
              bubbleRefs.current[msg.client_id] = el;
            }
          }}
          onContextMenu={(e) => handleContextMenu(e, msg)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: isMe ? 'flex-end' : 'flex-start',
            marginBottom: '16px',
            position: 'relative',
          }}
        >
          <div style={{ fontSize: '12px', marginBottom: '4px' }}>{msg.sender}</div>
          {(msg.replyTo || msg.text) && (
            <div
              onClick={() => {
                const target = bubbleRefs.current[msg.replyTo?.client_id || ''];
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  target.classList.add('highlight');
                  setTimeout(() => target.classList.remove('highlight'), 1000);
                }
              }}
              style={{
                backgroundColor: isMe ? '#dbeafe' : '#e5e7eb',
                borderRadius: '8px',
                padding: '8px',
                cursor: msg.replyTo ? 'pointer' : 'default',
              }}
            >
              {msg.replyTo && (
                <div style={{ marginBottom: '4px' }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#666',
                      borderLeft: '3px solid #ccc',
                      paddingLeft: '6px',
                    }}
                  >
                    {msg.replyTo.text}
                  </div>
                  <hr
                    style={{
                      margin: '4px 0',
                      border: 'none',
                      borderTop: '1px solid #ccc',
                    }}
                  />
                  {isGroup && (
                    <span
                      style={{
                        color: '#2563eb',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}
                    >
                      @{msg.replyTo.name}
                    </span>
                  )}
                </div>
              )}
              {msg.text && (
                <div style={{ fontSize: '14px', wordWrap: 'break-word' }}>{msg.text}</div>
              )}
            </div>
          )}
          {Array.isArray(msg.images) && msg.images.length > 0 && (
            isOnlyStamp ? (
              <img
                src={msg.images[0]}
                alt={`stamp-${index}`}
                style={{
                  maxWidth: '80px',
                  maxHeight: '80px',
                  objectFit: 'contain',
                  border: 'none',
                }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      msg,
                    });
                  }}
              />
            ) : (
              msg.images.map((url, idx) => (
                <img
                  key={`${msg.id}-img-${idx}`}
                  src={url}
                  alt="添付画像"
                  style={{
                    maxWidth: '240px',
                    marginTop: '6px',
                    borderRadius: '8px',
                    border: '1px solid #ccc', // ← 通常画像のみ適用されるように
                    cursor: 'pointer',
                  }}
                  onClick={() => setModalImageUrl(url)}
                />
              ))
            )
          )}
          {isMe && (
            <div style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>
              {isGroup
                ? `既読 ${(msg.read_by?.filter((id) => id !== Number(userId)).length) ?? 0}`
                : msg.read_by && msg.read_by.length > 1
                  ? '既読'
                  : '未読'}
            </div>
          )}

    {contextMenu && contextMenu.msg?.client_id === msg.client_id && (
      <div
        onClick={handleCloseContextMenu}
        style={{
          position: 'fixed',
          top: `${contextMenu.y}px`,
          left: `${contextMenu.x}px`,
          backgroundColor: '#fff',
          border: '1px solid #ccc',
          borderRadius: '6px',
          zIndex: 1000,
          padding: '4px 0',
          minWidth: '120px',
        }}
      >
        {getMenuItemsWithHandlers(contextMenu.msg).map((item, i) => (
          <div
            key={i}
            onClick={(e) => {
              e.stopPropagation(); // ✨追加！
              item.onClick();
            }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: '14px',
              borderBottom:
                i !== getMenuItemsWithHandlers(contextMenu.msg).length - 1
                  ? '1px solid #eee'
                  : 'none',
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    )}
        </div>
      );
    })}
      <div ref={bottomRef} style={{ height: '1px' }} />
      {modalImageUrl && (
        <div
          onClick={() => setModalImageUrl(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000,
          }}
        >
          <img
            src={modalImageUrl}
            alt="拡大画像"
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: '10px',
              border: '4px solid white',
            }}
          />
        </div>
      )}
    </div>

    {replyTo && (
      <div style={{
        backgroundColor: '#f0f0f0',
        padding: '4px 8px',
        borderLeft: '3px solid #ccc',
        borderRadius: '4px',
        marginBottom: '6px',
        fontSize: '13px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: '#333' }}>{replyTo.text}</div>
        <div
          onClick={() => setReplyTo(null)}
          style={{ cursor: 'pointer', marginLeft: '8px', fontWeight: 'bold', color: '#999' }}
        >
          ×
        </div>
      </div>
    )}
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ position: 'relative' }}>
        {replyTo && (
          <div
            style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              pointerEvents: 'none',
              color: '#2563eb',
              fontSize: '14px',
              zIndex: 1,
            }}
          >
            @{replyTo.name}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{
            padding: '8px',
            paddingTop: replyTo ? '30px' : '8px',
            fontSize: '14px',
            lineHeight: '1.4',
            width: '100%',
            resize: 'none',
            border: '1px solid #ccc',
            borderRadius: '4px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        />
                <button
          onClick={toggleStampPicker}
          style={{
            position: 'absolute',
            right: '0px',
            top: '85px',
            fontSize: '30px',
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer'
          }}
          title="スタンプを送信"
        >
          ☺
        </button>
      </div>
        {showStampPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '80px',
              right: '20px',
              background: '#fff',
              border: '1px solid #ccc',
              padding: '10px',
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 48px)',
              gap: '6px',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              zIndex: 1000,
              maxHeight: '240px', // 💡これで縦2行分以上の領域に制限
              overflowY: 'auto',
              borderRadius: '10px'
            }}
          >
            {[
              's0086_3_0.png', 's0086_4_0.png', 's0099_4_0.png', 's0099_10_0.png',
              's0099_13_0.png', 's0099_19_0.png', 's0099_22_0.png', 's0099_25_0.png',
              's0099_26_0.png', 's0106_8_0.png', 's0115_23_0.png', 's0115_30_0.png',
            ].map((file, i) => (
              <img
                key={i}
                src={`/Stamps/${file}`}
                alt={`stamp-${i}`}
                onClick={() => handleStampSelect(file)}
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '8px',
                  objectFit: 'contain', // ← cover を contain に！
                  background: '#fff',
                  padding: '2px',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        )}
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