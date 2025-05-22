'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiLogOut, FiChevronDown, FiChevronUp } from 'react-icons/fi';

const handleLogout = (router: any) => {
  const confirmed = window.confirm('本当にログアウトしますか？');
  if (!confirmed) return;
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  localStorage.removeItem('userId');
  router.push('/');
};

type Room = {
  id: number;
  name: string;
  member_count: number;
  is_group: number;
  unread_count?: number;
};

type User = {
  id: number;
  username: string;
};

export default function RoomSelection() {
  const [groupRooms, setGroupRooms] = useState<Room[]>([]);
  const [joinableRooms, setJoinableRooms] = useState<Room[]>([]);
  const [oneToOneRooms, setOneToOneRooms] = useState<Room[]>([]);
  const [otherUsers, setOtherUsers] = useState<User[]>([]);
  const [newRoomName, setNewRoomName] = useState('');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [showUserRooms, setShowUserRooms] = useState(false);
  const [showJoinableRooms, setShowJoinableRooms] = useState(false);
  const [showOneToOne, setShowOneToOne] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    const uid = localStorage.getItem('userId');
    const uname = localStorage.getItem('username');
    if (!token || !uid || !uname) {
      router.push('/');
    } else {
      setUserId(uid);
      setUsername(uname);
    }
  }, [router]);

  useEffect(() => {
    const handleUnload = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      localStorage.removeItem('userId');
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  const fetchRooms = async (uid: string) => {
    try {
      const [userRes, joinRes] = await Promise.all([
        fetch(`http://localhost:8080/api/rooms/owned?userId=${uid}`),
        fetch(`http://localhost:8080/api/rooms/available?userId=${uid}`)
      ]);
      if (!userRes.ok || !joinRes.ok) throw new Error('API error');
      const userData: Room[] = await userRes.json();
      const joinData: Room[] = await joinRes.json();
      setGroupRooms(userData.filter(r => r.is_group === 1));
      setOneToOneRooms(userData.filter(r => r.is_group === 0));
      setJoinableRooms(joinData);
    } catch (err) {
      console.error('❌ fetchRooms失敗:', err);
      setGroupRooms([]);
      setJoinableRooms([]);
      setOneToOneRooms([]);
      setError('ルーム情報の取得に失敗しました');
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`http://localhost:8080/api/users`);
      if (!res.ok) throw new Error('ユーザー取得失敗');
      const users: User[] = await res.json();
      setOtherUsers(users.filter(user => user.username !== username));
    } catch (err) {
      console.error('❌ fetchUsers失敗:', err);
      setOtherUsers([]);
      setError('ユーザー情報の取得に失敗しました');
    }
  };

  useEffect(() => {
    if (userId) {
      fetchRooms(userId);
      fetchUsers();
    }
  }, [userId]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && userId) {
        fetchRooms(userId);
        fetchUsers();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [userId]);

  const createRoom = async () => {
    if (!newRoomName.trim() || !userId) return;
    setError('');
    try {
      const res = await fetch('http://localhost:8080/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId), roomName: newRoomName }),
      });
      const result = await res.json();
      if (res.ok) {
        await fetchRooms(userId);
        router.push(`/chat/${result.roomId}`);
      } else {
        setError(result.message || 'ルーム作成に失敗しました');
      }
    } catch {
      setError('ネットワークエラーが発生しました');
    }
  };

  const joinRoom = async (roomId: number) => {
    if (!userId) return;
    try {
      const res = await fetch('http://localhost:8080/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: Number(userId), roomId }),
      });
      if (res.ok) {
        await fetchRooms(userId);
        setTimeout(() => router.push(`/chat/${roomId}`), 200);
      } else {
        const err = await res.json();
        setError(err.message || '参加に失敗しました');
      }
    } catch {
      setError('ネットワークエラーが発生しました');
    }
  };

  const goToOneToOneRoom = async (targetUser: User) => {
    if (!userId) return;
    try {
      const res = await fetch('http://localhost:8080/api/rooms/one-to-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1Id: Number(userId), user2Id: targetUser.id }),
      });
      const result = await res.json();
      if (res.ok) {
        router.push(`/chat/${result.roomId}`);
      } else {
        setError(result.message || 'ルーム遷移に失敗しました');
      }
    } catch {
      setError('ネットワークエラーが発生しました');
    }
  };

  // ➕ 未読件数の合計を計算
  const oneToOneUnreadTotal = oneToOneRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
  const groupUnreadTotal = groupRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);

  return (
    <div style={{
      maxWidth: '500px', margin: '40px auto', padding: '24px',
      border: '1px solid #ddd', borderRadius: '8px',
      boxShadow: '0 4px 8px rgba(0,0,0,0.1)', backgroundColor: 'white',
      position: 'relative'
    }}>
      <FiLogOut
        onClick={() => handleLogout(router)}
        size={20}
        title="ログアウト"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          cursor: 'pointer',
          color: '#666',
        }}
      />

      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px' }}>ルーム選択</h1>

      {/* 1対1トーク */}
      <div style={{ marginBottom: '20px' }}>
        <div
          onClick={() => setShowOneToOne(!showOneToOne)}
          style={{ fontWeight: '600', cursor: 'pointer', marginBottom: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span>1対1でトーク</span>
          {oneToOneUnreadTotal > 0 && (
            <span
            style={{
              color: 'crimson',
              fontWeight: 'bold',
              fontSize: '14px',
                marginLeft: '4px',
                  position: 'relative',
                  top: '1px'
                }}>
              未読 {oneToOneUnreadTotal}
            </span>
          )}
          {showOneToOne ? <FiChevronUp size={18} color="#2563eb" /> : <FiChevronDown size={18} color="#2563eb" />}
        </div>

        {showOneToOne && (
          <div style={{ paddingLeft: '16px' }}>
            {otherUsers.map(user => {
              const matchedRoom = oneToOneRooms.find(r => r.name === user.username);
              const unread = matchedRoom?.unread_count ?? 0;

              return (
                <div key={user.id} style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => goToOneToOneRoom(user)}
                    style={{ color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {user.username}
                  </button>
                  {unread > 0 && (
                    <span
                      style={{
                      color: 'crimson',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      marginLeft: '4px',
                      position: 'relative',
                      top: '2px'
                    }}
                    >
                      未読 {unread}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 所属ルーム */}
      <div style={{ marginBottom: '20px' }}>
        <div
          onClick={() => setShowUserRooms(!showUserRooms)}
          style={{
            fontWeight: '600',
            cursor: 'pointer',
            marginBottom: '8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>加入済みのルーム</span>
          {groupUnreadTotal > 0 && (
            <span
              style={{
                color: 'crimson',
                fontWeight: 'bold',
                fontSize: '14px',
                marginLeft: '4px',
                position: 'relative',
                top: '1.5px'
              }}
            >
              未読 {groupUnreadTotal}
            </span>
          )}
          {showUserRooms
            ? <FiChevronUp size={18} color="#2563eb" />
            : <FiChevronDown size={18} color="#2563eb" />}
        </div>

        {showUserRooms && (
          <div style={{ paddingLeft: '16px' }}>
            {groupRooms.length > 0 ? groupRooms.map(room => (
              <div
                key={room.id}
                style={{
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <button
                  onClick={() => router.push(`/chat/${room.id}`)}
                  style={{
                    color: '#2563eb',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  {room.name} ({room.member_count})
                </button>

                {(room.unread_count ?? 0) > 0 && (
                  <span
                    style={{
                      color: 'crimson',
                      fontWeight: 'bold',
                      fontSize: '12px',
                      marginLeft: '4px',
                      position: 'relative',
                      top: '2px'
                    }}
                  >
                    未読 {room.unread_count}
                  </span>
                )}
              </div>
            )) : (
              <div style={{ color: '#888', fontStyle: 'italic' }}>
                ルームが存在しません
              </div>
            )}
          </div>
        )}
      </div>

      {/* 参加可能ルーム */}
      <div style={{ marginBottom: '20px' }}>
        <div onClick={() => setShowJoinableRooms(!showJoinableRooms)} style={{ fontWeight: '600', cursor: 'pointer', marginBottom: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span>既存ルームに加入</span>
          {showJoinableRooms ? <FiChevronUp size={18} color="#2563eb" /> : <FiChevronDown size={18} color="#2563eb" />}
        </div>
        {showJoinableRooms && (
          <div style={{ paddingLeft: '16px' }}>
            {(joinableRooms || []).length > 0 ? (joinableRooms || []).map(room => (
              <div key={room.id} style={{ marginBottom: '4px' }}>
                <button onClick={() => joinRoom(room.id)} style={{ color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  {room.name} ({room.member_count})
                </button>
              </div>
            )) : (
              <div style={{ color: '#888', fontStyle: 'italic' }}>ルームが存在しません</div>
            )}
          </div>
        )}
      </div>

      {/* 新規ルーム作成 */}
      <div>
        <div style={{ fontWeight: '600', marginBottom: '8px' }}>新規ルーム作成</div>
        <input
          type="text"
          placeholder="ルーム名"
          value={newRoomName}
          onChange={e => setNewRoomName(e.target.value)}
          style={{ border: '1px solid #ccc', padding: '6px', marginRight: '8px', borderRadius: '4px', width: '60%' }}
        />
        <button
          onClick={createRoom}
          disabled={!newRoomName.trim()}
          style={{
            backgroundColor: '#2563eb', color: 'white',
            padding: '6px 12px', border: 'none', borderRadius: '4px',
            cursor: newRoomName.trim() ? 'pointer' : 'not-allowed',
            opacity: newRoomName.trim() ? 1 : 0.6
          }}
        >
          作成
        </button>
        {error && <p style={{ color: 'red', marginTop: '8px' }}>{error}</p>}
      </div>
    </div>
  );
}
