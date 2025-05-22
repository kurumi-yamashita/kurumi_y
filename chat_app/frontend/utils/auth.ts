// utils/auth.ts

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const signup = async (email: string, password: string) => {
  try {
    const res = await fetch(`${API_BASE}/api/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      throw new Error(`エラー: ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    console.error("サインアップ失敗:", err);
    throw err;
  }
};
