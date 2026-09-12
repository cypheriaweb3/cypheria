package coordinator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
)

const Prefix = "/cypheria-relay/v1"

var ErrNoWorkers = errors.New("no healthy relay workers are registered")

type Node struct {
	ID       string `json:"id"`
	Internal string `json:"internal"`
	LeaseID  int64  `json:"leaseId,omitempty"`
}

type Coordinator interface {
	Close() error
	Healthy() <-chan struct{}
	Route(context.Context, string) (Node, error)
}

func ServerKey(serverID string) string {
	digest := sha256.Sum256([]byte(serverID))
	return hex.EncodeToString(digest[:])
}

func Rendezvous(key string, nodes []Node) (Node, error) {
	if len(nodes) == 0 {
		return Node{}, ErrNoWorkers
	}
	type scored struct {
		node  Node
		score [32]byte
	}
	values := make([]scored, 0, len(nodes))
	for _, node := range nodes {
		values = append(values, scored{node: node, score: sha256.Sum256([]byte(key + "\x00" + node.ID))})
	}
	sort.Slice(values, func(i, j int) bool {
		return string(values[i].score[:]) > string(values[j].score[:])
	})
	return values[0].node, nil
}
