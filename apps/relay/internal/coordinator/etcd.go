package coordinator

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
)

const (
	nodeLeaseTTLSeconds  = 15
	ownerLeaseTTLSeconds = 30
	ownerRenewEvery      = 10 * time.Second
	selfFenceAfter       = 10 * time.Second
)

type Etcd struct {
	client      *clientv3.Client
	node        *Node
	nodeLeaseID clientv3.LeaseID
	healthy     chan struct{}
	cancel      context.CancelFunc
	once        sync.Once
}

func NewEtcd(ctx context.Context, endpoints []string, node *Node, tlsConfig *tls.Config) (*Etcd, error) {
	client, err := clientv3.New(clientv3.Config{
		Endpoints:   endpoints,
		DialTimeout: 5 * time.Second,
		TLS:         tlsConfig,
	})
	if err != nil {
		return nil, err
	}
	child, cancel := context.WithCancel(ctx)
	result := &Etcd{client: client, node: node, healthy: make(chan struct{}), cancel: cancel}
	if err := result.register(child); err != nil {
		cancel()
		_ = client.Close()
		return nil, err
	}
	return result, nil
}

func (e *Etcd) register(ctx context.Context) error {
	lease, err := e.client.Grant(ctx, nodeLeaseTTLSeconds)
	if err != nil {
		return fmt.Errorf("grant node lease: %w", err)
	}
	e.nodeLeaseID = lease.ID
	if e.node != nil {
		e.node.LeaseID = int64(lease.ID)
		encoded, err := json.Marshal(e.node)
		if err != nil {
			return err
		}
		if _, err := e.client.Put(ctx, Prefix+"/nodes/"+e.node.ID, string(encoded), clientv3.WithLease(lease.ID)); err != nil {
			return fmt.Errorf("register node: %w", err)
		}
	}
	keepAlive, err := e.client.KeepAlive(ctx, lease.ID)
	if err != nil {
		return fmt.Errorf("keep node lease alive: %w", err)
	}
	go e.monitorKeepAlive(ctx, keepAlive)
	return nil
}

func (e *Etcd) monitorKeepAlive(ctx context.Context, keepAlive <-chan *clientv3.LeaseKeepAliveResponse) {
	timer := time.NewTimer(selfFenceAfter)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case response, ok := <-keepAlive:
			if !ok || response == nil {
				e.fence()
				return
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(selfFenceAfter)
		case <-timer.C:
			e.fence()
			return
		}
	}
}

func (e *Etcd) fence() { e.once.Do(func() { close(e.healthy) }) }

func (e *Etcd) Route(ctx context.Context, serverKey string) (Node, error) {
	return e.route(ctx, serverKey, 3)
}

func (e *Etcd) route(ctx context.Context, serverKey string, retries int) (Node, error) {
	ownerKey := Prefix + "/owners/" + serverKey
	owner, err := e.client.Get(ctx, ownerKey)
	if err != nil {
		return Node{}, err
	}
	if len(owner.Kvs) > 0 {
		item := owner.Kvs[0]
		node, err := e.readNode(ctx, string(item.Value))
		if err == nil {
			e.maintainOwner(ctx, clientv3.LeaseID(item.Lease))
			return node, nil
		}
		if !errors.Is(err, ErrNoWorkers) || retries == 0 {
			return Node{}, err
		}
		if err := e.deleteStaleOwner(ctx, ownerKey, item.ModRevision); err != nil {
			return Node{}, err
		}
		return e.route(ctx, serverKey, retries-1)
	}

	nodesResponse, err := e.client.Get(ctx, Prefix+"/nodes/", clientv3.WithPrefix())
	if err != nil {
		return Node{}, err
	}
	nodes := make([]Node, 0, len(nodesResponse.Kvs))
	for _, item := range nodesResponse.Kvs {
		var node Node
		if json.Unmarshal(item.Value, &node) == nil && node.ID != "" && node.Internal != "" {
			nodes = append(nodes, node)
		}
	}
	selected, err := Rendezvous(serverKey, nodes)
	if err != nil {
		return Node{}, err
	}
	ownerLease, err := e.client.Grant(ctx, ownerLeaseTTLSeconds)
	if err != nil {
		return Node{}, err
	}
	txn, err := e.client.Txn(ctx).
		If(clientv3.Compare(clientv3.CreateRevision(ownerKey), "=", 0)).
		Then(clientv3.OpPut(ownerKey, selected.ID, clientv3.WithLease(ownerLease.ID))).
		Else(clientv3.OpGet(ownerKey)).Commit()
	if err != nil {
		return Node{}, err
	}
	if txn.Succeeded {
		e.maintainOwner(ctx, ownerLease.ID)
		return selected, nil
	}
	_, _ = e.client.Revoke(context.WithoutCancel(ctx), ownerLease.ID)
	if len(txn.Responses) == 0 || len(txn.Responses[0].GetResponseRange().Kvs) == 0 {
		return Node{}, ErrNoWorkers
	}
	winner := txn.Responses[0].GetResponseRange().Kvs[0]
	node, err := e.readNode(ctx, string(winner.Value))
	if err == nil {
		e.maintainOwner(ctx, clientv3.LeaseID(winner.Lease))
		return node, nil
	}
	if !errors.Is(err, ErrNoWorkers) || retries == 0 {
		return Node{}, err
	}
	if err := e.deleteStaleOwner(ctx, ownerKey, winner.ModRevision); err != nil {
		return Node{}, err
	}
	return e.route(ctx, serverKey, retries-1)
}

func (e *Etcd) deleteStaleOwner(ctx context.Context, ownerKey string, revision int64) error {
	_, err := e.client.Txn(ctx).
		If(clientv3.Compare(clientv3.ModRevision(ownerKey), "=", revision)).
		Then(clientv3.OpDelete(ownerKey)).
		Commit()
	return err
}

func (e *Etcd) maintainOwner(ctx context.Context, leaseID clientv3.LeaseID) {
	if leaseID == 0 {
		return
	}
	go func() {
		ticker := time.NewTicker(ownerRenewEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := e.client.KeepAliveOnce(ctx, leaseID); err != nil {
					return
				}
			}
		}
	}()
}

func (e *Etcd) readNode(ctx context.Context, id string) (Node, error) {
	response, err := e.client.Get(ctx, Prefix+"/nodes/"+strings.TrimSpace(id))
	if err != nil {
		return Node{}, err
	}
	if len(response.Kvs) == 0 {
		return Node{}, ErrNoWorkers
	}
	var node Node
	if err := json.Unmarshal(response.Kvs[0].Value, &node); err != nil {
		return Node{}, err
	}
	return node, nil
}

func (e *Etcd) Healthy() <-chan struct{} { return e.healthy }

func (e *Etcd) Close() error {
	e.cancel()
	revokeCtx, revokeCancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer revokeCancel()
	var revokeErr error
	if e.nodeLeaseID != 0 {
		if _, err := e.client.Revoke(revokeCtx, e.nodeLeaseID); err != nil {
			revokeErr = fmt.Errorf("revoke node lease: %w", err)
		}
	}
	e.fence()
	return errors.Join(revokeErr, e.client.Close())
}
