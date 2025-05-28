package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func UploadHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("📥 UploadHandler 開始")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	r.ParseMultipartForm(10 << 20) // 10MB
	log.Println("📦 全フォームデータ:", r.Form)

	if r.MultipartForm != nil {
		log.Println("🧪 raw reply_client_id:", r.MultipartForm.Value["reply_client_id"])
	}

	if r.Method == http.MethodOptions {
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "ファイルが大きすぎます", http.StatusBadRequest)
		return
	}

	roomIDStr := r.URL.Query().Get("roomId")
	if roomIDStr == "" {
		http.Error(w, "roomIdが必要です", http.StatusBadRequest)
		return
	}

	messageIDStr := r.FormValue("message_id")
	log.Println("📦 messageIDStr:", messageIDStr)
	messageID, err := strconv.Atoi(messageIDStr)
	if err != nil {
		http.Error(w, "message_idは整数である必要があります", http.StatusBadRequest)
		return
	}

	file, handler, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "ファイル取得エラー", http.StatusBadRequest)
		return
	}
	defer file.Close()

	uploadDir := "./uploads"
	if _, err := os.Stat(uploadDir); os.IsNotExist(err) {
		os.MkdirAll(uploadDir, os.ModePerm)
	}

	savePath := filepath.Join(uploadDir, handler.Filename)
	dst, err := os.Create(savePath)
	if err != nil {
		http.Error(w, "ファイル保存エラー", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "ファイル書き込みエラー", http.StatusInternalServerError)
		return
	}

	_, err = DB.Exec(`
		INSERT INTO message_attachments (message_id, file_name, created_at)
		VALUES ($1, $2, $3)
	`, messageID, handler.Filename, time.Now())
	log.Println("✅ 画像保存完了:", handler.Filename)
	if err != nil {
		log.Println("❌ 画像DB保存失敗:", err)
		http.Error(w, "画像の保存に失敗しました", http.StatusInternalServerError)
		return
	}

	// ✅ reply_to_message_id 補完処理
	replyClientID := r.FormValue("reply_client_id")
	if replyClientID != "" {
		log.Println("📝 replyClientID 受信:", replyClientID, " / messageID:", messageID)

		var replyToID int
		err := DB.QueryRow(`SELECT id FROM messages WHERE client_id = $1`, replyClientID).Scan(&replyToID)
		if err != nil {
			log.Println("❌ reply_to_message_id の取得失敗:", err)
		} else {
			log.Println("🧷 reply_to_message_id 保存対象: messageID =", messageID, " → replyToID =", replyToID)

			_, err := DB.Exec(`UPDATE messages SET reply_to_message_id = $1 WHERE id = $2`, replyToID, messageID)
			if err != nil {
				log.Println("❌ reply_to_message_id の保存失敗:", err)
			} else {
				log.Println("✅ reply_to_message_id 補完成功: message_id =", messageID, "→", replyToID)
			}
		}
	}

	// 成功レスポンス
	fmt.Fprintf(w, `{"urls": ["http://localhost:8080/uploads/%s"]}`, handler.Filename)
}
