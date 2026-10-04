package assets

import (
	"embed"
)

// Files holds the bundled Node runtime. `pnpm build:js` generates the
// JavaScript from src/ into files/ before the Go binary is built.
//
//go:embed files/*
var Files embed.FS
