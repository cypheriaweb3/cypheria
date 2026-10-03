package supervisor

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/bridge"
	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/runtime"
)

// Supervisor controls the Node kernel process and relays RPC messages.
type Supervisor struct {
	mu             sync.Mutex
	runtime        *runtime.Runtime
	bridge         *bridge.HostBridge
	disableSandbox bool
	workingDir     string
	sessionID      string

	cmd          *exec.Cmd
	stdin        io.WriteCloser
	stdoutReader *bufio.Reader

	execSeq     atomic.Int64
	activeExecs sync.Map // map[string]*pendingExec
}

type pendingExec struct {
	id     string
	result chan *execResultMsg
	images []string
	mu     sync.Mutex
}

type execResultMsg struct {
	ID           string            `json:"id"`
	OK           bool              `json:"ok"`
	Output       string            `json:"output"`
	Error        *string           `json:"error"`
	NamedOutputs []json.RawMessage `json:"named_outputs"`
	ContentItems []json.RawMessage `json:"content_items"`
}

// ExecOutput holds the final output of a JavaScript execution.
type ExecOutput struct {
	Text     string
	Images   []string
	IsError  bool
	Duration time.Duration
}

// Options configure the Supervisor.
type Options struct {
	DisableSandbox bool
	WorkingDir     string
}

// New creates a new Supervisor.
func New(opts Options) (*Supervisor, error) {
	rt, err := runtime.Ensure()
	if err != nil {
		return nil, fmt.Errorf("ensure runtime: %w", err)
	}

	wd := opts.WorkingDir
	if wd == "" {
		wd, _ = os.Getwd()
	}
	if wd == "" {
		wd = os.TempDir()
	}

	s := &Supervisor{
		runtime:        rt,
		bridge:         bridge.FromEnv(),
		disableSandbox: opts.DisableSandbox,
		workingDir:     wd,
		sessionID:      fmt.Sprintf("repl-%d", time.Now().UnixNano()),
	}

	return s, nil
}

// EnsureProcess ensures that the Node kernel child process is running.
func (s *Supervisor) EnsureProcess() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd != nil && s.cmd.Process != nil {
		return nil
	}

	nodePath := os.Getenv("NODE_REPL_NODE_PATH")
	if nodePath == "" {
		var err error
		nodePath, err = exec.LookPath("node")
		if err != nil {
			return fmt.Errorf("node binary not found: %w", err)
		}
	}

	codexCli := os.Getenv("CODEX_CLI_PATH")
	var cmd *exec.Cmd

	if !s.disableSandbox && codexCli != "" {
		args := []string{"sandbox"}
		if pipe := os.Getenv("NODE_REPL_HOST_SERVICES_PIPE_PATH"); pipe != "" {
			args = append(args, "--allow-unix-socket", pipe)
		}
		// Allow runtime and temp directories
		args = append(args, "--allow-unix-socket", s.runtime.Dir)
		args = append(args, "--allow-unix-socket", os.TempDir())
		args = append(args, "--", nodePath, "--experimental-vm-modules", s.runtime.KernelPath,
			"--session-id", s.sessionID,
			"--working-dir", s.workingDir,
		)
		cmd = exec.Command(codexCli, args...)
	} else {
		cmd = exec.Command(nodePath, "--experimental-vm-modules", s.runtime.KernelPath,
			"--session-id", s.sessionID,
			"--working-dir", s.workingDir,
		)
	}

	cmd.Dir = s.workingDir
	cmd.Env = os.Environ()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("create stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("create stdout pipe: %w", err)
	}

	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return fmt.Errorf("start node_repl kernel process: %w", err)
	}

	s.cmd = cmd
	s.stdin = stdin
	s.stdoutReader = bufio.NewReader(stdout)

	go s.listenLoop(s.stdoutReader)
	go s.waitProcess(cmd)

	return nil
}

func (s *Supervisor) waitProcess(cmd *exec.Cmd) {
	_ = cmd.Wait()
	s.mu.Lock()
	if s.cmd == cmd {
		s.cmd = nil
		s.stdin = nil
		s.stdoutReader = nil
	}
	s.mu.Unlock()
}

