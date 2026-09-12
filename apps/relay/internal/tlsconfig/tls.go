package tlsconfig

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"os"
)

func Load(caFile, certFile, keyFile string) (*tls.Config, *tls.Config, error) {
	if caFile == "" && certFile == "" && keyFile == "" {
		return nil, nil, nil
	}
	certificate, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, nil, err
	}
	caBytes, err := os.ReadFile(caFile)
	if err != nil {
		return nil, nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, nil, errors.New("internal CA file contains no certificates")
	}
	server := &tls.Config{
		Certificates: []tls.Certificate{certificate},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		MinVersion:   tls.VersionTLS13,
	}
	client := &tls.Config{
		Certificates: []tls.Certificate{certificate},
		RootCAs:      pool,
		MinVersion:   tls.VersionTLS13,
	}
	return server, client, nil
}
