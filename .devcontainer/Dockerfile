FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04@sha256:d94c97dd9cacf183d0a6fd12a8e87b526e9e928307674ae9c94139139c0c6eae AS base
SHELL ["/bin/bash", "-lc"]

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    git \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    python3 \
    python3-venv \
    python3-pip \
    python3-dev \
    libgtk-3-dev \
    libgtk-3-bin \
    libwebkit2gtk-4.1-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libgdk-pixbuf-2.0-dev \
    libglib2.0-dev \
    libglib2.0-bin \
    librsvg2-dev \
    cmake \
    ninja-build \
    tcl-dev \
    libgflags-dev \
    libgoogle-glog-dev \
    libboost-all-dev \
    libgtest-dev \
    flex \
    libeigen3-dev \
    libunwind-dev \
    libmetis-dev \
    libgmp-dev \
    bison \
    libhwloc-dev \
    libcurl4-openssl-dev \
    libtbb-dev \
    patchelf \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS) and pnpm.
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

# Install Rust (for Tauri).
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y

# Install Bazel
RUN wget https://github.com/bazelbuild/bazel/releases/download/8.5.0/bazel-8.5.0-linux-x86_64 -O /usr/local/bin/bazel \
    && chmod +x /usr/local/bin/bazel

# Install uv (Python package manager used by ecos/server).
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv

ENV PATH="/root/.cargo/bin:${PATH}"
ENV PKG_CONFIG_PATH="/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig"

# Configure git to use GitHub proxy for all operations
# RUN git config --global url."https://ghfast.top/https://github.com/".insteadOf "https://github.com/"

FROM base AS devcontainer

FROM base AS runtime

WORKDIR /workspace
COPY . /workspace

# Init submodules (ip/, eda/, pdk/)
RUN git submodule update --init --recursive || true

# Install ecos/server dependencies (includes ecc wheel)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=cache,target=/root/.cache/pip \
    --mount=type=cache,target=/root/.cargo/registry \
    --mount=type=cache,target=/root/.cargo/git \
    cd ecos/server && rm -rf .venv \
    && uv sync --frozen --all-groups --python 3.11

# Install GUI frontend dependencies
RUN cd ecos/gui && pnpm install --frozen-lockfile

ENV VIRTUAL_ENV="/workspace/ecos/server/.venv"
ENV PATH="/workspace/ecos/server/.venv/bin:${PATH}"
ENV CHIPCOMPILER_OSS_CAD_DIR="/workspace/eda/oss-cad-suite"
ENV CHIPCOMPILER_ICS55_PDK_ROOT="/workspace/pdk/icsprout55-pdk"
RUN echo 'if [ -f /workspace/ecos/server/.venv/bin/activate ]; then source /workspace/ecos/server/.venv/bin/activate; fi' >> /root/.bashrc


# Build commands:
# docker build --target runtime -f .devcontainer/Dockerfile -t ecos-studio:latest .
# docker build --target devcontainer -f .devcontainer/Dockerfile -t ecos-studio-dev .
