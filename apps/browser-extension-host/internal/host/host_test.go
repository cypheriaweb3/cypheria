//go:build !windows

package host

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testID = "jahdmaekjcmhofodmnpdhegangbeoaeh"

type browserSide struct {
	t      *testing.T
	writer *FrameWriter
	reader *bufio.Reader
	frames chan map[string]any
}

func (b *browserSide) send(message any) {
	body, _ := json.Marshal(message)
	if err := b.writer.Write(body); err != nil {
		b.t.Fatal(err)
	}
}

func (b *browserSide) next() map[string]any {
	select {
	case frame := <-b.frames:
		return frame
	case <-time.After(5 * time.Second):
		b.t.Fatal("no message reached the browser")
		return nil
	}
}

type fakeDesktop struct {
	listener net.Listener
	conns    chan net.Conn
}

// startDesktop listens like Desktop and writes the discovery file the host reads.
func startDesktop(t *testing.T, home string, reply func(params map[string]any) map[string]any) *fakeDesktop {
	t.Helper()
	socket := filepath.Join(home, "d.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	if err := os.MkdirAll(filepath.Join(home, "run"), 0o700); err != nil {
		t.Fatal(err)
	}
	discovery, _ := json.Marshal(map[string]any{
		"desktopVersion": "2.0.0", "endpoint": socket, "pid": 1, "protocolVersion": 1, "token": "0123456789abcdef0123",
	})
	if err := os.WriteFile(filepath.Join(home, "run", "browser-extension.json"), discovery, 0o600); err != nil {
		t.Fatal(err)
	}
	desktop := &fakeDesktop{listener: listener, conns: make(chan net.Conn, 4)}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			frame, err := ReadFrame(conn, MaxFromPeer)
			if err != nil {
				_ = conn.Close()
				continue
			}
			var request map[string]any
			_ = json.Unmarshal(frame, &request)
			params, _ := request["params"].(map[string]any)
			if params["token"] != "0123456789abcdef0123" {
				_ = conn.Close()
				continue
			}
			body, _ := json.Marshal(reply(params))
			_ = NewFrameWriter(conn, MaxFromPeer).Write(body)
			desktop.conns <- conn
		}
	}()
	return desktop
}

func accept(params map[string]any) map[string]any {
	return map[string]any{"id": "connect", "result": map[string]any{"desktopVersion": "2.0.0", "protocolVersion": 1}}
}

func runHost(t *testing.T, home string) *browserSide {
	t.Helper()
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		_ = inWriter.Close()
	})
	go func() {
		_ = Run(ctx, Options{
			AllowedIDs:    []string{testID},
			BrowserIn:     inReader,
			BrowserOut:    outWriter,
			Home:          home,
			Origin:        "chrome-extension://" + testID + "/",
			RetryInterval: 20 * time.Millisecond,
			Version:       "0.1.0",
		})
		_ = outWriter.Close()
	}()
	side := &browserSide{t: t, writer: NewFrameWriter(inWriter, MaxFromPeer), reader: bufio.NewReader(outReader), frames: make(chan map[string]any, 16)}
	go func() {
		for {
			frame, err := ReadFrame(side.reader, MaxToBrowser)
			if err != nil {
				return
			}
			var message map[string]any
			_ = json.Unmarshal(frame, &message)
			side.frames <- message
		}
	}()
	return side
}

func tempHome(t *testing.T) string {
	t.Helper()
	// Unix socket paths are short on macOS, so avoid the long default test directory.
	home, err := os.MkdirTemp("", "cbh")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(home) })
	return home
}

var hello = map[string]any{"id": 1, "method": "hello", "params": map[string]any{
	"extensionId": testID, "extensionVersion": "1.0.0", "protocolVersion": 1,
}}

func TestRefusesOtherCallers(t *testing.T) {
	err := Run(context.Background(), Options{AllowedIDs: []string{testID}, Origin: "chrome-extension://other/"})
	if err == nil || !strings.Contains(err.Error(), "not an allowed") {
		t.Fatalf("expected a refusal, got %v", err)
	}
}

func TestRelaysBetweenBrowserAndDesktop(t *testing.T) {
	home := tempHome(t)
	desktop := startDesktop(t, home, accept)
	browser := runHost(t, home)
	browser.send(hello)
	reply := browser.next()
	result, _ := reply["result"].(map[string]any)
	if result["desktopVersion"] != "2.0.0" || result["hostVersion"] != "0.1.0" {
		t.Fatalf("unexpected hello reply %v", reply)
	}
	conn := <-desktop.conns
	writer := NewFrameWriter(conn, MaxFromPeer)
	_ = writer.Write([]byte(`{"id":7,"method":"listTabs","params":{}}`))
	if got := browser.next(); got["method"] != "listTabs" {
		t.Fatalf("Desktop's request did not reach the browser: %v", got)
	}
	browser.send(map[string]any{"id": 7, "result": []any{}})
	frame, err := ReadFrame(conn, MaxFromPeer)
	if err != nil || !strings.Contains(string(frame), `"id":7`) {
		t.Fatalf("the browser's reply did not reach Desktop: %s %v", frame, err)
	}
	big := `{"id":8,"method":"cdp","params":{"x":"` + strings.Repeat("a", MaxToBrowser) + `"}}`
	_ = writer.Write([]byte(big))
	frame, err = ReadFrame(conn, MaxFromPeer)
	if err != nil || !strings.Contains(string(frame), `"id":8`) || !strings.Contains(string(frame), "larger than") {
		t.Fatalf("an oversized request was not refused: %s %v", frame, err)
	}
	_ = conn.Close()
	status := browser.next()
	params, _ := status["params"].(map[string]any)
	if status["method"] != "desktopStatus" || params["state"] != "disconnected" {
		t.Fatalf("expected a disconnect report, got %v", status)
	}
	if again := browser.next(); again["method"] != "desktopStatus" {
		t.Fatalf("expected a reconnect report, got %v", again)
	} else if p, _ := again["params"].(map[string]any); p["state"] != "connected" {
		t.Fatalf("expected the host to reconnect, got %v", again)
	}
}

func TestWaitsForDesktop(t *testing.T) {
	home := tempHome(t)
	browser := runHost(t, home)
	browser.send(hello)
	reply := browser.next()
	if perr, _ := reply["error"].(map[string]any); perr["code"] != "desktop_not_running" {
		t.Fatalf("expected desktop_not_running, got %v", reply)
	}
	browser.send(map[string]any{"id": 2, "method": "anything"})
	if perr, _ := browser.next()["error"].(map[string]any); perr["code"] != "desktop_not_running" {
		t.Fatal("requests without Desktop should fail")
	}
	startDesktop(t, home, accept)
	status := browser.next()
	if params, _ := status["params"].(map[string]any); status["method"] != "desktopStatus" || params["state"] != "connected" {
		t.Fatalf("expected the host to find Desktop, got %v", status)
	}
}

func TestReportsVersionMismatch(t *testing.T) {
	home := tempHome(t)
	startDesktop(t, home, func(map[string]any) map[string]any {
		return map[string]any{"id": "connect", "error": map[string]any{"code": "extension_update_required", "message": "Update."}}
	})
	browser := runHost(t, home)
	browser.send(hello)
	if perr, _ := browser.next()["error"].(map[string]any); perr["code"] != "extension_update_required" {
		t.Fatal("expected extension_update_required")
	}
}
