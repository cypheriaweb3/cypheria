package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/cypheriaweb3/cypheria/apps/node-repl/internal/assets"
)

// Runtime contains paths to unpacked runtime assets.
type Runtime struct {
	Dir        string
	KernelPath string
}

// Ensure extracts the embedded JavaScript runtime files to a cache directory
// and returns the Runtime paths.
func Ensure() (*Runtime, error) {
	// Compute hash of embedded files to determine cache dir
	h := sha256.New()
	entries, err := fs.ReadDir(assets.Files, "files")
	if err != nil {
		return nil, fmt.Errorf("read embedded assets: %w", err)
	}
	if _, err := fs.Stat(assets.Files, "files/kernel.js"); err != nil {
		return nil, fmt.Errorf("embedded node_repl kernel is missing; run `pnpm --filter @cypheria/node-repl build:js` before building: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := assets.Files.ReadFile(filepath.Join("files", entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("read embedded file %s: %w", entry.Name(), err)
		}
		h.Write([]byte(entry.Name()))
		h.Write(data)
	}
	hashStr := hex.EncodeToString(h.Sum(nil))[:16]

	targetDir := filepath.Join(os.TempDir(), fmt.Sprintf("cypheria-node-repl-%s", hashStr))
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("create runtime dir: %w", err)
	}

	// Extract files if missing or incomplete
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		destPath := filepath.Join(targetDir, entry.Name())
		if _, err := os.Stat(destPath); err == nil {
			continue // Already extracted
		}

		src, err := assets.Files.Open(filepath.Join("files", entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("open embedded file %s: %w", entry.Name(), err)
		}
		defer src.Close()

		dst, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			return nil, fmt.Errorf("create destination file %s: %w", destPath, err)
		}

		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			return nil, fmt.Errorf("copy to %s: %w", destPath, err)
		}
		dst.Close()
	}

	kernelPath := filepath.Join(targetDir, "kernel.js")
	return &Runtime{
		Dir:        targetDir,
		KernelPath: kernelPath,
	}, nil
}
