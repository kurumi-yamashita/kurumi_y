'use client'; // クライアントコンポーネント指定（フォームや状態管理があるので必要）

import { useForm } from 'react-hook-form';           // 入力バリデーション用ライブラリ
import { useRouter } from 'next/navigation';         // ページ遷移用フック
import { useState } from 'react';                    // Reactの状態管理フック
import { FiChevronLeft } from 'react-icons/fi';  // ← 戻るボタン用アイコンを追加

// 入力フォームで扱うデータの型
type FormData = {
  name: string;
  email: string;
  password: string;
};

export default function SignupPage() {
  // useForm でフォーム制御を初期化
  const {
    register,           // 各input要素にバリデーションルールを関連付ける
    handleSubmit,       // submitイベントをラップしてバリデーションと接続
    formState: { errors }, // エラーメッセージ情報
  } = useForm<FormData>();

  const [errorMessage, setErrorMessage] = useState(''); // サーバーや通信エラー用の表示状態
  const router = useRouter(); // ページ遷移用のオブジェクト

  // フォーム送信時の処理
  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch('http://localhost:8080/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        // 登録成功時はログインページへ遷移
        router.push('/login');
      } else {
        // サーバーからのエラー表示
        const errorData = await res.json();
        setErrorMessage(errorData.message || '登録に失敗しました');
      }
    } catch (error) {
      console.error('サインアップエラー:', error);
      setErrorMessage('ネットワークエラーが発生しました');
    }
  };

  return (
    <div style={{
      maxWidth: '400px',
      margin: '40px auto',
      padding: '24px',
      border: '1px solid #ccc',
      borderRadius: '8px',
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)'
    }}>
      {/* 見出し */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
        <FiChevronLeft size={20} onClick={() => router.push('/')}
          style={{ cursor: 'pointer', marginRight: '8px', marginTop: '-24px', color: '#2563eb' }}
          title="トップページに戻る" />
      <h1 style={{
        fontSize: '24px',
        fontWeight: 'bold',
        marginBottom: '24px'
      }}>サインアップ</h1>
    </div>
      {/* 入力フォーム開始 */}
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* ユーザー名入力 */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>ユーザー名</label>
          <input
            type="text"
            {...register('name', { required: '名前は必須です' })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          {errors.name && (
            <p style={{ color: 'red', fontSize: '14px', marginTop: '4px' }}>{errors.name.message}</p>
          )}
        </div>

        {/* メールアドレス入力 */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>メールアドレス</label>
          <input
            type="email"
            {...register('email', { required: 'メールは必須です' })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          {errors.email && (
            <p style={{ color: 'red', fontSize: '14px', marginTop: '4px' }}>{errors.email.message}</p>
          )}
        </div>

        {/* パスワード入力 */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>パスワード</label>
          <input
            type="password"
            {...register('password', { required: 'パスワードは必須です' })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          {errors.password && (
            <p style={{ color: 'red', fontSize: '14px', marginTop: '4px' }}>{errors.password.message}</p>
          )}
        </div>

        {/* サーバーエラーメッセージ */}
        {errorMessage && (
          <p style={{ color: 'red', fontWeight: 'bold', fontSize: '14px', marginBottom: '16px' }}>
            {errorMessage}
          </p>
        )}

        {/* 登録ボタン */}
        <button
          type="submit"
          style={{
            width: '100%',
            backgroundColor: '#2563eb',
            color: 'white',
            padding: '10px',
            borderRadius: '4px',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          登録
        </button>
      </form>
    </div>
  );
}
