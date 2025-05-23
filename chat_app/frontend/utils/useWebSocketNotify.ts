// utils/useWebSocketNotify.ts

import { useEffect, useRef, useState } from 'react';

type NotifyMessage = {
  type: 'presence' | 'ping';
  action?: 'enter' | 'leave';
  userId?: number;
  roomId?: number;
};

export function useWebSocketNotify(
  roomId: number,
  userId: number,
  onMessage: (msg: NotifyMessage) => void
) {
  const [isReady, setIsReady] = useState(false);
  const [presenceSent, setPresenceSent] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const manualCloseRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const shouldConnect =
    roomId > 0 &&
    userId > 0 &&
    !Number.isNaN(roomId) &&
    !Number.isNaN(userId);

  const connect = () => {
    const token = localStorage.getItem('token');
    if (!token || !shouldConnect) return;

    const ws = new WebSocket(`ws://localhost:8080/ws/notify`, token);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('🟢 Notify WebSocket接続成功');
      setIsReady(true);
      const presencePayload = {
        type: 'presence',
        action: 'enter',
        userId,
        roomId,
      };
      ws.send(JSON.stringify(presencePayload));
      console.log('📤 presence送信:', presencePayload);
      setPresenceSent(true);
    };

    ws.onmessage = (event) => {
      console.log('🔵 notify WebSocketメッセージ受信:', event.data);
      try {
        const msg = JSON.parse(event.data);
        console.log('🟢 notify parsed msg:', msg);
        if ((msg?.type === 'presence' || msg?.type === 'ping') && presenceSent) {
          onMessage(msg); // ✅ presenceSent が true のときだけ発火
        }
      } catch (err) {
        console.error('❌ 通知メッセージ解析失敗:', err);
      }
    };

    ws.onclose = (event) => {
      console.warn('🔌 Notify WebSocket切断:', event.code, event.reason);
      setIsReady(false);
      setPresenceSent(false);
      socketRef.current = null;

      if (manualCloseRef.current) return;

      // 再接続を一定時間遅らせて無限ループを回避
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('♻️ Notify WebSocket再接続...');
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('❌ Notify WebSocketエラー:', err);
      ws.close();
    };
  };

  const disconnect = () => {
    manualCloseRef.current = true;
    if (socketRef.current) {
      const leavePayload = {
        type: 'presence',
        action: 'leave',
        userId,
        roomId,
      };
      try {
        socketRef.current.send(JSON.stringify(leavePayload));
        console.log('📤 presence離脱送信:', leavePayload);
      } catch (e) {
        console.warn('⚠️ 離脱送信失敗:', e);
      }
      socketRef.current.close();
    }
    setIsReady(false);
    setPresenceSent(false);
    socketRef.current = null;
  };

  const sendNotify = (msg: NotifyMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));

      // presence enter のときに presenceSent を true にする
      if (msg.type === 'presence' && msg.action === 'enter') {
        console.log('✅ presence enter 送信完了 ⇒ presenceSent = true');
        setPresenceSent(true);
      }
    }
  };

  useEffect(() => {
    if (shouldConnect) {
      manualCloseRef.current = false;
      connect();
    }

    return () => {
      disconnect();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [roomId, userId]);

  return { isReady, sendNotify, disconnect, presenceSent };
}
