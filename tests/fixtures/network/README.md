The certificate and key in this directory are public, test-only fixtures for
local HTTP/HTTPS/SOCKS5 proxy tests. They do not authenticate any real service.
Only isolated test subprocesses trust this certificate via `NODE_EXTRA_CA_CERTS`.
