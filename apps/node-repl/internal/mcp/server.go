package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/supervisor"
)

// Server implements an MCP stdio server.
type Server struct {
	supervisor *supervisor.Supervisor
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// NewServer creates a new MCP Server with the given supervisor.
func NewServer(sup *supervisor.Supervisor) *Server {
	return &Server{
		supervisor: sup,
	}
}

// Serve reads JSON-RPC requests from in and writes responses to out.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	reader := bufio.NewReader(in)
	writer := bufio.NewWriter(out)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		lineStr := strings.TrimSpace(string(line))
		if lineStr == "" {
			continue
		}

		var req rpcRequest
		if err := json.Unmarshal([]byte(lineStr), &req); err != nil {
			s.writeError(writer, nil, -32700, "Parse error")
			continue
		}

		resp := s.handleRequest(ctx, req)
		if resp != nil {
			respBytes, err := json.Marshal(resp)
			if err != nil {
				continue
			}
			_, _ = writer.Write(append(respBytes, '\n'))
			_ = writer.Flush()
		}
	}
}

func (s *Server) writeError(w *bufio.Writer, id any, code int, msg string) {
	resp := rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &rpcError{
			Code:    code,
			Message: msg,
		},
	}
	bytes, _ := json.Marshal(resp)
	_, _ = w.Write(append(bytes, '\n'))
	_ = w.Flush()
}

func (s *Server) handleRequest(ctx context.Context, req rpcRequest) *rpcResponse {
	// Notifications (without ID) don't receive replies
	if req.ID == nil && req.Method == "notifications/cancelled" {
		return nil
	}

	switch req.Method {
	case "initialize":
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities": map[string]any{
					"tools": map[string]any{
						"listChanged": true,
					},
				},
				"serverInfo": map[string]any{
					"name":    "rmcp",
					"version": "1.5.0",
				},
				"instructions": "Use `js` for `node_repl` execution with persistent, redeclarable top-level bindings, `js_reset` to clear bindings, and `js_add_node_module_dir` to add package directories.",
			},
		}

	case "ping":
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result:  map[string]any{},
		}

	case "tools/list":
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"tools": s.toolDefinitions(),
			},
		}

	case "tools/call":
		return s.handleToolCall(ctx, req)

	default:
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error: &rpcError{
				Code:    -32601,
				Message: fmt.Sprintf("Method not found: %s", req.Method),
			},
		}
	}
}

func (s *Server) toolDefinitions() []map[string]any {
	return []map[string]any{
		{
			"name":        "js",
			"description": "Execute JavaScript in a persistent `node_repl` with top-level await. Top-level bindings persist until `js_reset` and can be redeclared. Use `const` for stable values and `let` for changing values. Use dynamic imports such as `await import(\"playwright\")`; top-level static imports and `node:process` are unavailable. Use `nodeRepl.write(value)` for output and `await nodeRepl.emitImage(image)` for images. Execution context is available through `nodeRepl.cwd`, `nodeRepl.homeDir`, `nodeRepl.tmpDir`, and `nodeRepl.requestMeta`. The default timeout is 30000 ms (30 seconds); increase `timeout_ms` for longer operations. Use `js_add_node_module_dir` when an additional package directory is required.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"code": map[string]any{
						"type":        "string",
						"description": "JavaScript code to execute with top-level await.",
					},
					"timeout_ms": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"description": "Optional execution timeout in milliseconds. Defaults to 30000 (30 seconds) when omitted.",
					},
					"title": map[string]any{
						"type":        "string",
						"minLength":   1,
						"maxLength":   80,
						"description": "Short user-facing description of what the code does.",
					},
				},
				"required":             []string{"code"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "js_add_node_module_dir",
			"description": "Add an absolute `node_modules` directory for package imports. The directory remains available after `js_reset`.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"minLength":   1,
						"description": "Absolute path to a node_modules directory to add to Node package resolution.",
					},
				},
				"required":             []string{"path"},
				"additionalProperties": false,
			},
			"annotations": map[string]any{
				"readOnlyHint":    true,
				"destructiveHint": false,
				"openWorldHint":   false,
			},
		},
		{
			"name":        "js_reset",
			"description": "Reset the JavaScript kernel and clear all bindings.",
			"inputSchema": map[string]any{
				"type":                 "object",
				"properties":           map[string]any{},
				"additionalProperties": false,
			},
			"annotations": map[string]any{
				"readOnlyHint":    true,
				"destructiveHint": false,
				"openWorldHint":   false,
			},
		},
		{
			"name":        "turn_ended",
			"description": "Notify trusted libraries that a Codex turn ended. Repeated notifications for the same session and turn are ignored.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"hook_event_name": map[string]any{
						"type":      "string",
						"minLength": 1,
					},
					"session_id": map[string]any{
						"type":      "string",
						"minLength": 1,
					},
					"turn_id": map[string]any{
						"type":      "string",
						"minLength": 1,
					},
				},
				"required":             []string{"hook_event_name", "session_id", "turn_id"},
				"additionalProperties": false,
			},
			"annotations": map[string]any{
				"idempotentHint": true,
			},
			"_meta": map[string]any{
				"ui": map[string]any{
					"visibility": []string{},
				},
			},
		},
	}
}

