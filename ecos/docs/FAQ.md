# ECOS Studio FAQ

## General

**Q: What is ECOS Studio?**

ECOS Studio is a desktop environment for project and workspace management,
RTL-to-GDS execution through ECC, native layout viewing, and Agent-assisted
workflows. The desktop package includes the Agent and Chip Viewer; it downloads
its pinned ECC runtime on first use. Resource Manager installs or imports the
additional EDA tools, PDKs, and templates required by the selected flow.

> [!NOTE]
> IP integration and additional tool support are still in progress. Stay tuned for updates.

**Q: Which platforms are supported?**

Currently only Linux x86_64 with glibc >= 2.34. **Ubuntu 22.04 or later is recommended.** Other Linux distributions are not officially maintained — if you encounter issues, you may need to resolve them on your own.

**Recommended hardware:** 8 CPU cores, 32 GB RAM. If you experience performance issues on lower-spec hardware, feedback and issue reports are welcome.

**Q: Which PDKs are supported?**

The validated backend integration currently targets
[ICsprout 55nm Open PDK](https://github.com/openecos-projects/icsprout55-pdk).
Use Resource Manager to install it or **Import Local** to register an existing
local installation; imported PDK files stay in place. A PDK must pass the
workspace wizard’s eligibility checks. **Manual Config** selects technology
LEF, cell LEF, and Liberty resources; it does not make an arbitrary PDK family
supported automatically.

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

The AppImage runtime requires FUSE 2 (`libfuse2`), which most distributions ship by default. On FUSE-3-only systems such as Ubuntu 24.04, see the Troubleshooting section below if the app fails to launch.

## Usage

See the [User Guide](user-guide.md) for detailed instructions on creating workspaces, running the RTL-to-GDS flow, and viewing results.

## Troubleshooting

**Q: AppImage fails to launch with `dlopen(): error loading libfuse.so.2`**

The AppImage runtime requires FUSE 2. On Ubuntu 24.04, install it with
`sudo apt install libfuse2t64`; Ubuntu 22.04 uses `sudo apt install libfuse2`.
Other distributions may use a different package name.

You can also run the AppImage without FUSE by extracting and running it directly:

```bash
./ECOS-Studio_*.AppImage --appimage-extract-and-run
```

See [#173](https://github.com/openecos-projects/ecos-studio/issues/173) for details.

**Q: AppImage fails to launch on a virtual machine (GL / GVFS / ATK errors)**

Errors such as `undefined symbol: g_task_set_static_name` or `Failed to load module: /usr/lib/x86_64-linux-gnu/gio/modules/libgvfsdbus.so`.

Run with software rendering and suppress GVFS module errors:

```bash
LIBGL_ALWAYS_SOFTWARE=1 GIO_EXTRA_MODULES="" ./ECOS-Studio_*.AppImage
```

See [#49](https://github.com/openecos-projects/ecos-studio/issues/49) for details.

**Q: PDK validation fails with "PDK root directory not found" or missing files**

The PDK directory is incomplete, empty, or no longer at its registered path.
For an ICsprout55 source checkout, follow its README to populate the required
files (`make unzip` from the PDK directory). Then use **Validate** in Resource
Manager or **Re-check PDK** in the workspace wizard. See
[#46](https://github.com/openecos-projects/ecos-studio/issues/46) for an earlier
missing-file diagnosis.

**Q: The CTS stage hangs — log file keeps growing or the flow is stuck with no progress**

The CTS engine can enter an infinite loop under certain design configurations. This has been fixed in [v0.1.0-alpha.4](https://github.com/openecos-projects/ecos-studio/releases/tag/v0.1.0-alpha.4) and later. See [#47](https://github.com/openecos-projects/ecos-studio/issues/47) for details.

**Q: Yosys synthesis step times out**

The current synthesis runner has no fixed ten-minute execution timeout. Open
**Log** on the Synthesis card and check the last tool message, available memory,
and the selected Yosys/Slang installation. If a run fails or stops making
progress, include the log and **Help → About → Copy version info** in an issue.
[#48](https://github.com/openecos-projects/ecos-studio/issues/48) describes an
older timeout issue.

**Q: DreamPlace placement fails with "overflow is significant" or HPWL is infinity/nan**

The core utilization or target density is too high for the placer to converge. Try reducing Core Utilization and Target Density, increasing Cell Padding, or enabling routability optimization in **Edit → Config → Place**. See [#50](https://github.com/openecos-projects/ecos-studio/issues/50) for details.

**Q: How do I enable Electron host diagnostic logs?**

By default, the GUI host prints warnings and errors only. Launch the AppImage
from a terminal with `ECOS_ELECTRON_LOG_LEVEL` to enable more detailed
Electron-side diagnostics:

```bash
# GUI lifecycle diagnostics
ECOS_ELECTRON_LOG_LEVEL=info ./ECOS-Studio_*.AppImage

# More detailed desktop runtime diagnostics
ECOS_ELECTRON_LOG_LEVEL=debug ./ECOS-Studio_*.AppImage
```

Available levels: `debug`, `info`, `warning` (default), `error`, `critical`.

**Q: How does the desktop app run workspace and flow actions?**

Project and workspace commands use the ECC CLI through the Electron desktop
bridge. Backend flow runs have their own ECC operation identity and persisted
workspace state. Studio observes operation updates and workspace files so runs
started in the built-in terminal also update the dashboard and Project
Management. Logs are displayed separately from the verified workspace state.

**Q: Does Update Workspace keep completed results?**

Backend **File → Update Workspace** recreates the workspace from project
settings. It retains workspace parameter overrides, but replaces previous flow
state, outputs, logs, and workspace-local user files. Back up the directory
first, or use `ecc workspace refresh NAME --project DIR --keep-backup` to retain
the replaced generation. For parameter-only changes, use **Edit → Config**.
See [Updating a Workspace](user-guide.md#updating-a-workspace).

**Q: Does deleting a workspace delete its files?**

The confirmation dialog defaults to **Keep workspace data**. Accepting that
default removes the registration and keeps the directory. Clear the checkbox
to also delete an internal workspace directory. External workspace files are
always retained.
