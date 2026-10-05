// Command cypheria-browser-host is the native messaging host of the Cypheria browser extension.
// Chrome starts it with the caller's origin and speaks native messaging on its standard input
// and output; it relays those messages to Cypheria Desktop.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/cypheriaweb3/cypheria/apps/browser-extension-host/internal/host"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "0.1.0"

// allowedIDs is set at build time to add store IDs; the development ID is always allowed.
var allowedIDs = "jahdmaekjcmhofodmnpdhegangbeoaeh"

func main() {
	origin := ""
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "chrome-extension://") {
			origin = arg
			break
		}
	}
	home, err := host.HomeFromExecutable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "cypheria-browser-host:", err)
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	err = host.Run(ctx, host.Options{
		AllowedIDs: strings.Split(allowedIDs, ","),
		BrowserIn:  os.Stdin,
		BrowserOut: os.Stdout,
		Home:       home,
		Origin:     origin,
		Version:    version,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "cypheria-browser-host:", err)
		os.Exit(1)
	}
}
