'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: '40px', // ✅ 上辺をログインと揃える
        backgroundColor: 'white',
      }}
    >
      <div
        style={{
          maxWidth: '500px',
          width: '100%',
          padding: '24px',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
          textAlign: 'center',
          backgroundColor: 'white',
        }}
      >
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 'bold',
            marginBottom: '24px',
          }}
        >
          ようこそ Chat App へ
        </h1>
        <p
          style={{
            marginBottom: '24px',
            fontSize: '16px',
            whiteSpace: 'normal',
          }}
        >
          以下のリンクからサインアップまたはログインしてください。
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <Link href="/signup">
            <button
              style={{
                backgroundColor: '#2563eb',
                color: 'white',
                padding: '10px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                marginRight: '8px',
              }}
            >
              サインアップ
            </button>
          </Link>
          <Link href="/login">
            <button
              style={{
                backgroundColor: '#2563eb',
                color: 'white',
                padding: '10px 16px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ログイン
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
