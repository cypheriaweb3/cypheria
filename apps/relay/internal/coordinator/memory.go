package coordinator

import "context"

type Memory struct {
	node    Node
	healthy chan struct{}
}

func NewMemory(node Node) *Memory {
	return &Memory{node: node, healthy: make(chan struct{})}
}

func (m *Memory) Route(context.Context, string) (Node, error) { return m.node, nil }
func (m *Memory) Healthy() <-chan struct{}                    { return m.healthy }
func (m *Memory) Close() error                                { return nil }
