.PHONY: help setup check-setup build dev gui clean-gui dreamplace-wheel demo-gcd demo-soc demo-retrosoc docker-build docker-verify-all install-deps install-apt-deps install-tools

WHEEL_DIR := $(CURDIR)/ecc/dist/wheel/repaired
BUNDLE_TAR := bazel-bin/ecos/ecos_studio_bundle/ecos_studio_bundle.tar
BUNDLE_EXTRACT_DIR := /tmp/ecos-studio-bundle
APPIMAGE_MARKER := $(BUNDLE_EXTRACT_DIR)/.extracted

PDK_ROOT ?= ./pdk/icsprout55-pdk
ECC_CLI ?= ./eda/ecc\#cli
GCD_WS ?= ./ws/gcd
SOC_WS ?= ./ws/soc
RETROSOC_WS ?= ./ws/retrosoc

help:
	@echo "Targets:"
	@echo "  make install-deps - Install system dependencies and tools (Node.js, pnpm, Rust, Bazel, uv)"
	@echo "  make install-apt-deps - Install system build libraries only (apt packages, requires Ubuntu)"
	@echo "  make install-tools    - Install CLI tools only (Node.js, pnpm, Rust, Bazel, uv)"
	@echo "  make setup      - Init submodules and setup PDK"
	@echo "  make build      - Build ECOS Studio bundle (Bazel)"
	@echo "  make dev        - Setup development environment"
	@echo "  make gui        - Launch GUI (release version)"
	@echo "  make clean-gui  - Clean extracted GUI bundle"
	@echo "  make demo-gcd   - Run GCD demo"
	@echo "  make demo-soc   - Run SoC demo"
	@echo "  make demo-retrosoc - Run retroSoC demo"
	@echo "  make dreamplace-wheel - Build ecc-dreamplace wheel (auditwheel repair + smoke test)"
	@echo "  make docker-build  - Build Docker verification image"
	@echo "  make docker-verify-all - Run all demos in Docker"

install-apt-deps:
	@. /etc/os-release && \
	if [ "$$ID" != "ubuntu" ]; then \
	    echo "Error: install-deps requires Ubuntu (detected: $$ID)"; \
	    exit 1; \
	fi
	@echo "==> Installing apt dependencies..."
	sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
	    git curl ca-certificates build-essential pkg-config \
	    python3 python3-venv python3-pip python3-dev \
	    libgtk-3-dev libgtk-3-bin libwebkit2gtk-4.1-dev \
	    libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev \
	    libglib2.0-dev libglib2.0-bin librsvg2-dev \
	    cmake ninja-build tcl-dev \
	    libgflags-dev libgoogle-glog-dev libboost-all-dev libgtest-dev \
	    flex libeigen3-dev libunwind-dev libmetis-dev libgmp-dev bison \
	    libhwloc-dev libcurl4-openssl-dev libtbb-dev \
	    patchelf jq wget

