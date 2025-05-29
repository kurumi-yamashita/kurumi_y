package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func ChatHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == http.MethodOptions {
		return
	}

	claims, err := validateJWT(r)
	if err != nil {
		writeJSONError(w, "認証失敗: "+err.Error(), http.StatusUnauthorized)
		return
	}
	username := claims.Username
	userID := claims.UserID

	roomIDStr := r.URL.Query().Get("roomId")
	if roomIDStr == "" {
		writeJSONError(w, "roomIdが必要です", http.StatusBadRequest)
		return
	}
	roomID, err := strconv.Atoi(roomIDStr)
	if err != nil {
		writeJSONError(w, "roomIdは整数である必要があります", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodPost:
		var input struct {
			Text     string   `json:"text"`
			ClientID string   `json:"client_id"`
			Images   []string `json:"images"`
			Type     string   `json:"type"`
			Content  string   `json:"content"`
			ReplyTo  *struct {
				Name     string `json:"name"`
				Text     string `json:"text"`
				ClientID string `json:"client_id"`
			} `json:"replyTo"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeJSONError(w, "JSON解析エラー", http.StatusBadRequest)
			return
		}

		if input.Type == "deleted" {
			cancelText := username + "が送信を取り消しました"
			_, err := DB.Exec(`UPDATE messages SET type='deleted', content=$1, updated_at=$2 WHERE client_id=$3`,
				cancelText, time.Now(), input.ClientID)
			if err != nil {
				log.Println("❌ 送信取消 UPDATE失敗:", err)
			}

			// ✅ 🔽 追加：broadcast メッセージを送信
			msg := ChatMessage{
				ClientID: input.ClientID,
				Type:     "deleted",
				RoomID:   roomID,
				UserID:   userID,
				Sender:   username,
			}
			go BroadcastMessage(roomID, msg)

			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"deleted"}`))
			return
		}

		var replyToMessageID *int
		if input.ReplyTo != nil && input.ReplyTo.ClientID != "" {
			var id int
			err := DB.QueryRow(`SELECT id FROM messages WHERE client_id = $1`, input.ReplyTo.ClientID).Scan(&id)
			if err == nil {
				replyToMessageID = &id
			} else {
				log.Println("⚠️ reply_to_message_id 取得失敗: client_id=", input.ReplyTo.ClientID, " err=", err)
			}
		}

		msgType := "message"
		if input.Type != "" {
			msgType = input.Type
		}

		msgText := input.Text
		if msgType == "stamp" {
			if input.Content != "" {
				msgText = input.Content // ✅ フロントから明示的に受け取る
			} else if len(input.Images) == 1 {
				msgText = input.Images[0]
			}
		}

		var msgID int
		err = DB.QueryRow(`
		INSERT INTO messages (room_id, sender_id, content, client_id, created_at, updated_at, type, reply_to_message_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, roomID, userID, msgText, input.ClientID, time.Now(), time.Now(), msgType, replyToMessageID).Scan(&msgID)
		if err != nil {
			writeJSONError(w, "メッセージ保存エラー", http.StatusInternalServerError)
			return
		}
		log.Printf("✅ メッセージ保存成功: id=%d, client_id=%s", msgID, input.ClientID)

		for _, image := range input.Images {
			_, _ = DB.Exec(`
			INSERT INTO message_attachments (message_id, file_name, created_at)
			VALUES ($1, $2, $3)
		`, msgID, image, time.Now())
		}

		// 🔽 追加: mention の処理
		if msgType == "message" {
			var mentionTargets []int

			// @all → ルームメンバー全員を対象
			if strings.Contains(msgText, "@all") {
				rows, err := DB.Query(`SELECT user_id FROM room_members WHERE room_id = $1 AND user_id != $2`, roomID, userID)
				if err == nil {
					for rows.Next() {
						var uid int
						_ = rows.Scan(&uid)
						mentionTargets = append(mentionTargets, uid)
					}
					rows.Close()
				}
			}

			// @username の個別指定を抽出
			userRows, err := DB.Query(`SELECT u.id, u.username FROM users u JOIN room_members rm ON u.id = rm.user_id WHERE rm.room_id = $1`, roomID)
			if err == nil {
				for userRows.Next() {
					var uid int
					var uname string
					_ = userRows.Scan(&uid, &uname)
					pattern := "@" + uname
					if strings.Contains(msgText, pattern) && uid != userID {
						mentionTargets = append(mentionTargets, uid)
					}
				}
				userRows.Close()
			}

			// 重複除去
			seen := map[int]bool{}
			for _, uid := range mentionTargets {
				if !seen[uid] {
					_, _ = DB.Exec(`
					INSERT INTO message_mentions (message_id, target_user_id, created_at)
					VALUES ($1, $2, $3)
				`, msgID, uid, time.Now())
					seen[uid] = true
				}
			}
		}

		msg := ChatMessage{
			ID:        msgID,
			Text:      msgText,
			Sender:    username,
			ReadCount: 0,
			RoomID:    roomID,
			Type:      msgType,
			UserID:    userID,
			ClientID:  input.ClientID,
			Images:    input.Images,
		}

		if input.ReplyTo != nil {
			msg.ReplyTo = &ReplyToInfo{
				Name:     input.ReplyTo.Name,
				Text:     input.ReplyTo.Text,
				ClientID: input.ReplyTo.ClientID,
			}
		}

		go BroadcastMessage(roomID, msg)
		json.NewEncoder(w).Encode(msg)

	case http.MethodGet:
		rows, err := DB.Query(`
			SELECT 
				m.id, m.content, u.username,
				(SELECT COUNT(*) FROM message_reads WHERE message_id = m.id),
				m.client_id, m.type,
				rm.content, ru.username, rm.client_id
			FROM messages m
			JOIN users u ON m.sender_id = u.id
			LEFT JOIN messages rm ON m.reply_to_message_id = rm.id
			LEFT JOIN users ru ON rm.sender_id = ru.id
			WHERE m.room_id = $1
			ORDER BY m.created_at ASC
		`, roomID)
		if err != nil {
			writeJSONError(w, "メッセージ取得失敗", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var messages []ChatMessage
		for rows.Next() {
			var msg ChatMessage
			var replyText, replySender, replyClientID *string
			err := rows.Scan(
				&msg.ID, &msg.Text, &msg.Sender, &msg.ReadCount,
				&msg.ClientID, &msg.Type, &replyText, &replySender, &replyClientID,
			)
			if err != nil {
				continue
			}
			if replyText != nil && replySender != nil && replyClientID != nil {
				msg.ReplyTo = &ReplyToInfo{
					Text:     *replyText,
					Name:     *replySender,
					ClientID: *replyClientID,
				}
			}

			// read_by の取得を追加
			readByRows, err := DB.Query(`SELECT user_id FROM message_reads WHERE message_id = $1`, msg.ID)
			if err == nil {
				var readBy []int
				for readByRows.Next() {
					var uid int
					_ = readByRows.Scan(&uid)
					readBy = append(readBy, uid)
				}
				msg.ReadBy = readBy
				readByRows.Close()
			}

			// 画像の取得
			rows2, _ := DB.Query(`SELECT file_name FROM message_attachments WHERE message_id = $1`, msg.ID)
			for rows2.Next() {
				var fname string
				_ = rows2.Scan(&fname)

				if msg.Type == "stamp" {
					// スタンプはそのまま
					msg.Images = append(msg.Images, fname)
				} else {
					msg.Images = append(msg.Images, "http://localhost:8080/uploads/"+fname)
				}
			}
			rows2.Close()

			messages = append(messages, msg)
		}

		if messages == nil {
			messages = []ChatMessage{}
		}

		json.NewEncoder(w).Encode(messages)

	default:
		writeJSONError(w, "不正なメソッド", http.StatusMethodNotAllowed)
	}
}

func BroadcastMessageToAll(msg ChatMessage) {
	for _, clients := range roomClients {
		for conn := range clients {
			if err := conn.WriteJSON(msg); err != nil {
				log.Printf("❌ BroadcastToAll失敗: %v", err)
				conn.Close()
				delete(clients, conn)
			}
		}
	}
}

func DeleteMessageHandler(w http.ResponseWriter, r *http.Request) {
	setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodPost {
		writeJSONError(w, "不正なメソッド", http.StatusMethodNotAllowed)
		return
	}

	claims, err := validateJWT(r)
	if err != nil {
		writeJSONError(w, "認証失敗: "+err.Error(), http.StatusUnauthorized)
		return
	}
	username := claims.Username
	userID := claims.UserID

	var req struct {
		ClientID string `json:"client_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, "リクエスト不正", http.StatusBadRequest)
		return
	}

	_, err = DB.Exec(`DELETE FROM messages WHERE client_id = $1`, req.ClientID)
	if err != nil {
		writeJSONError(w, "削除失敗", http.StatusInternalServerError)
		return
	}

	msg := ChatMessage{
		ClientID: req.ClientID,
		Type:     "delete",
		UserID:   userID,
		Sender:   username,
	}
	go BroadcastMessageToAll(msg) // ✅ roomID に依存しないように全体Broadcast

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"deleted"}`))
}
