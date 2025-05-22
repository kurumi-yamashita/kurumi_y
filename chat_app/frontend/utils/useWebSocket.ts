// utils/useWebSocket.ts
import { useEffect, useRef, useState } from 'react';

const connectionMap: Map<string, WebSocket> = new Map();

export function useWebSocket(roomId: number, onMessage: (msg: any) => void) {
  const [isReady, setIsReady] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const currentRoomKey = `room-${roomId}`;
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) tokenRef.current = storedToken;
  }, []);

  useEffect(() => {
    if (!tokenRef.current || !roomId) return;

    const existing = connectionMap.get(currentRoomKey);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      wsRef.current = existing;
      if (existing.readyState === WebSocket.OPEN) setIsReady(true);
      return;
    }

    if (existing) {
      console.log('🔁 既存接続をクローズして再接続');
      existing.close();
      connectionMap.delete(currentRoomKey);
    }

    const ws = new WebSocket(`ws://localhost:8080/ws?roomId=${roomId}`, [tokenRef.current]);
    wsRef.current = ws;
    connectionMap.set(currentRoomKey, ws);

    ws.onopen = () => {
      console.log("✅ WebSocket接続成功");
      setIsReady(true);
      ws.send(JSON.stringify({ type: 'ping' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📨 WebSocket受信:', data);
        onMessage(data);
      } catch (err) {
        console.error('❌ メッセージ解析エラー:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('❌ WebSocketエラー詳細:', err);
    };

    ws.onclose = (e) => {
      console.warn('⚠️ WebSocket切断:', e.code, e.reason);
      setIsReady(false);
      connectionMap.delete(currentRoomKey);
    };

    return () => {
      console.log("↩️ ページアンマウント：WebSocketは維持（切断せず）");
    };
  }, [roomId]);

  const sendMessage = (data: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    } else {
      console.warn('⚠️ WebSocketが未接続状態です。送信失敗:', data);
    }
  };

  const disconnect = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('🛑 明示的にWebSocket切断');
      ws.close();
      connectionMap.delete(currentRoomKey);
      setIsReady(false);
    }
  };

  return { sendMessage, isReady, disconnect };
}
