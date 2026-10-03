package bridge

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// HostBridge connects to Cypheria's host services socket over Unix domain socket.
type HostBridge struct {
	pipePath string
	mu       sync.Mutex
	conn     net.Conn
	reader   *bufio.Reader
	seq      atomic.Int64
}

// HostRequest is a JSON-RPC 2.0 request sent to the host service socket.
type HostRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      string `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// HostResponse is a JSON-RPC 2.0 response received from the host service socket.
type HostResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *HostError      `json:"error,omitempty"`
}

// HostError represents a JSON-RPC error.
type HostError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e *HostError) Error() string {
	return fmt.Sprintf("host service error (%d): %s", e.Code, e.Message)
}

// NewHostBridge creates a new HostBridge for the given pipe path.
func NewHostBridge(pipePath string) *HostBridge {
	return &HostBridge{
		pipePath: pipePath,
	}
}

func (b *HostBridge) getConn() (net.Conn, *bufio.Reader, error) {
	if b.conn != nil {
		return b.conn, b.reader, nil
	}
	if b.pipePath == "" {
		return nil, nil, errors.New("host services pipe path not configured")
	}

	conn, err := net.DialTimeout("unix", b.pipePath, 5*time.Second)
	if err != nil {
		return nil, nil, fmt.Errorf("connect to host socket %s: %w", b.pipePath, err)
	}

	b.conn = conn
	b.reader = bufio.NewReader(conn)
	return b.conn, b.reader, nil
}

func (b *HostBridge) closeConn() {
	if b.conn != nil {
		_ = b.conn.Close()
		b.conn = nil
		b.reader = nil
	}
}

// CallService sends an RPC request to the host socket and awaits the result.
func (b *HostBridge) CallService(service string, request any) (json.RawMessage, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	reqID := fmt.Sprintf("req-%d", b.seq.Add(1))
	req := HostRequest{
		JSONRPC: "2.0",
		ID:      reqID,
		Method:  service,
		Params:  request,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal host request: %w", err)
	}

	// Try sending request; reconnect once on failure
	conn, reader, err := b.getConn()
	if err != nil {
		return nil, err
	}

	_ = conn.SetDeadline(time.Now().Add(60 * time.Second))
	if _, err := conn.Write(append(data, '\n')); err != nil {
		b.closeConn()
		conn, reader, err = b.getConn()
		if err != nil {
			return nil, fmt.Errorf("reconnect to host socket: %w", err)
		}
		_ = conn.SetDeadline(time.Now().Add(60 * time.Second))
		if _, err := conn.Write(append(data, '\n')); err != nil {
			b.closeConn()
			return nil, fmt.Errorf("write host request: %w", err)
		}
	}

	line, err := reader.ReadBytes('\n')
	if err != nil {
		b.closeConn()
		return nil, fmt.Errorf("read host response: %w", err)
	}

	var resp HostResponse
	if err := json.Unmarshal(line, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal host response: %w", err)
	}

	if resp.Error != nil {
		return nil, resp.Error
	}

	return resp.Result, nil
}

// FromEnv initializes a HostBridge from NODE_REPL_HOST_SERVICES_PIPE_PATH if set.
func FromEnv() *HostBridge {
	path := os.Getenv("NODE_REPL_HOST_SERVICES_PIPE_PATH")
	if path == "" {
		return nil
	}
	return NewHostBridge(path)
}
