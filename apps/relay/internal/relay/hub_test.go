package relay

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/cypheriaweb3/cypheria/apps/relay/internal/coordinator"
)

func TestRelayV2PairsClientAndServerDataSockets(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, 1024*1024, 64*1024, 4*1024*1024, time.Second, time.Second, 5*time.Second)
	coord := coordinator.NewMemory(coordinator.Node{ID: "test"})
	service, err := NewService(Components{Gateway: true, Worker: true}, "test", hub, coord, logger, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.PublicHandler())
	defer server.Close()

	control := dialRelay(t, server.URL, url.Values{"serverId": {"srv"}, "role": {"server"}, "v": {"2"}})
	defer control.CloseNow()
	var syncMessage struct {
		Type          string   `json:"type"`
		ConnectionIDs []string `json:"connectionIds"`
	}
	if err := wsjson.Read(context.Background(), control, &syncMessage); err != nil {
		t.Fatal(err)
	}
	if syncMessage.Type != "sync" || len(syncMessage.ConnectionIDs) != 0 {
		t.Fatalf("unexpected sync message: %#v", syncMessage)
	}

	client := dialRelay(t, server.URL, url.Values{"serverId": {"srv"}, "role": {"client"}, "v": {"2"}})
	defer client.CloseNow()
	var connected struct {
		Type         string `json:"type"`
		ConnectionID string `json:"connectionId"`
	}
	if err := wsjson.Read(context.Background(), control, &connected); err != nil {
		t.Fatal(err)
	}
	if connected.Type != "connected" || connected.ConnectionID == "" {
		t.Fatalf("unexpected connected message: %#v", connected)
	}

	data := dialRelay(t, server.URL, url.Values{
		"connectionId": {connected.ConnectionID}, "serverId": {"srv"}, "role": {"server"}, "v": {"2"},
	})
	defer data.CloseNow()
	hello, _ := json.Marshal(map[string]any{"type": "e2ee_hello", "key": "test-public-key"})
	if err := client.Write(context.Background(), websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	messageType, received, err := data.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if messageType != websocket.MessageText || string(received) != string(hello) {
		t.Fatalf("server received %d %q", messageType, received)
	}
	if err := data.Write(context.Background(), websocket.MessageText, []byte("opaque-ciphertext")); err != nil {
		t.Fatal(err)
	}
	_, received, err = client.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if string(received) != "opaque-ciphertext" {
		t.Fatalf("client received %q", received)
	}
}

func TestRelayRejectsPlaintextFirstClientFrame(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, 1024*1024, 64*1024, 4*1024*1024, time.Second, time.Second, 5*time.Second)
	service, err := NewService(Components{Gateway: true, Worker: true}, "test", hub, coordinator.NewMemory(coordinator.Node{ID: "test"}), logger, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.PublicHandler())
	defer server.Close()
	control := dialRelay(t, server.URL, url.Values{"serverId": {"srv"}, "role": {"server"}, "v": {"2"}})
	defer control.CloseNow()
	var syncMessage any
	if err := wsjson.Read(context.Background(), control, &syncMessage); err != nil {
		t.Fatal(err)
	}
	client := dialRelay(t, server.URL, url.Values{"serverId": {"srv"}, "role": {"client"}, "v": {"2"}})
	defer client.CloseNow()
	var connected struct {
		ConnectionID string `json:"connectionId"`
	}
	if err := wsjson.Read(context.Background(), control, &connected); err != nil {
		t.Fatal(err)
	}
	data := dialRelay(t, server.URL, url.Values{"connectionId": {connected.ConnectionID}, "serverId": {"srv"}, "role": {"server"}, "v": {"2"}})
	defer data.CloseNow()
	if err := client.Write(context.Background(), websocket.MessageText, []byte(`{"type":"session.hello"}`)); err != nil {
		t.Fatal(err)
	}
	_, _, err = data.Read(context.Background())
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("expected policy close, got %v", err)
	}
}

func TestRelayRejectsOversizedControlFrame(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, 1024, 16, 4096, time.Second, time.Second, 5*time.Second)
	service, err := NewService(Components{Gateway: true, Worker: true}, "test", hub, coordinator.NewMemory(coordinator.Node{ID: "test"}), logger, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.PublicHandler())
	defer server.Close()
	control := dialRelay(t, server.URL, url.Values{"serverId": {"srv"}, "role": {"server"}, "v": {"2"}})
	defer control.CloseNow()
	var syncMessage any
	if err := wsjson.Read(context.Background(), control, &syncMessage); err != nil {
		t.Fatal(err)
	}
	if err := control.Write(context.Background(), websocket.MessageText, []byte("a control frame that is too large")); err != nil {
		t.Fatal(err)
	}
	_, _, err = control.Read(context.Background())
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
		t.Fatalf("expected policy close, got %v", err)
	}
}

func TestRelayRemovesUnmatchedServerDataSocketAfterTimeout(t *testing.T) {
	t.Parallel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, 1024, 64, 4096, 20*time.Millisecond, time.Second, 5*time.Second)
	service, err := NewService(Components{Gateway: true, Worker: true}, "test", hub, coordinator.NewMemory(coordinator.Node{ID: "test"}), logger, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.PublicHandler())
	defer server.Close()
	data := dialRelay(t, server.URL, url.Values{
		"connectionId": {"missing-client"}, "serverId": {"srv"}, "role": {"server"}, "v": {"2"},
	})
	defer data.CloseNow()
	_, _, err = data.Read(context.Background())
	if websocket.CloseStatus(err) != websocket.StatusTryAgainLater {
		t.Fatalf("expected retryable close, got %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		hub.sessionsMu.Lock()
		remaining := len(hub.sessions)
		hub.sessionsMu.Unlock()
		if remaining == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("unmatched data socket left %d relay sessions behind", remaining)
		}
		time.Sleep(time.Millisecond)
	}
}

func dialRelay(t *testing.T, baseURL string, query url.Values) *websocket.Conn {
	t.Helper()
	parsed, err := url.Parse(baseURL)
	if err != nil {
		t.Fatal(err)
	}
	parsed.Scheme = "ws"
	parsed.Path = "/ws"
	parsed.RawQuery = query.Encode()
	connection, _, err := websocket.Dial(context.Background(), parsed.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return connection
}
