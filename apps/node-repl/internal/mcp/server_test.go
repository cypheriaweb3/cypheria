package mcp_test

import (
	"bytes"
	"context"
	"encoding/json"
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

	server := mcp.NewServer(sup)

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
