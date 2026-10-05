package host

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"
)

// MaxToBrowser is the largest message Chrome accepts from a native host.
const MaxToBrowser = 1024 * 1024

// MaxFromPeer bounds messages read from Chrome or Desktop; Chrome sends at most 64 MiB.
const MaxFromPeer = 64 * 1024 * 1024

// ErrTooLarge reports a frame above the reader's or writer's limit.
var ErrTooLarge = errors.New("message too large")

// ReadFrame reads one message framed as Chrome native messaging frames it: a 32-bit
// little-endian length, then that many bytes of UTF-8 JSON. Desktop's socket uses the same.
func ReadFrame(r io.Reader, limit int) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}
	size := binary.LittleEndian.Uint32(header[:])
	if int64(size) > int64(limit) {
		return nil, fmt.Errorf("%w: %d bytes", ErrTooLarge, size)
	}
	body := make([]byte, size)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}

// FrameWriter writes frames from several goroutines without interleaving them.
type FrameWriter struct {
	mu    sync.Mutex
	w     io.Writer
	limit int
}

// NewFrameWriter returns a writer that refuses frames above limit.
func NewFrameWriter(w io.Writer, limit int) *FrameWriter {
	return &FrameWriter{w: w, limit: limit}
}

// Write sends one frame.
func (f *FrameWriter) Write(body []byte) error {
	if len(body) > f.limit {
		return fmt.Errorf("%w: %d bytes", ErrTooLarge, len(body))
	}
	frame := make([]byte, 4+len(body))
	binary.LittleEndian.PutUint32(frame, uint32(len(body)))
	copy(frame[4:], body)
	f.mu.Lock()
	defer f.mu.Unlock()
	_, err := f.w.Write(frame)
	return err
}
