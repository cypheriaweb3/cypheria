package relay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/sync/semaphore"
)

const (
	closeReplaced       = websocket.StatusServiceRestart
	closePolicy         = websocket.StatusPolicyViolation
	closeTryAgain       = websocket.StatusTryAgainLater
	controlQueueBytes   = int64(1024 * 1024)
	writerQueueCapacity = 128
)

type Hub struct {
	logger            *slog.Logger
	maxDataBytes      int64
	maxControlBytes   int64
	attachTimeout     time.Duration
	deliveryTimeout   time.Duration
	transportTimeout  time.Duration
	ingress           *semaphore.Weighted
	sessionsMu        sync.Mutex
	sessions          map[string]*session
	accepted          atomic.Int64
	rejected          atomic.Int64
	activeConnections atomic.Int64
}

type Stats struct {
	Accepted int64
	Active   int64
	Rejected int64
}

func NewHub(logger *slog.Logger, maxDataBytes, maxControlBytes, ingressBudget int64, attachTimeout, deliveryTimeout, transportTimeout time.Duration) *Hub {
	return &Hub{
		logger: logger, maxDataBytes: maxDataBytes, maxControlBytes: maxControlBytes,
		attachTimeout: attachTimeout, deliveryTimeout: deliveryTimeout,
		transportTimeout: transportTimeout, ingress: semaphore.NewWeighted(ingressBudget),
		sessions: make(map[string]*session),
	}
}

func (h *Hub) Stats() Stats {
	return Stats{Accepted: h.accepted.Load(), Active: h.activeConnections.Load(), Rejected: h.rejected.Load()}
}

func (h *Hub) ServeWS(response http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	serverID := strings.TrimSpace(query.Get("serverId"))
	role := query.Get("role")
	connectionID := strings.TrimSpace(query.Get("connectionId"))
	if query.Get("v") != "2" || serverID == "" || len(serverID) > 256 || (role != "server" && role != "client") {
		h.rejected.Add(1)
		http.Error(response, "invalid relay v2 attachment", http.StatusBadRequest)
		return
	}
	if role == "client" && connectionID != "" {
		h.rejected.Add(1)
		http.Error(response, "clients must not provide a connectionId", http.StatusBadRequest)
		return
	}
	if role == "server" && connectionID != "" && len(connectionID) > 128 {
		h.rejected.Add(1)
		http.Error(response, "invalid connectionId", http.StatusBadRequest)
		return
	}

	connection, err := websocket.Accept(response, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		h.rejected.Add(1)
		return
	}
	connection.SetReadLimit(h.maxDataBytes)
	h.accepted.Add(1)
	h.activeConnections.Add(1)
	defer h.activeConnections.Add(-1)

	queueLimit := h.maxDataBytes
	if role == "server" && connectionID == "" {
		queueLimit = controlQueueBytes
	}
	peer := newPeer(connection, h.deliveryTimeout, h.transportTimeout, queueLimit)
	defer peer.close(websocket.StatusNormalClosure, "relay connection closed")
	current := h.getSession(serverID)
	if role == "server" && connectionID == "" {
		h.serveControl(request.Context(), current, peer)
		h.cleanupSession(serverID, current)
		return
	}
	if role == "client" {
		connectionID, err = newConnectionID()
		if err != nil {
			h.rejected.Add(1)
			peer.close(websocket.StatusInternalError, "secure connection ID generation failed")
			return
		}
		h.serveClient(request.Context(), current, connectionID, peer)
		h.cleanupSession(serverID, current)
		return
	}
	h.serveServerData(request.Context(), current, connectionID, peer)
	h.cleanupSession(serverID, current)
}

func (h *Hub) getSession(serverID string) *session {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	if existing := h.sessions[serverID]; existing != nil {
		return existing
	}
	created := newSession()
	h.sessions[serverID] = created
	return created
}

func (h *Hub) cleanupSession(serverID string, current *session) {
	if !current.empty() {
		return
	}
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()
	if h.sessions[serverID] == current && current.empty() {
		delete(h.sessions, serverID)
	}
}

func (h *Hub) serveControl(ctx context.Context, current *session, peer *peer) {
	previous, ids := current.setControl(peer)
	if previous != nil {
		previous.close(closeReplaced, "control connection replaced")
	}
	if err := peer.sendJSON(ctx, map[string]any{"type": "sync", "connectionIds": ids}); err != nil {
		return
	}
	defer current.clearControl(peer)
	for {
		messageType, reader, err := peer.connection.Reader(ctx)
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			peer.close(closePolicy, "control messages must be text")
			return
		}
		read, err := io.Copy(io.Discard, io.LimitReader(reader, h.maxControlBytes+1))
		if err != nil {
			return
		}
		if read > h.maxControlBytes {
			peer.close(closePolicy, "control frame exceeds maximum size")
			return
		}
	}
}