func (s *Server) handleToolCall(ctx context.Context, req rpcRequest) *rpcResponse {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &rpcError{Code: -32602, Message: "Invalid parameters for tools/call"},
		}
	}

	switch params.Name {
	case "js":
		var args struct {
			Code      string `json:"code"`
			TimeoutMs int    `json:"timeout_ms"`
			Title     string `json:"title"`
		}
		_ = json.Unmarshal(params.Arguments, &args)
		if args.Code == "" {
			return &rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &rpcError{Code: -32602, Message: "Missing required argument 'code'"},
			}
		}

		res, err := s.supervisor.Exec(ctx, args.Code, args.TimeoutMs, args.Title)
		if err != nil {
			return &rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"content": []map[string]any{
						{
							"type": "text",
							"text": err.Error(),
						},
					},
					"isError": true,
				},
			}
		}

		content := make([]map[string]any, 0, len(res.Images)+1)
		if res.Text != "" || len(res.Images) == 0 {
			content = append(content, map[string]any{
				"type": "text",
				"text": res.Text,
			})
		}
		for _, img := range res.Images {
			if strings.HasPrefix(img, "data:") {
				parts := strings.SplitN(img, ",", 2)
				if len(parts) == 2 {
					mime := "image/png"
					header := parts[0]
					if strings.HasPrefix(header, "data:") && strings.Contains(header, ";") {
						mime = strings.TrimPrefix(strings.Split(header, ";")[0], "data:")
					}
					content = append(content, map[string]any{
						"type":     "image",
						"data":     parts[1],
						"mimeType": mime,
					})
					continue
				}
			}
			content = append(content, map[string]any{
				"type": "text",
				"text": fmt.Sprintf("[Image: %s]", img),
			})
		}

		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"content": content,
				"isError": res.IsError,
				"_meta": map[string]any{
					"codex/nodeReplExecutionDurationMs": int(res.Duration.Milliseconds()),
				},
			},
		}

	case "js_reset":
		if err := s.supervisor.Reset(); err != nil {
			return &rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"content": []map[string]any{
						{"type": "text", "text": fmt.Sprintf("Failed to reset kernel: %v", err)},
					},
					"isError": true,
				},
			}
		}
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": "Reset the JavaScript kernel and cleared all bindings."},
				},
				"isError": false,
			},
		}

	case "js_add_node_module_dir":
		var args struct {
			Path string `json:"path"`
		}
		_ = json.Unmarshal(params.Arguments, &args)
		if args.Path == "" {
			return &rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &rpcError{Code: -32602, Message: "Missing required argument 'path'"},
			}
		}
		if err := s.supervisor.AddNodeModuleDir(args.Path); err != nil {
			return &rpcResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]any{
					"content": []map[string]any{
						{"type": "text", "text": fmt.Sprintf("Failed to add module dir: %v", err)},
					},
					"isError": true,
				},
			}
		}
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"content": []map[string]any{
					{"type": "text", "text": fmt.Sprintf("Added module directory: %s", args.Path)},
				},
				"isError": false,
			},
		}

	case "turn_ended":
		var args struct {
			HookEventName string `json:"hook_event_name"`
			SessionID     string `json:"session_id"`
			TurnID        string `json:"turn_id"`
		}
		_ = json.Unmarshal(params.Arguments, &args)
		_ = s.supervisor.TurnEnded(args.HookEventName, args.SessionID, args.TurnID)
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Result: map[string]any{
				"content": []map[string]any{},
				"isError": false,
			},
		}

	default:
		return &rpcResponse{
			JSONRPC: "2.0",
			ID:      req.ID,
			Error:   &rpcError{Code: -32601, Message: fmt.Sprintf("Unknown tool: %s", params.Name)},
		}
	}
}
