.PHONY: help setup build dev gui clean-gui demo-gcd demo-soc demo-retrosoc docker-build docker-verify-all

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
	@echo "  make setup      - Init submodules and setup PDK"
	@echo "  make build      - Build ECOS Studio bundle (Bazel)"
	@echo "  make dev        - Setup development environment"
	@echo "  make gui        - Launch GUI (release version)"
	@echo "  make clean-gui  - Clean extracted GUI bundle"
	@echo "  make demo-gcd   - Run GCD demo"
	@echo "  make demo-soc   - Run SoC demo"
	@echo "  make demo-retrosoc - Run retroSoC demo"
	@echo "  make docker-build  - Build Docker verification image"
	@echo "  make docker-verify-all - Run all demos in Docker"

setup:
	git submodule update --init --recursive
	$(MAKE) -C pdk/icsprout55-pdk unzip
	cd ecc && SKIP_VENV=1 bazel run //:prepare_dev

build:
	bazel build //:ecos_studio_bundle

dev:
	cd ecos/server && uv sync --all-groups --python 3.11
	cd ecos/gui && pnpm install

$(BUNDLE_TAR):
	bazel build //:ecos_studio_bundle

$(APPIMAGE_MARKER): $(BUNDLE_TAR)
	@mkdir -p $(BUNDLE_EXTRACT_DIR)
	@tar -xf $(BUNDLE_TAR) -C $(BUNDLE_EXTRACT_DIR)
	@touch $(APPIMAGE_MARKER)

gui: $(APPIMAGE_MARKER)
	@APPIMAGE=$$(find $(BUNDLE_EXTRACT_DIR) -name "*.AppImage" | head -1); \
	chmod +x "$$APPIMAGE" && "$$APPIMAGE"

clean-gui:
	rm -rf $(BUNDLE_EXTRACT_DIR)

demo-gcd:
	nix run $(ECC_CLI) -- --workspace $(GCD_WS) \
		--rtl ./eda/ecc/docs/examples/gcd/gcd.v \
		--design gcd --top gcd --clock clk \
		--pdk-root $(PDK_ROOT)

demo-soc:
	nix run $(ECC_CLI) -- --workspace $(SOC_WS) \
		--rtl ./ip/SoCExamples/soc/filelist.f \
		--design ysyxSoCASIC --top ysyxSoCASIC --clock clock \
		--pdk-root $(PDK_ROOT) --freq 200

demo-retrosoc:
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