func (h *Hub) serveClient(ctx context.Context, current *session, connectionID string, peer *peer) {
	current.addClient(connectionID, peer)
	defer current.removeClient(connectionID, peer)
	current.notify(map[string]any{"type": "connected", "connectionId": connectionID})
	defer current.notify(map[string]any{"type": "disconnected", "connectionId": connectionID})
	serverPeer, err := current.waitServer(ctx, connectionID, h.attachTimeout)
	if err != nil {
		peer.close(closeTryAgain, "server data socket did not attach")
		return
	}
	h.pipe(ctx, peer, serverPeer, true)
}

func (h *Hub) serveServerData(ctx context.Context, current *session, connectionID string, peer *peer) {
	clientPeer, err := current.addServerAndWaitClient(ctx, connectionID, peer, h.attachTimeout)
	if err != nil {
		current.removeServer(connectionID, peer)
		peer.close(closeTryAgain, "client socket not found")
		return
	}
	defer current.removeServer(connectionID, peer)
	h.pipe(ctx, peer, clientPeer, false)
}

func (h *Hub) pipe(ctx context.Context, source, destination *peer, validateFirstClientFrame bool) {
	first := validateFirstClientFrame
	for {
		messageType, reader, err := source.connection.Reader(ctx)
		if err != nil {
			destination.close(websocket.StatusGoingAway, "relay peer disconnected")
			return
		}
		frame, err := h.readFrame(ctx, messageType, reader)
		if err != nil {
			source.close(closePolicy, err.Error())
			destination.close(closePolicy, "relay peer sent an invalid frame")
			return
		}
		if first {
			first = false
			if frame.messageType != websocket.MessageText || !validE2EEHello(frame.data) {
				frame.release()
				source.close(closePolicy, "first client frame must be a valid e2ee_hello")
				destination.close(closePolicy, "client E2EE negotiation failed")
				return
			}
		}
		if !destination.enqueue(frame) {
			frame.release()
			source.close(closeTryAgain, "relay peer is backpressured")
			destination.close(closeTryAgain, "relay delivery queue exceeded")
			return
		}
	}
}

func (h *Hub) readFrame(ctx context.Context, messageType websocket.MessageType, reader io.Reader) (*frame, error) {
	// Reserve a whole maximum-sized frame before reading. Incremental weighted
	// acquisition can deadlock when several partial frames collectively exhaust
	// the budget and all wait for their final chunks.
	if err := h.ingress.Acquire(ctx, h.maxDataBytes); err != nil {
		return nil, err
	}
	buffer := make([]byte, 0, min(h.maxDataBytes, 64*1024))
	chunk := make([]byte, 32*1024)
	reserved := h.maxDataBytes
	release := func() {
		if reserved > 0 {
			h.ingress.Release(reserved)
			reserved = 0
		}
	}
	for {
		read, err := reader.Read(chunk)
		if read > 0 {
			if int64(len(buffer)+read) > h.maxDataBytes {
				release()
				return nil, errors.New("relay frame exceeds maximum size")
			}
			buffer = append(buffer, chunk[:read]...)
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			release()
			return nil, err
		}
	}
	return &frame{messageType: messageType, data: buffer, release: release}, nil
}

func validE2EEHello(data []byte) bool {
	var value struct {
		Type string `json:"type"`
		Key  string `json:"key"`
	}
	return json.Unmarshal(data, &value) == nil && value.Type == "e2ee_hello" && value.Key != "" && len(value.Key) <= 128
}

type frame struct {
	messageType websocket.MessageType
	data        []byte
	release     func()
}

type peer struct {
	connection *websocket.Conn
	delivery   time.Duration
	frames     chan *frame
	closed     chan struct{}
	once       sync.Once
	mu         sync.Mutex
	isClosed   bool
	queued     atomic.Int64
	queueLimit int64
}

func newPeer(connection *websocket.Conn, delivery, transportTimeout time.Duration, queueLimit int64) *peer {
	result := &peer{connection: connection, delivery: delivery, frames: make(chan *frame, writerQueueCapacity), closed: make(chan struct{}), queueLimit: queueLimit}
	go result.writeLoop()
	go result.heartbeat(transportTimeout)
	return result
}

func (p *peer) enqueue(item *frame) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.isClosed {
		return false
	}
	if p.queued.Add(int64(len(item.data))) > p.queueLimit {
		p.queued.Add(-int64(len(item.data)))
		return false
	}
	select {
	case p.frames <- item:
		return true
	case <-p.closed:
		p.queued.Add(-int64(len(item.data)))
		return false
	default:
		p.queued.Add(-int64(len(item.data)))
		return false
	}
}

