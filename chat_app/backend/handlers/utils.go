package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Connection struct {
	Conn   *websocket.Conn
	UserID int
	RoomID int
}

var (
	roomConns   = make(map[int][]*Connection)
	globalConns = sync.Map{} // ✅ sync.Map に修正
	connMutex   = &sync.Mutex{}
)

func AddRoomConnection(roomID int, conn *Connection) {
	connMutex.Lock()
	defer connMutex.Unlock()
	roomConns[roomID] = append(roomConns[roomID], conn)
}

func RemoveRoomConnection(roomID int, target *Connection) {
	connMutex.Lock()
	defer connMutex.Unlock()
	conns := roomConns[roomID]
	for i, c := range conns {
		if c == target {
			roomConns[roomID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
}

func BroadcastToRoom(roomID int, msg interface{}, exclude *Connection) {
	connMutex.Lock()
	conns := roomConns[roomID]
	connMutex.Unlock()
	for _, c := range conns {
		if c != exclude {
			if err := c.Conn.WriteJSON(msg); err != nil {
				log.Println("❌ WebSocket送信エラー:", err)
			}
		}
	}
}

func AddGlobalConnection(conn *Connection) {
	globalConns.Store(conn.UserID, conn)
}

func RemoveGlobalConnection(target *Connection) {
	globalConns.Range(func(key, value any) bool {
		c, ok := value.(*Connection)
		if ok && c == target {
			globalConns.Delete(key)
			return false
		}
		return true
	})
}

func DisconnectExistingNotifyConnection(userID int, newConn *websocket.Conn) {
	if existing, ok := globalConns.Load(userID); ok {
		if existingConn, ok := existing.(*Connection); ok && existingConn.Conn != newConn {
			log.Printf("⚠️ 既存Notify接続を切断: userID=%d", userID)
			existingConn.Conn.Close()
		}
		globalConns.Delete(userID)
	}
}

func BroadcastGlobal(msg interface{}) {
	globalConns.Range(func(_, value any) bool {
		c, ok := value.(*Connection)
		if ok {
			if err := c.Conn.WriteJSON(msg); err != nil {
				log.Println("❌ グローバルWebSocket送信エラー:", err)
			}
		}
		return true
	})
}

var roomPresenceMap = make(map[int]map[int]bool)
var presenceMutex = &sync.Mutex{}

func NotifyWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	setCORSHeaders(w, r)
	token := r.Header.Get("Sec-WebSocket-Protocol")
	if token == "" {
		log.Println("❌ トークンが空です")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	claims, err := validateJWTFromTokenString(token)
	if err != nil {
		log.Println("❌ JWT認証失敗:", err)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if !websocket.IsWebSocketUpgrade(r) {
		log.Println("❌ WebSocketアップグレード失敗")
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	responseHeader := http.Header{}
	responseHeader.Set("Sec-WebSocket-Protocol", r.Header.Get("Sec-WebSocket-Protocol"))

	conn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Println("❌ WebSocketアップグレード失敗:", err)
		return
	}

	userID := claims.UserID
	username := claims.Username
	c := &Connection{Conn: conn, UserID: userID, RoomID: 0}

	DisconnectExistingNotifyConnection(userID, conn)
	AddGlobalConnection(c)

	conn.SetCloseHandler(func(code int, text string) error {
		log.Printf("🔌 Notify WebSocket切断: code=%d, reason=%s", code, text)
		return nil
	})

	log.Println("📡 Notify WebSocket接続:", username)

	defer func() {
		log.Println("🔌 Notify切断:", username)
		RemoveGlobalConnection(c)
		removeFromAllRooms(userID)
		log.Println("🧹 接続情報削除完了:", username)
		conn.Close()
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("❌ WebSocketメッセージの読み取りエラー:", err)
			break
		}

		var parsed map[string]interface{}
		if err := json.Unmarshal(msg, &parsed); err != nil {
			log.Println("❌ Notify JSONパース失敗:", err)
			continue
		}

		log.Printf("🔔 通知受信: userID=%d, sender=%s, clientID=%v, roomId=%v, type=%v, action=%v",
			userID, username, parsed["client_id"], parsed["roomId"], parsed["type"], parsed["action"])

		if parsed["type"] == "presence" {
			roomIdAny, ok := parsed["roomId"]
			if !ok {
				log.Println("❌ roomIdが欠落")
				continue
			}
			roomIdFloat, ok := roomIdAny.(float64)
			if !ok {
				log.Println("❌ roomId形式不正:", roomIdAny)
				continue
			}
			roomId := int(roomIdFloat)
			action, _ := parsed["action"].(string)
			updatePresence(roomId, userID, action)
		}

		BroadcastGlobal(parsed)
	}
}

func updatePresence(roomId int, userId int, action string) {
	presenceMutex.Lock()
	defer presenceMutex.Unlock()

	if _, exists := roomPresenceMap[roomId]; !exists {
		roomPresenceMap[roomId] = make(map[int]bool)
	}

	if action == "enter" {
		for _, members := range roomPresenceMap {
			delete(members, userId)
		}
		roomPresenceMap[roomId][userId] = true
		log.Printf("✅ [ENTER] userID=%d が roomID=%d に入室", userId, roomId)
	} else if action == "leave" {
		delete(roomPresenceMap[roomId], userId)
		log.Printf("❌ [LEAVE] userID=%d が roomID=%d から退室", userId, roomId)
	}

	log.Printf("📊 roomPresenceMap 状態: %+v", roomPresenceMap)
}

func removeFromAllRooms(userId int) {
	presenceMutex.Lock()
	defer presenceMutex.Unlock()
	for _, members := range roomPresenceMap {
		delete(members, userId)
	}
}

func WriteJSONError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	response := map[string]string{"error": message}
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Println("❌ JSONエンコードエラー:", err)
	}
}

func setCORSHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
}