func (s *Supervisor) writeToKernel(payload any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stdin == nil {
		return errors.New("kernel stdin not available")
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := s.stdin.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func (s *Supervisor) listenLoop(reader *bufio.Reader) {
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return
		}

		var generic map[string]json.RawMessage
		if err := json.Unmarshal(line, &generic); err != nil {
			continue
		}

		var msgType string
		if rawType, ok := generic["type"]; ok {
			_ = json.Unmarshal(rawType, &msgType)
		}

		switch msgType {
		case "exec_result":
			var res execResultMsg
			if err := json.Unmarshal(line, &res); err == nil {
				if val, ok := s.activeExecs.Load(res.ID); ok {
					p := val.(*pendingExec)
					p.result <- &res
				}
			}

		case "trusted_service_request":
			var req struct {
				ID      string          `json:"id"`
				ExecID  string          `json:"exec_id"`
				Service string          `json:"service"`
				Request json.RawMessage `json:"request"`
			}
			if err := json.Unmarshal(line, &req); err == nil {
				go s.handleTrustedServiceRequest(req.ID, req.Service, req.Request)
			}

		case "emit_image":
			var req struct {
				ID       string `json:"id"`
				ExecID   string `json:"exec_id"`
				ImageURL string `json:"image_url"`
			}
			if err := json.Unmarshal(line, &req); err == nil {
				if val, ok := s.activeExecs.Load(req.ExecID); ok {
					p := val.(*pendingExec)
					p.mu.Lock()
					p.images = append(p.images, req.ImageURL)
					p.mu.Unlock()
				}
				_ = s.writeToKernel(map[string]any{"id": req.ID, "ok": true})
			}

		case "emit_audio":
			var req struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(line, &req); err == nil {
				_ = s.writeToKernel(map[string]any{"id": req.ID, "ok": true})
			}

		case "suspend_timeout", "resume_timeout":
			var req struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(line, &req); err == nil && req.ID != "" {
				_ = s.writeToKernel(map[string]any{"id": req.ID, "ok": true})
			}
		}
	}
}

func (s *Supervisor) handleTrustedServiceRequest(id, service string, reqData json.RawMessage) {
	if s.bridge == nil {
		_ = s.writeToKernel(map[string]any{
			"id":    id,
			"ok":    false,
			"error": fmt.Sprintf("trusted service %s unavailable: host pipe not configured", service),
		})
		return
	}

	var parsedRequest any
	if len(reqData) > 0 {
		_ = json.Unmarshal(reqData, &parsedRequest)
	}

	res, err := s.bridge.CallService(service, parsedRequest)
	if err != nil {
		_ = s.writeToKernel(map[string]any{
			"id":    id,
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	_ = s.writeToKernel(map[string]any{
		"id":    id,
		"ok":    true,
		"value": res,
	})
}

// Exec executes a snippet of JavaScript in the kernel.
func (s *Supervisor) Exec(ctx context.Context, code string, timeoutMs int, title string) (*ExecOutput, error) {
	if err := s.EnsureProcess(); err != nil {
		return nil, fmt.Errorf("ensure kernel process: %w", err)
	}

	if timeoutMs <= 0 {
		timeoutMs = 30000
	}

	execID := fmt.Sprintf("exec-%d", s.execSeq.Add(1))
	p := &pendingExec{
		id:     execID,
		result: make(chan *execResultMsg, 1),
	}
	s.activeExecs.Store(execID, p)
	defer s.activeExecs.Delete(execID)

	start := time.Now()
	if err := s.writeToKernel(map[string]any{
		"type": "exec",
		"id":   execID,
		"code": code,
	}); err != nil {
		return nil, fmt.Errorf("write exec command: %w", err)
	}

	timeout := time.Duration(timeoutMs) * time.Millisecond
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, fmt.Errorf("execution timed out after %d ms", timeoutMs)
	case res := <-p.result:
		duration := time.Since(start)
		output := res.Output
		isErr := !res.OK
		if res.Error != nil && *res.Error != "" {
			if output != "" {
				output += "\n" + *res.Error
			} else {
				output = *res.Error
			}
		}

		p.mu.Lock()
		images := make([]string, len(p.images))
		copy(images, p.images)
		p.mu.Unlock()

		return &ExecOutput{
			Text:     output,
			Images:   images,
			IsError:  isErr,
			Duration: duration,
		}, nil
	}
}

// Reset resets the JavaScript kernel.
func (s *Supervisor) Reset() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		s.cmd = nil
		s.stdin = nil
		s.stdoutReader = nil
	}
	s.sessionID = fmt.Sprintf("repl-%d", time.Now().UnixNano())
	return nil
}

// AddNodeModuleDir adds a package directory for dynamic imports.
func (s *Supervisor) AddNodeModuleDir(dir string) error {
	if err := s.EnsureProcess(); err != nil {
		return err
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	return s.writeToKernel(map[string]any{
		"type": "add_node_module_dir",
		"path": abs,
	})
}

// TurnEnded notifies the kernel that a turn completed.
func (s *Supervisor) TurnEnded(eventName, sessionID, turnID string) error {
	if s.cmd == nil {
		return nil
	}
	reqID := fmt.Sprintf("turn-%d", time.Now().UnixNano())
	return s.writeToKernel(map[string]any{
		"type": "turn_ended",
		"id":   reqID,
		"event": map[string]string{
			"hook_event_name": eventName,
			"session_id":      sessionID,
			"turn_id":         turnID,
		},
	})
}
