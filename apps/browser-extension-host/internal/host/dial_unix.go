//go:build !windows

package host

import (
	"context"
	"net"
)

// DialEndpoint connects to Desktop's Unix socket.
func DialEndpoint(ctx context.Context, endpoint string) (net.Conn, error) {
	var dialer net.Dialer
	return dialer.DialContext(ctx, "unix", endpoint)
}
