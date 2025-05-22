// utils/useWebSocketNotify.ts
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';

type NotifyMessage = {
  type: string;
  action?: 'enter' | 'leave';
  roomId?: number;
  userId?: number;
};

const NOTIFY_KEY = 'global-notify';
const notifyMap: Map<string, WebSocket> = new Map();

export function useWebSocketNotify(
  onMessage?: (msg: any) => void
): { isReady: boolean; sendNotify: (msg: NotifyMessage) => void } {
  const [isReady, setIsReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pathnameRef = useRef<string>('');
  const lastActionRef = useRef<string | null>(null);
  const currentPathname = usePathname();
  const retryCountRef = useRef(0);
  const maxRetry = 5;

  const sendNotify = useCallback((msg: NotifyMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ Notify WebSocket未接続: メッセージ送信失敗', msg);
      return;
    }

    if (
      msg.type === 'presence' &&
      (msg.action === 'enter' || msg.action === 'leave') &&
      !pathnameRef.current.startsWith('/chat')
    ) {
      console.log('🚫 チャット画面外のため presence 通知スキップ:', msg);
      return;
    }

    if (msg.type === 'presence' && msg.action === lastActionRef.current) {
      console.log('⛔️ 重複presence通知をスキップ:', msg);
      return;
    }

    if (
      msg.type === 'presence' &&
      (msg.roomId == null || msg.userId == null)
    ) {
      console.warn('🚫 トークンまたは userId/roomId 不足：', msg);
      return;
    }

    lastActionRef.current = msg.action || null;
    console.log('📤 Notify送信:', msg);
    ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const uid = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
    const userId = Number(uid);

    if (!token || !uid || isNaN(userId)) {
      console.warn('⛔ 無効な token または userId により Notify 接続を中止');
      return;
    }

    const ws = new WebSocket('ws://localhost:8080/ws/notify', [token]);
    wsRef.current = ws;
    notifyMap.set(NOTIFY_KEY, ws);

    ws.onopen = () => {
      console.log('📡 Notify WebSocket接続成功');
      setIsReady(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (e) => {
      try {
        const text = typeof e.data === 'string' ? e.data.trim() : '';
        if (!text || text === 'ping') return;
        const data = JSON.parse(text);
        console.log('🔔 通知受信:', data);
        onMessage?.(data);
      } catch (err) {
        console.error('❌ 通知パースエラー:', err, '受信内容:', e.data);
      }
    };

    ws.onerror = (e) => {
      console.error('❌ Notify WebSocket エラー:', e);
    };

    ws.onclose = (e) => {
      console.warn('🔌 Notify WebSocket切断:', e.code, e.reason);
      setIsReady(false);
      notifyMap.delete(NOTIFY_KEY);

      if (retryCountRef.current < maxRetry) {
        const delay = 1000 * Math.pow(2, retryCountRef.current);
        console.log(`🔁 再接続リトライ ${retryCountRef.current + 1}回目：${delay}ms後`);
        retryCountRef.current += 1;
        setTimeout(connect, delay);
      } else {
        console.error('🛑 再接続試行上限に達しました');
      }
    };
  }, [onMessage]);

  useEffect(() => {
    pathnameRef.current = currentPathname;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const uid = localStorage.getItem('userId');
      const userId = Number(uid);
      const roomId = parseInt(currentPathname.split('/chat/')[1]) || undefined;
      const action = currentPathname.startsWith('/chat') ? 'enter' : 'leave';
      sendNotify({ type: 'presence', action, userId, roomId });
    }
  }, [currentPathname, sendNotify]);

  useEffect(() => {
    if (notifyMap.get(NOTIFY_KEY)?.readyState === WebSocket.OPEN) {
      wsRef.current = notifyMap.get(NOTIFY_KEY)!;
      setIsReady(true);
      return;
    }

    connect();

    const handleUnload = () => {
      try {
        const uid = localStorage.getItem('userId');
        const userId = Number(uid);
        const roomId = parseInt(pathnameRef.current.split('/chat/')[1]) || undefined;
        sendNotify({ type: 'presence', action: 'leave', userId, roomId });
      } catch (_) {}
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [connect, sendNotify]);

  return { isReady, sendNotify };
}