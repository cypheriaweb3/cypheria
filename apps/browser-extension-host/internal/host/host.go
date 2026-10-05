// Package host carries the Cypheria extension's messages between Chrome native messaging and
// Cypheria Desktop's local socket. It answers `hello` itself, connects to the Desktop that
// wrote the discovery file, and otherwise passes messages through unchanged in both directions.
package host

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Options configures one host process, which Chrome starts per extension connection.
type Options struct {
	// Origin is the caller Chrome names in the first argument, chrome-extension://<id>/.
	Origin string
	// AllowedIDs are the extension IDs this host serves.
	AllowedIDs []string
	// Home is CYPHERIA_HOME, which holds run/browser-extension.json.
	Home string
	// Version is this host's version.
	Version string
	// Browser is Chrome's side: standard input and output.
	BrowserIn  io.Reader
	BrowserOut io.Writer
	// Dial connects to Desktop's endpoint; DialEndpoint when nil.
	Dial func(ctx context.Context, endpoint string) (net.Conn, error)
	// RetryInterval is how often the host looks for Desktop while it is not running.
	RetryInterval time.Duration
}

type envelope struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *protocolError  `json:"error,omitempty"`
}

type protocolError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *protocolError) Error() string { return e.Code + ": " + e.Message }

type discovery struct {
	Endpoint        string `json:"endpoint"`
	Token           string `json:"token"`
	ProtocolVersion int    `json:"protocolVersion"`
	DesktopVersion  string `json:"desktopVersion"`
}

type desktop struct {
	conn    net.Conn
	writer  *FrameWriter
	version string
	frames  chan []byte
	done    chan struct{}
}

func notRunning() *protocolError {
	return &protocolError{Code: "desktop_not_running", Message: "Cypheria Desktop is not running. Start it to let agents use this browser."}
}

// ExtensionID returns the ID in a chrome-extension:// origin, or "" for any other origin.
func ExtensionID(origin string) string {
	id, ok := strings.CutPrefix(origin, "chrome-extension://")
	if !ok {
		return ""
	}
	return strings.TrimSuffix(id, "/")
}

// Run serves one extension connection until Chrome closes standard input.
func Run(ctx context.Context, opts Options) error {
	id := ExtensionID(opts.Origin)
	allowed := false
	for _, candidate := range opts.AllowedIDs {
		allowed = allowed || (id != "" && id == candidate)
	}
	if !allowed {
		return fmt.Errorf("caller %q is not an allowed Cypheria extension", opts.Origin)
	}
	if opts.Dial == nil {
		opts.Dial = DialEndpoint
	}
	if opts.RetryInterval <= 0 {
		opts.RetryInterval = 2 * time.Second
	}
	browser := NewFrameWriter(opts.BrowserOut, MaxToBrowser)
	inbound := make(chan []byte)
	readErr := make(chan error, 1)
	go func() {
		reader := bufio.NewReader(opts.BrowserIn)
		for {
			frame, err := ReadFrame(reader, MaxFromPeer)
			if err != nil {
				readErr <- err
				return
			}
			select {
			case inbound <- frame:
			case <-ctx.Done():
				return
			}
		}
	}()

	var (
		hello    json.RawMessage
		current  *desktop
		retrying bool
	)
	ticker := time.NewTicker(opts.RetryInterval)
	defer ticker.Stop()
	defer func() {
		if current != nil {
			_ = current.conn.Close()
		}
	}()

	send := func(message any) {
		body, err := json.Marshal(message)
		if err == nil {
			_ = browser.Write(body)
		}
	}
	status := func(state string, perr *protocolError, version string) {
		params := map[string]any{"state": state}
		if perr != nil {
			params["error"] = perr
		}
		if version != "" {
			params["desktopVersion"] = version
		}
		send(map[string]any{"method": "desktopStatus", "params": params})
	}
	connect := func() *protocolError {
		d, perr := connectDesktop(ctx, opts, hello)
		if perr != nil {
			return perr
		}
		current = d
		return nil
	}

	for {
		var desktopFrames chan []byte
		var desktopDone chan struct{}
		if current != nil {
			desktopFrames, desktopDone = current.frames, current.done
		}
		select {
		case <-ctx.Done():
			return nil
		case err := <-readErr:
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		case frame := <-inbound:
			var message envelope
			if err := json.Unmarshal(frame, &message); err != nil {
				continue
			}
			if message.Method == "hello" && message.ID != nil {
				hello = message.Params
				if current == nil {
					if perr := connect(); perr != nil {
						retrying = perr.Code == "desktop_not_running"
						send(map[string]any{"id": message.ID, "error": perr})
						continue
					}
				}
				retrying = false
				send(map[string]any{"id": message.ID, "result": map[string]any{
					"desktopVersion":  current.version,
					"hostVersion":     opts.Version,
					"protocolVersion": protocolVersionOf(hello),
				}})
				continue
			}
			if current != nil {
				_ = current.writer.Write(frame)
			} else if message.ID != nil && message.Method != "" {
				send(map[string]any{"id": message.ID, "error": notRunning()})
			}
		case frame := <-desktopFrames:
			if err := browser.Write(frame); errors.Is(err, ErrTooLarge) {
				var message envelope
				if json.Unmarshal(frame, &message) == nil && message.ID != nil && message.Method != "" {
					body, _ := json.Marshal(map[string]any{"id": message.ID, "error": protocolError{
						Code: "failed", Message: fmt.Sprintf("The message is larger than the %d bytes Chrome accepts.", MaxToBrowser),
					}})
					_ = current.writer.Write(body)
				}
			}
		case <-desktopDone:
			_ = current.conn.Close()
			current = nil
			retrying = hello != nil
			status("disconnected", notRunning(), "")
		case <-ticker.C:
			if !retrying || current != nil || hello == nil {
				continue
			}
			if perr := connect(); perr != nil {
				if perr.Code != "desktop_not_running" {
					retrying = false
					status("disconnected", perr, "")
				}
				continue
			}
			retrying = false
			status("connected", nil, current.version)
		}
	}
}