func (p *peer) writeLoop() {
	defer p.releaseQueuedFrames()
	for {
		select {
		case item, ok := <-p.frames:
			if !ok {
				return
			}
			select {
			case <-p.closed:
				p.queued.Add(-int64(len(item.data)))
				item.release()
				continue
			default:
			}
			writeCtx, cancel := context.WithTimeout(context.Background(), p.delivery)
			err := p.connection.Write(writeCtx, item.messageType, item.data)
			cancel()
			p.queued.Add(-int64(len(item.data)))
			item.release()
			if err != nil {
				p.close(websocket.StatusGoingAway, "relay delivery failed")
				return
			}
		case <-p.closed:
			return
		}
	}
}

func (p *peer) releaseQueuedFrames() {
	for item := range p.frames {
		p.queued.Add(-int64(len(item.data)))
		item.release()
	}
}

func (p *peer) sendJSON(ctx context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	item := &frame{messageType: websocket.MessageText, data: data, release: func() {}}
	if !p.enqueue(item) {
		return errors.New("control delivery queue exceeded")
	}
	return nil
}

func (p *peer) heartbeat(timeout time.Duration) {
	interval := min(10*time.Second, timeout/2)
	if interval <= 0 {
		interval = time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			err := p.connection.Ping(ctx)
			cancel()
			if err != nil {
				p.close(websocket.StatusGoingAway, "relay heartbeat failed")
				return
			}
		case <-p.closed:
			return
		}
	}
}

func (p *peer) close(code websocket.StatusCode, reason string) {
	p.once.Do(func() {
		p.mu.Lock()
		p.isClosed = true
		close(p.closed)
		close(p.frames)
		p.mu.Unlock()
		go func() { _ = p.connection.Close(code, reason) }()
	})
}

type session struct {
	mu      sync.Mutex
	control *peer
	clients map[string]*peer
	servers map[string]*peer
	waiters map[string]chan struct{}
}

func newSession() *session {
	return &session{clients: make(map[string]*peer), servers: make(map[string]*peer), waiters: make(map[string]chan struct{})}
}

func (s *session) signal(id string) {
	if waiter := s.waiters[id]; waiter != nil {
		close(waiter)
		delete(s.waiters, id)
	}
}

func (s *session) waiter(id string) chan struct{} {
	if existing := s.waiters[id]; existing != nil {
		return existing
	}
	created := make(chan struct{})
	s.waiters[id] = created
	return created
}

func (s *session) setControl(value *peer) (*peer, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.control
	s.control = value
	ids := make([]string, 0, len(s.clients))
	for id := range s.clients {
		ids = append(ids, id)
	}
	return previous, ids
}

func (s *session) clearControl(value *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.control == value {
		s.control = nil
	}
}

func (s *session) notify(value any) {
	s.mu.Lock()
	control := s.control
	s.mu.Unlock()
	if control != nil {
		_ = control.sendJSON(context.Background(), value)
	}
}

func (s *session) addClient(id string, value *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if previous := s.clients[id]; previous != nil {
		previous.close(closeReplaced, "client connection replaced")
	}
	s.clients[id] = value
	s.signal(id)
}

func (s *session) removeClient(id string, value *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.clients[id] == value {
		delete(s.clients, id)
	}
}

func (s *session) waitServer(ctx context.Context, id string, timeout time.Duration) (*peer, error) {
	for {
		s.mu.Lock()
		if value := s.servers[id]; value != nil {
			s.mu.Unlock()
			return value, nil
		}
		waiter := s.waiter(id)
		s.mu.Unlock()
		waitCtx, cancel := context.WithTimeout(ctx, timeout)
		select {
		case <-waiter:
			cancel()
		case <-waitCtx.Done():
			cancel()
			return nil, waitCtx.Err()
		}
	}
}

func (s *session) addServerAndWaitClient(ctx context.Context, id string, value *peer, timeout time.Duration) (*peer, error) {
	s.mu.Lock()
	if previous := s.servers[id]; previous != nil {
		previous.close(closeReplaced, "server data connection replaced")
	}
	s.servers[id] = value
	s.signal(id)
	s.mu.Unlock()
	for {
		s.mu.Lock()
		if client := s.clients[id]; client != nil {
			s.mu.Unlock()
			return client, nil
		}
		waiter := s.waiter(id)
		s.mu.Unlock()
		waitCtx, cancel := context.WithTimeout(ctx, timeout)
		select {
		case <-waiter:
			cancel()
		case <-waitCtx.Done():
			cancel()
			return nil, waitCtx.Err()
		}
	}
}

func (s *session) removeServer(id string, value *peer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.servers[id] == value {
		delete(s.servers, id)
	}
}

func (s *session) empty() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.control == nil && len(s.clients) == 0 && len(s.servers) == 0
}

func newConnectionID() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return "conn_" + hex.EncodeToString(random), nil
}
