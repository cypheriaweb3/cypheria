//go:build windows

package host

import (
	"context"
	"net"

	"github.com/Microsoft/go-winio"
)

// DialEndpoint connects to Desktop's named pipe.
func DialEndpoint(ctx context.Context, endpoint string) (net.Conn, error) {
	return winio.DialPipeContext(ctx, endpoint)
}
