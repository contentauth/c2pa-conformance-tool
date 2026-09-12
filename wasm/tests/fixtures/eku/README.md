# EKU trust_config regression fixtures

Test-only certificates and a tiny base image, used by
`eku_trust_config_tests` in `wasm/src/lib.rs` to verify that c2pa-rs still
honors `trust.trust_config` (the EKU allow-list) the way it did when PR #60
fixed issue #59. These keys have no value outside this test — do not reuse
them for anything else.

- `root_cert.pem` / (root private key, not committed) — self-signed test CA.
- `leaf_cert.pem` / `leaf_key.pem` — leaf certificate chained to the root,
  whose Extended Key Usage is **only** the C2PA claim-signing OID
  (`1.3.6.1.4.1.62558.2.1`) — deliberately not `id-kp-emailProtection`, which
  c2pa-rs accepts unconditionally regardless of `trust_config` and so
  wouldn't exercise this regression at all.
- `base.jpg` — a tiny 2x2 unsigned JPEG signed at test time with the leaf key.

## Regenerating

```bash
# Root CA
openssl ecparam -name prime256v1 -genkey -noout -out root_key.pem
openssl req -x509 -new -key root_key.pem -sha256 -days 7300 \
  -subj "/C=US/ST=CA/O=C2PA Conformance Tool Test/OU=FOR TESTING ONLY/CN=Conformulator Test Root CA" \
  -addext "basicConstraints=critical,CA:true" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out root_cert.pem

# Leaf, signed by the root, EKU = C2PA claim signing only
openssl ecparam -name prime256v1 -genkey -noout -out leaf_key_sec1.pem
openssl pkcs8 -topk8 -nocrypt -in leaf_key_sec1.pem -out leaf_key.pem
openssl req -new -key leaf_key.pem \
  -subj "/C=US/ST=CA/O=C2PA Conformance Tool Test/OU=FOR TESTING ONLY/CN=Conformulator Test Signer" \
  -out leaf_csr.pem
cat > leaf_ext.cnf << 'EOF'
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,1.3.6.1.4.1.62558.2.1
EOF
openssl x509 -req -in leaf_csr.pem -CA root_cert.pem -CAkey root_key.pem -CAcreateserial \
  -days 7300 -sha256 -extfile leaf_ext.cnf -out leaf_cert.pem
```

`base.jpg` was produced with `sips -s format jpeg -z 2 2 --out base.jpg <any source image>`.
