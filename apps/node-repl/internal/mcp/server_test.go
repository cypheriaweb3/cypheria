package mcp_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/mcp"
	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/supervisor"
)

func TestMcpProtocol(t *testing.T) {
	sup, err := supervisor.New(supervisor.Options{
		DisableSandbox: true,
	})
	if err != nil {
		t.Fatalf("failed to create supervisor: %v", err)
	}
	defer sup.Reset()

	server := mcp.NewServer(sup, nil)

	requests := []string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"js","arguments":{"code":"const a = 10 + 32; nodeRepl.write(` + "`answer=${a}`" + `); a;"}}}`,
	}

	input := strings.Join(requests, "\n") + "\n"
	in := bytes.NewBufferString(input)
	out := &bytes.Buffer{}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Serve(ctx, in, out); err != nil {
		t.Fatalf("serve failed: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 response lines, got %d:\n%s", len(lines), out.String())
	}

	// 1. initialize response
	var initResp struct {
		ID     int `json:"id"`
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
			ServerInfo      struct {
				Name string `json:"name"`
			} `json:"serverInfo"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(lines[0]), &initResp); err != nil {
		t.Fatalf("unmarshal init response: %v", err)
	}
	if initResp.Result.ServerInfo.Name != "rmcp" {
		t.Errorf("expected server name rmcp, got %s", initResp.Result.ServerInfo.Name)
	}

	// 2. tools/list response
	var listResp struct {
		ID     int `json:"id"`
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(lines[1]), &listResp); err != nil {
		t.Fatalf("unmarshal tools/list response: %v", err)
	}
	toolNames := make(map[string]bool)
	for _, tool := range listResp.Result.Tools {
		toolNames[tool.Name] = true
	}
	if !toolNames["js"] || !toolNames["js_reset"] {
		t.Errorf("missing expected tools, got: %+v", toolNames)
	}

	// 3. tools/call response
	var callResp struct {
		ID     int `json:"id"`
		Result struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal([]byte(lines[2]), &callResp); err != nil {
		t.Fatalf("unmarshal tools/call response: %v", err)
	}
	if callResp.Result.IsError {
		t.Errorf("expected js call to succeed, got error: %+v", callResp.Result)
	}
	if len(callResp.Result.Content) == 0 || !strings.Contains(callResp.Result.Content[0].Text, "answer=42") {
		t.Errorf("expected output to contain answer=42, got: %+v", callResp.Result.Content)
	}
}

// With trusted RPC enabled, executions complete and `nodeRepl.rpc` reaches the
// host services socket.
func TestTrustedRpcReachesHostServices(t *testing.T) {
	// t.TempDir paths exceed the Unix socket length limit on macOS.
	dir, err := os.MkdirTemp("", "nr")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	defer os.RemoveAll(dir)
	socketPath := filepath.Join(dir, "h.sock")
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(conn net.Conn) {
				defer conn.Close()
				scanner := bufio.NewScanner(conn)
				for scanner.Scan() {
					var req struct {
						ID     string          `json:"id"`
						Method string          `json:"method"`
						Params json.RawMessage `json:"params"`
					}
					if json.Unmarshal(scanner.Bytes(), &req) != nil {
						continue
					}
					resp, _ := json.Marshal(map[string]any{
						"jsonrpc": "2.0",
						"id":      req.ID,
						"result":  map[string]any{"service": req.Method, "echo": req.Params},
					})
					_, _ = conn.Write(append(resp, '\n'))
				}
			}(conn)
		}
	}()

	t.Setenv("NODE_REPL_TRUSTED_RPC_ENABLED", "1")
	t.Setenv("NODE_REPL_HOST_SERVICES_PIPE_PATH", socketPath)
	sup, err := supervisor.New(supervisor.Options{DisableSandbox: true})
	if err != nil {
		t.Fatalf("failed to create supervisor: %v", err)
	}
	defer sup.Reset()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	res, err := sup.Exec(ctx, `const reply = await nodeRepl.rpc("cua", { op: "state" }); nodeRepl.write(JSON.stringify(reply));`, 10000, "")
	if err != nil {
		t.Fatalf("exec failed: %v", err)
	}
	if res.IsError || !strings.Contains(res.Text, `"service":"cua"`) || !strings.Contains(res.Text, `"op":"state"`) {
		t.Fatalf("unexpected rpc result: %+v", res)
	}
}

func TestEmittedMediaBecomesContent(t *testing.T) {
	t.Setenv("NODE_REPL_ENABLE_AUDIO", "1")
	sup, err := supervisor.New(supervisor.Options{DisableSandbox: true})
	if err != nil {
		t.Fatalf("failed to create supervisor: %v", err)
	}
	defer sup.Reset()

	code := `await nodeRepl.emitImage("data:image/png;base64,iVBORw0KGgo="); ` +
		`await nodeRepl.emitAudio("data:audio/wav;base64,UklGRg==");`
	request, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params":  map[string]any{"name": "js", "arguments": map[string]any{"code": code}},
	})
	out := &bytes.Buffer{}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := mcp.NewServer(sup, nil).Serve(ctx, bytes.NewBuffer(append(request, '\n')), out); err != nil {
		t.Fatalf("serve failed: %v", err)
	}

	var response struct {
		Result struct {
			Content []map[string]any `json:"content"`
			IsError bool             `json:"isError"`
		} `json:"result"`
	}
	if err := json.Unmarshal(out.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v\n%s", err, out.String())
	}
	if response.Result.IsError {
		t.Fatalf("exec failed: %v", response.Result.Content)
	}
	media := response.Result.Content[len(response.Result.Content)-2:]
	if media[0]["type"] != "image" || media[0]["mimeType"] != "image/png" || media[0]["data"] != "iVBORw0KGgo=" {
		t.Fatalf("image content = %v", media[0])
	}
	if media[1]["type"] != "audio" || media[1]["mimeType"] != "audio/wav" || media[1]["data"] != "UklGRg==" {
		t.Fatalf("audio content = %v", media[1])
	}
}
