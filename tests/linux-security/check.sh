#!/bin/sh
set -eu

# Build in disposable Linux storage, leaving the mounted Windows checkout untouched.
verification_project=$(mktemp -d)
mkdir -p /verification/cargo /verification/target
export CARGO_HOME=/verification/cargo
export CARGO_TARGET_DIR=/verification/target
if [ -d /registry-seed/cache ]; then
    mkdir -p "$CARGO_HOME/registry"
    cp -an /registry-seed/cache /registry-seed/index "$CARGO_HOME/registry/"
fi
tar -C /workspace --exclude=src-tauri/target --exclude=src-tauri/gen \
    -cf - src-tauri runtime | tar -C "$verification_project" -xf -
cd "$verification_project/src-tauri"

cargo check --locked --lib

# Include the patched packages as test members only in this disposable copy.
# Their upstream dev-dependencies are intentionally absent from the app lockfile.
cat >> Cargo.toml <<'EOF'

[workspace]
members = [
    "vendor/glib-0.18.5",
    "vendor/glib-macros-0.18.5",
    "vendor/gtk3-macros-0.18.2",
    "vendor/tauri-plugin-single-instance-2.5.4",
]
EOF

# This regression must run with optimizations, where the original UB is reproducible.
cargo test --release -p glib --lib variant_iter
cargo test -p glib-macros -p gtk3-macros --lib
# Exercise primary/secondary forwarding, rejection, and missing/invalid session buses.
dbus-run-session -- cargo test -p tauri-plugin-single-instance --test dbus_errors -- --ignored --nocapture
