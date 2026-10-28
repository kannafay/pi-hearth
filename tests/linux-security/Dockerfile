ARG RUST_IMAGE=rust:1.99.1-bookworm
FROM ${RUST_IMAGE}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
       librsvg2-dev pkg-config dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

ENV CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ENV CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
