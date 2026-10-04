package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/mcp"
	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/supervisor"
)

func main() {
	var disableSandbox bool
	flag.BoolVar(&disableSandbox, "disable-sandbox", false, "Start the Node kernel directly even when CODEX_CLI_PATH is set")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Run the node_repl MCP stdio server.\n\nUsage: node_repl [OPTIONS]\n\nOptions:\n")
		flag.PrintDefaults()
	}

	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	sup, err := supervisor.New(supervisor.Options{
		DisableSandbox: disableSandbox,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize supervisor: %v\n", err)
		os.Exit(1)
	}

	overrides, err := mcp.ToolOverridesFromEnv()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	srv := mcp.NewServer(sup, overrides)
	if err := srv.Serve(ctx, os.Stdin, os.Stdout); err != nil && err != context.Canceled {
		fmt.Fprintf(os.Stderr, "server exited with error: %v\n", err)
		os.Exit(1)
	}
}
