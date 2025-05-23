'use client'; // クライアントコンポーネントとして動作（フォーム操作などに必要）

import { useForm } from 'react-hook-form';        // フォームバリデーション用ライブラリ
import { useRouter } from 'next/navigation';      // ページ遷移用のフック
import { useState } from 'react';                 // Reactの状態管理用フック
import { FiChevronLeft } from 'react-icons/fi';  // ← 戻るボタン用アイコンを追加

// フォームで扱う入力データの型定義
type FormData = {
  email: string;
  password: string;
};

export default function LoginPage() {
  // useFormの初期化：バリデーション設定やエラー取得などができる
  const {
    register,                    // inputにバリデーションルールを登録
    handleSubmit,                // submitをバリデーション付きで処理
    formState: { errors },       // エラー情報
  } = useForm<FormData>();

  const [errorMessage, setErrorMessage] = useState(''); // サーバーやネットワークエラー表示用
  const router = useRouter(); // ページ遷移オブジェクト（useRouter）

  // フォーム送信時の処理関数
  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch('http://localhost:8080/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), // 入力データをJSONとして送信
      });

      if (res.ok) {
        // ログイン成功時はトークンとユーザー情報をlocalStorageに保存
        const result = await res.json();
        localStorage.setItem('token', result.token);
        localStorage.setItem('username', result.username);
        localStorage.setItem('userId', result.userId);

        // ルーム選択画面へ遷移
        router.push('/rooms');
      } else {
        // サーバー側のエラー応答を表示
        const errorData = await res.json();
        setErrorMessage(errorData.message || 'ログインに失敗しました');
      }
    } catch (error) {
      // 通信エラー時の表示
      console.error('ログインリクエスト失敗:', error);
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
      boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
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
      }}>ログイン</h1>
    </div>
      {/* ログインフォーム */}
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* メールアドレス入力 */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px' }}>メールアドレス</label>
          <input
            type="email"
            {...register('email', { required: 'メールは必須です' })}
            style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          {/* メール入力エラー表示 */}
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
          {/* パスワード入力エラー表示 */}
          {errors.password && (
            <p style={{ color: 'red', fontSize: '14px', marginTop: '4px' }}>{errors.password.message}</p>
          )}
        </div>

        {/* サーバー or 通信エラーの表示 */}
        {errorMessage && (
          <p style={{ color: 'red', fontWeight: 'bold', fontSize: '14px', marginBottom: '16px' }}>
            {errorMessage}
          </p>
        )}

        {/* ログインボタン */}
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
          ログイン
        </button>
      </form>
    </div>
  );
}