install-tools:
	@echo "==> Installing Node.js (LTS)..."
	curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -
	sudo apt-get install -y nodejs && sudo rm -rf /var/lib/apt/lists/*
	@echo "==> Installing pnpm..."
	npm install -g --prefix ~/.local pnpm
	@echo "==> Installing Rust..."
	curl https://sh.rustup.rs -sSf | sh -s -- -y --no-modify-path
	@echo "==> Installing Bazel 8.5.0..."
	mkdir -p ~/.local/bin
	wget https://github.com/bazelbuild/bazel/releases/download/8.5.0/bazel-8.5.0-linux-x86_64 \
	    -O ~/.local/bin/bazel && chmod +x ~/.local/bin/bazel
	@echo "==> Installing uv..."
	curl -LsSf https://astral.sh/uv/install.sh | env INSTALLER_NO_MODIFY_PATH=1 sh
	@echo ""
	@echo "Done. Ensure the following are in your PATH (add to ~/.bashrc or ~/.zshrc):"
	@echo '  export PATH="$$HOME/.local/bin:$$HOME/.cargo/bin:$$PATH"'

install-deps: install-apt-deps install-tools

setup:
	@if command -v bazel >/dev/null 2>&1 && \
	    command -v uv >/dev/null 2>&1 && \
	    command -v pnpm >/dev/null 2>&1; then \
	    echo "bazel, uv, pnpm found on PATH -- skipping install-deps"; \
	    echo "Note: if build fails, run 'make install-apt-deps' for system libraries"; \
	    DEPS_SKIPPED=true; \
	else \
	    $(MAKE) install-deps && \
	    DEPS_SKIPPED=false; \
	fi && \
	git submodule update --init --recursive && \
	cd ecc && bazel run //:prepare_dev && \
	cd .. && \
	echo "timestamp=$$(date +%Y-%m-%dT%H:%M:%S%z)" > .setup-done && \
	echo "deps_skipped=$$DEPS_SKIPPED" >> .setup-done && \
	echo "bazel=$$(command -v bazel) ($$(bazel --version 2>/dev/null | head -1))" >> .setup-done && \
	echo "uv=$$(command -v uv) ($$(uv --version 2>/dev/null))" >> .setup-done && \
	echo "pnpm=$$(command -v pnpm) ($$(pnpm --version 2>/dev/null))" >> .setup-done

check-setup:
	@if [ ! -f .setup-done ]; then \
		echo "Error: Please run 'make setup' before this target."; \
		exit 1; \
	fi
	@if [ ! -d ecc/.venv ]; then \
		echo "Error: ecc/.venv not found. Please run 'make setup' to create it."; \
		exit 1; \
	fi

dev: check-setup
	@cd ecos/server && uv sync --frozen --all-groups --all-extras --python 3.11
	@cd ecos/gui && pnpm install
	bazel run //ecos:dev_symlinks

$(BUNDLE_TAR): check-setup
	cd ecc && bazel run //:build_dreamplace_wheel
	cd ecc && bazel run //:build_wheel
	@cd ecos/server && uv sync --frozen --all-groups --all-extras --python 3.11
	@ECC_WHL=$$(find $(WHEEL_DIR) -name 'ecc-0.1.0-*.whl' | head -1) && \
		DP_WHL=$$(find $(WHEEL_DIR) -name 'ecc_dreamplace-0.1.0-*.whl' | head -1) && \
		[ -n "$$ECC_WHL" ] || { echo "Error: ecc wheel not found in $(WHEEL_DIR)"; exit 1; } && \
		[ -n "$$DP_WHL" ] || { echo "Error: ecc_dreamplace wheel not found in $(WHEEL_DIR)"; exit 1; } && \
		cd ecos/server && uv pip install --reinstall --no-deps "$$ECC_WHL" "$$DP_WHL"
	PATH=$(CURDIR)/ecos/server/.venv/bin:$$PATH bazel build //:ecos_studio_bundle

$(APPIMAGE_MARKER): $(BUNDLE_TAR)
	@mkdir -p $(BUNDLE_EXTRACT_DIR)
	@tar -xf $(BUNDLE_TAR) -C $(BUNDLE_EXTRACT_DIR)
	@touch $(APPIMAGE_MARKER)

build: $(BUNDLE_TAR)

gui: $(APPIMAGE_MARKER)
	@APPIMAGE=$$(find $(BUNDLE_EXTRACT_DIR) -name "*.AppImage" | head -1); \
	chmod +x "$$APPIMAGE" && "$$APPIMAGE"

clean-gui:
	rm -rf $(BUNDLE_EXTRACT_DIR)

clean:
	bazel clean && cd ecc && bazel clean
	@rm -f .setup-done

dreamplace-wheel: check-setup
	cd ecc && bazel run //:build_dreamplace_wheel

demo-gcd: check-setup
	nix run $(ECC_CLI) -- --workspace $(GCD_WS) \
		--rtl ./eda/ecc/docs/examples/gcd/gcd.v \
		--design gcd --top gcd --clock clk \
		--pdk-root $(PDK_ROOT)

demo-retrosoc: check-setup
	@echo "Building retroSoC filelist..."
	@mkdir -p $(dir $(RETROSOC_WS)/retrosoc.f)
	@( \
		cat $(CURDIR)/ip/retroSoC/rtl/filelist/pdk_ics55.fl | sed "s|^/pdk/|$(abspath $(PDK_ROOT))/|"; \
		echo '+define+PDK_ICS55 +define+CORE_PICORV32 +define+IP_NONE +define+SYNTHESIS'; \
		for fl in sys_def.fl inc.fl ip.fl tech.fl core_picorv32.fl top.fl; do \
			cat $(CURDIR)/ip/retroSoC/rtl/mini/filelist/$$fl | \
			sed "s|^+incdir+|+incdir+$(CURDIR)/ip/retroSoC/rtl/mini/filelist/|" | \
			sed "s|^[^+#]|$(CURDIR)/ip/retroSoC/rtl/mini/filelist/&|"; \
		done \
	) > $(RETROSOC_WS)/retrosoc.f
	nix run $(ECC_CLI) -- --workspace $(RETROSOC_WS) \
		--rtl $(RETROSOC_WS)/retrosoc.f \
		--design retrosoc_asic --top retrosoc_asic --clock extclk_i_pad \
		--pdk-root $(PDK_ROOT)