func protocolVersionOf(hello json.RawMessage) int {
	var params struct {
		ProtocolVersion int `json:"protocolVersion"`
	}
	_ = json.Unmarshal(hello, &params)
	return params.ProtocolVersion
}

// connectDesktop reads the discovery file, dials Desktop, and presents the token and the
// extension's hello. Desktop answers with its version or a protocol error.
func connectDesktop(ctx context.Context, opts Options, hello json.RawMessage) (*desktop, *protocolError) {
	raw, err := os.ReadFile(filepath.Join(opts.Home, "run", "browser-extension.json"))
	if err != nil {
		return nil, notRunning()
	}
	var found discovery
	if err := json.Unmarshal(raw, &found); err != nil || found.Endpoint == "" || found.Token == "" {
		return nil, notRunning()
	}
	dialCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	conn, err := opts.Dial(dialCtx, found.Endpoint)
	if err != nil {
		return nil, notRunning()
	}
	writer := NewFrameWriter(conn, MaxFromPeer)
	request, _ := json.Marshal(map[string]any{
		"id":     "connect",
		"method": "connect",
		"params": map[string]any{
			"hello":       hello,
			"hostVersion": opts.Version,
			"origin":      opts.Origin,
			"token":       found.Token,
		},
	})
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if err := writer.Write(request); err != nil {
		_ = conn.Close()
		return nil, notRunning()
	}
	reader := bufio.NewReader(conn)
	frame, err := ReadFrame(reader, MaxFromPeer)
	if err != nil {
		_ = conn.Close()
		return nil, notRunning()
	}
	_ = conn.SetDeadline(time.Time{})
	var reply envelope
	if err := json.Unmarshal(frame, &reply); err != nil {
		_ = conn.Close()
		return nil, &protocolError{Code: "failed", Message: "Cypheria Desktop sent an invalid reply."}
	}
	if reply.Error != nil {
		_ = conn.Close()
		return nil, reply.Error
	}
	var result struct {
		DesktopVersion string `json:"desktopVersion"`
	}
	_ = json.Unmarshal(reply.Result, &result)
	d := &desktop{conn: conn, writer: writer, version: result.DesktopVersion, frames: make(chan []byte), done: make(chan struct{})}
	go func() {
		defer close(d.done)
		for {
			frame, err := ReadFrame(reader, MaxFromPeer)
			if err != nil {
				return
			}
			select {
			case d.frames <- frame:
			case <-ctx.Done():
				return
			}
		}
	}()
	return d, nil
}

// HomeFromExecutable resolves CYPHERIA_HOME from the host's own path, $CYPHERIA_HOME/bin/<host>,
// because Chrome starts the host without Cypheria's environment.
func HomeFromExecutable() (string, error) {
	if home := os.Getenv("CYPHERIA_HOME"); home != "" {
		return home, nil
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return filepath.Dir(filepath.Dir(executable)), nil
}
