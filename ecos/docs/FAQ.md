# ECOS Studio FAQ

## General

**Q: What is ECOS Studio?**

ECOS Studio is an integrated RTL-to-GDS chip design solution that bundles open-source EDA tools (Yosys, ECC-Tools, ECC-Dreamplace, KLayout), IP libraries, and PDKs into a unified desktop application.

> [!NOTE]
> IP integration and additional tool support are still in progress. Stay tuned for updates.

**Q: Which platforms are supported?**

Currently only Linux x86_64 with glibc >= 2.34. **Ubuntu 22.04 or later is recommended.** Other Linux distributions are not officially maintained — if you encounter issues, you may need to resolve them on your own.

**Recommended hardware:** 8 CPU cores, 32 GB RAM. If you experience performance issues on lower-spec hardware, feedback and issue reports are welcome.

**Q: Which PDKs are supported?**

Currently only [ICsprout 55nm Open PDK](https://github.com/openecos-projects/icsprout55-pdk). Custom PDK import is not yet available.

**Q: What RTL formats are supported?**

Verilog (`.v`), SystemVerilog (`.sv`) — only the synthesizable subset is supported. We use [yosys-slang](https://github.com/povik/yosys-slang) plugins for verilog frontend.

**Q: Is ECOS Studio free?**

Yes, ECOS Studio is open-source software. See the [LICENSE](../../LICENSE) file for details.

## Installation & Setup

**Q: How do I install ECOS Studio?**

Download the AppImage from the [Releases](https://github.com/openecos-projects/ecos-studio/releases/latest) page, then run:

> [AppImage](https://en.wikipedia.org/wiki/AppImage) is a portable Linux application format — download a single file, make it executable, and run it without installation. ECOS Studio is a GUI application and requires a desktop environment (X11 or Wayland) to run — it cannot be launched from a headless environment.

```bash
chmod +x ECOS-Studio_*.AppImage
./ECOS-Studio_*.AppImage
```

## Usage

See the [User Guide](user-guide.md) for detailed instructions on creating workspaces, running the RTL-to-GDS flow, and viewing results.

## Troubleshooting

**Q: AppImage fails to launch on a virtual machine (GL / GVFS / ATK errors)**

Errors such as `undefined symbol: g_task_set_static_name` or `Failed to load module: /usr/lib/x86_64-linux-gnu/gio/modules/libgvfsdbus.so`.

Run with software rendering and suppress GVFS module errors:

```bash
LIBGL_ALWAYS_SOFTWARE=1 GIO_EXTRA_MODULES="" ./ECOS-Studio_*.AppImage
```

See [#49](https://github.com/openecos-projects/ecos-studio/issues/49) for details.

**Q: PDK validation fails with "PDK root directory not found" or missing files**

The PDK directory is incomplete or empty. This typically happens when icsprout55-pdk are not fully initialized. Re-run `git checkout main && make unzip` in icsprout55-pdk directory or see [#46](https://github.com/openecos-projects/ecos-studio/issues/46) for detailed diagnosis and resolution.

**Q: The CTS stage hangs — log file keeps growing or the flow is stuck with no progress**

The CTS engine can enter an infinite loop under certain design configurations. This has been fixed in [v0.1.0-alpha.4](https://github.com/openecos-projects/ecos-studio/releases/tag/v0.1.0-alpha.4) and later. See [#47](https://github.com/openecos-projects/ecos-studio/issues/47) for details.

**Q: Yosys synthesis step times out**

Large or complex designs may exceed the 10-minute synthesis timeout. Use a smaller design or wait for future releases with configurable timeout support. See [#48](https://github.com/openecos-projects/ecos-studio/issues/48) for details.

**Q: DreamPlace placement fails with "overflow is significant" or HPWL is infinity/nan**

The core utilization or target density is too high for the placer to converge. Try reducing Core Utilization and Target Density, increasing Cell Padding, or enabling the Routability Opt Flag in the Configuration page. See [#50](https://github.com/openecos-projects/ecos-studio/issues/50) for details.
