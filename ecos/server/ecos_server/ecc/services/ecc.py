#!/usr/bin/env python
import logging
import os
import time
from logging.handlers import RotatingFileHandler

from ..schemas import (
    CMDEnum,
    ECCRequest,
    ECCResponse,
    ResponseEnum,
)
from ..sse import server_notify

gui_notify = server_notify()

logger = logging.getLogger(__name__)


def _summarize_request(data: object) -> dict:
    """Extract key fields from request data for logging."""
    if not isinstance(data, dict):
        return {}
    summary = {}
    for key in ("directory", "step", "id", "pdk", "pdk_root", "rerun"):
        if key in data:
            summary[key] = data[key]
    if "parameters" in data:
        summary["parameters_keys"] = len(data["parameters"])
    if "rtl_list" in data:
        rtl = data["rtl_list"]
        summary["rtl_count"] = len(rtl.splitlines() if isinstance(rtl, str) else rtl)
    return summary


class ECCService:
    # Logger subtree that receives workspace-level file logging
    _WS_LOGGER_NAME = "ecos_server.ecc"

    # All CMDEnum values except "notify" (which is SSE-only, not dispatched).
    _COMMANDS = frozenset(e.value for e in CMDEnum if e is not CMDEnum.notify)

    def __init__(self):
        self.workspace = None
        self.engine_flow = None
        self._workspace_log_handler = None

    def dispatch(self, request: ECCRequest) -> ECCResponse:
        """Route request to the matching handler method and log execution."""
        cmd = request.cmd
        if cmd not in self._COMMANDS:
            return ECCResponse(
                cmd=cmd,
                response=ResponseEnum.error.value,
                data={},
                message=[f"unknown command: {cmd}"],
            )

        handler = getattr(self, cmd)
        logger.info("[CMD:start] cmd=%s %s", cmd, _summarize_request(request.data))

        start = time.time()
        try:
            response = handler(request)
        except Exception:
            elapsed_ms = (time.time() - start) * 1000
            logger.exception("[CMD:error] cmd=%s elapsed=%.0fms", cmd, elapsed_ms)
            raise

        elapsed_ms = (time.time() - start) * 1000
        result = getattr(response, "response", type(response).__name__)
        logger.info("[CMD:done] cmd=%s result=%s elapsed=%.0fms", cmd, result, elapsed_ms)
        return response

    def _attach_workspace_log(self, workspace_dir: str):
        """Attach a rotating file handler that mirrors API logs into {workspace}/log/server.log."""
        self._detach_workspace_log()
        log_dir = os.path.join(os.path.abspath(workspace_dir), "log")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "server.log")
        handler = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024, backupCount=5)
        handler.setFormatter(
            logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
        )
        logging.getLogger(self._WS_LOGGER_NAME).addHandler(handler)
        self._workspace_log_handler = handler
        logger.info("Server API logs -> %s", log_path)

    def _detach_workspace_log(self):
        """Remove the previous workspace file handler, if any."""
        if self._workspace_log_handler:
            logging.getLogger(self._WS_LOGGER_NAME).removeHandler(self._workspace_log_handler)
            self._workspace_log_handler.close()
            self._workspace_log_handler = None

    @staticmethod
    def _normalize_rtl_list(rtl_list) -> list[str]:
        if not rtl_list:
            return []
        if isinstance(rtl_list, list):
            items = rtl_list
        elif isinstance(rtl_list, str):
            items = rtl_list.splitlines()
        else:
            items = [rtl_list]

        result = []
        seen = set()
        for item in items:
            path = str(item).strip()
            if not path or path in seen:
                continue
            seen.add(path)
            result.append(path)
        return result

    @staticmethod
    def _write_filelist(directory: str, rtl_paths: list[str]) -> str:
        os.makedirs(directory, exist_ok=True)
        filelist_path = os.path.join(directory, "filelist")
        with open(filelist_path, "w", encoding="utf-8") as f:
            for path in rtl_paths:
                if any(ch.isspace() for ch in path):
                    f.write(f'"{path}"\n')
                else:
                    f.write(f"{path}\n")
        return filelist_path

    def __build_flow(self):
        from chipcompiler.engine import EngineFlow
        from chipcompiler.rtl2gds import build_rtl2gds_flow

        engine_flow = EngineFlow(workspace=self.workspace)
        if not engine_flow.has_init():
            steps = build_rtl2gds_flow()
            for step, tool, state in steps:
                engine_flow.add_step(step=step, tool=tool, state=state)
        else:
            engine_flow.create_step_workspaces()

        self.engine_flow = engine_flow

        if engine_flow.is_flow_success():
            return
        engine_flow.create_step_workspaces()

    def create_workspace(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "directory" : "",
            "pdk" : "",
            "pdk_root" : "",
            "parameters" : {},
            "origin_def" : "",
            "origin_verilog" : "",
            "filelist" : "",
            "rtl_list" : ""
        },
        "response" : {
            "directory" : ""
        }
        """
        from chipcompiler.data import create_workspace as _create_workspace

        # get data
        data = request.data

        # check data

        # process cmd
        input_filelist = data.get("filelist", "")
        if not input_filelist:
            rtl_list = data.get("rtl_list", "")
            rtl_paths = self._normalize_rtl_list(rtl_list)
            if rtl_paths:
                try:
                    input_filelist = self._write_filelist(
                        directory=data.get("directory", ""), rtl_paths=rtl_paths
                    )
                except Exception as e:
                    logger.exception("create_workspace: failed to write filelist from rtl_list")
                    return ECCResponse(
                        cmd=request.cmd,
                        response=ResponseEnum.error.value,
                        data={},
                        message=[f"failed to create filelist from rtl_list: {e}"],
                    )

        try:
            workspace = _create_workspace(
                directory=data.get("directory", ""),
                pdk=data.get("pdk", ""),
                parameters=data.get("parameters", {}),
                origin_def=data.get("origin_def", ""),
                origin_verilog=data.get("origin_verilog", ""),
                input_filelist=input_filelist,
                pdk_root=data.get("pdk_root", ""),
            )
        except Exception as e:
            logger.exception("create_workspace: create_workspace() raised exception")
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data={},
                message=[
                    f"create workspace failed : {data.get('directory', '')}, error info is {e}"
                ],
            )

        if workspace is None:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data={},
                message=[f"create workspace failed : {data.get('directory', '')}"],
            )
        else:
            self.workspace = workspace
            self.__build_flow()

            # 设置 gui_notify 的 workspace_id
            gui_notify.set_workspace(workspace.directory)

            # Attach workspace-level log handler
            self._attach_workspace_log(workspace.directory)

            response_data = {
                "directory": data.get("directory", ""),
                "workspace_id": workspace.directory,  # 前端用于订阅 SSE
            }
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.success.value,
                data=response_data,
                message=[f"create workspace success : {data.get('directory', '')}"],
            )

    def set_pdk_root(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "pdk" : "ics55",
            "pdk_root" : "/abs/path/to/pdk"
        },
        "response" : {
            "pdk" : "ics55",
            "pdk_root" : "/abs/path/to/pdk",
            "env_key" : "CHIPCOMPILER_ICS55_PDK_ROOT"
        }
        """
        from chipcompiler.data import get_pdk

        data = request.data
        pdk_name = str(data.get("pdk", "")).strip().lower()
        pdk_root = str(data.get("pdk_root", "")).strip()

        env_key = f"CHIPCOMPILER_{pdk_name.upper()}_PDK_ROOT" if pdk_name else ""
        response_data = {
            "pdk": pdk_name,
            "pdk_root": pdk_root,
            "env_key": env_key,
        }

        # Validate inputs
        error = None
        if not pdk_name:
            error = "missing pdk name"
        elif not pdk_root:
            error = "missing pdk_root"
        elif pdk_name not in {"ics55"}:
            error = f"unsupported pdk '{pdk_name}'"
        elif not os.path.isdir(pdk_root):
            error = f"pdk_root is not a directory: {pdk_root}"

        if error:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data=response_data,
                message=[f"set pdk root failed: {error}"],
            )

        try:
            pdk = get_pdk(pdk_name=pdk_name, pdk_root=pdk_root)
            resolved_root = pdk.root or pdk_root
            os.environ[env_key] = resolved_root

            response_data["pdk_root"] = resolved_root

            if self.workspace is not None and self.workspace.pdk.name.lower() == pdk_name:
                self.workspace.pdk = pdk
                self.workspace.parameters.data["PDK Root"] = resolved_root
        except Exception as e:
            logger.exception("set_pdk_root: get_pdk() or env update failed")
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"set pdk root error: {e}"],
            )

        return ECCResponse(
            cmd=request.cmd,
            response=ResponseEnum.success.value,
            data=response_data,
            message=[f"set pdk root success: {pdk_name} -> {response_data['pdk_root']}"],
        )

    def load_workspace(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "directory" : ""
        },
        "response" : {
            "directory" : ""
        }
        """
        from chipcompiler.data import load_workspace as _load_workspace

        # get data
        data = request.data

        # check data

        # process cmd
        try:
            workspace = _load_workspace(directory=data.get("directory", ""))
        except Exception as e:
            logger.exception("load_workspace: load_workspace() raised exception")
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data={},
                message=[f"load workspace failed : {data.get('directory', '')}, error info is {e}"],
            )

        if workspace is None:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data={},
                message=[f"load workspace failed : {data.get('directory', '')}"],
            )
        else:
            self.workspace = workspace
            self.__build_flow()

            # 设置 gui_notify 的 workspace_id
            gui_notify.set_workspace(workspace.directory)

            # Attach workspace-level log handler
            self._attach_workspace_log(workspace.directory)

            response_data = {
                "directory": data.get("directory", ""),
                "workspace_id": workspace.directory,  # 前端用于订阅 SSE
            }
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.success.value,
                data=response_data,
                message=[f"load workspace success : {data.get('directory', '')}"],
            )

    def delete_workspace(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "directory" : ""
        },
        "response" : {
            "directory" : ""
        }
        """
        # get data
        data = request.data
        directory = data.get("directory", "")

        # check data
        if (
            self.workspace is None
            or self.workspace.directory != directory
            or not os.path.exists(directory)
        ):
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data={},
                message=[f"workspace not exist : {directory}"],
            )

        # process cmd
        self._detach_workspace_log()
        self.engine_flow = None
        self.workspace = None

        # 清除 gui_notify 的 workspace_id
        gui_notify.clear_workspace()

        try:
            import shutil

            shutil.rmtree(directory)
        except Exception:
            logger.exception("delete_workspace: failed to remove workspace directory")

        response_data = {"directory": directory}
        return ECCResponse(
            cmd=request.cmd,
            response=ResponseEnum.success.value,
            data=response_data,
            message=[f"delete workspace success : {directory}"],
        )

    def rtl2gds(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "rerun" : False
        },
        "response" : {
            "rerun" : False
        }
        """
        # get data
        data = request.data

        response_data = {"rerun": data.get("rerun", False)}

        # check data
        if self.workspace is None or not os.path.exists(self.workspace.directory):
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"workspace not exist : {self.workspace.directory}"],
            )

        if self.engine_flow is None:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"rtl2gds flow not exist : {self.workspace.directory}"],
            )

        # process cmd
        failed_step = None
        try:
            if data.get("rerun", False):
                self.engine_flow.clear_states()

            for workspace_step in self.engine_flow.workspace_steps:
                ecc_req = ECCRequest(
                    cmd="run_step",
                    data={"step": workspace_step.name, "rerun": data.get("rerun", False)},
                )
                # get response for each step
                # TBD, need to send response back to gui
                step_response = self.run_step(ecc_req)
                if step_response.response != ResponseEnum.success.value:
                    failed_step = workspace_step.name
                    break
                else:
                    log_file = workspace_step.log.get("file", "")
                    gui_notify.notify_step(
                        step=workspace_step.name,
                        step_path=self.workspace.flow.path,
                        home_page=self.workspace.home.path,
                        log_file=os.path.abspath(log_file) if log_file else "",
                    )
            # self.engine_flow.run_steps()
        except Exception as e:
            logger.exception("rtl2gds: execution failed")
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"run rtl2gds failed : {e}"],
            )

        if failed_step is None:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.success.value,
                data=response_data,
                message=[f"run rtl2gds success : {self.workspace.directory}"],
            )
        else:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data=response_data,
                message=[f"run rtl2gds failed in step : {failed_step}"],
            )

    def run_step(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {
            "step" : "",
            "rerun" : False
        },
        "response" : {
            "step" : "",
            "state" : "Unstart"
        }
        """
        from chipcompiler.data import StateEnum

        # get data
        data = request.data
        step = data.get("step", "")
        rerun = data.get("rerun", "")

        response_data = {"step": step, "state": "Unstart"}

        # check data
        if self.workspace is None or not os.path.exists(self.workspace.directory):
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"workspace not exist : {self.workspace.directory}"],
            )

        # process cmd
        state = StateEnum.Unstart
        try:
            state = self.engine_flow.run_step(step, rerun)
        except Exception:
            state = StateEnum.Imcomplete
            logger.exception("run_step: engine_flow.run_step() raised exception")

        response_data["state"] = state.value

        if StateEnum.Success == state:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.success.value,
                data=response_data,
                message=[f"run step {step} success : {self.workspace.directory}"],
            )
        else:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data=response_data,
                message=[
                    f"run step {step} failed with state {state.value} : {self.workspace.directory}"
                ],
            )

    def get_info(self, request: ECCRequest) -> ECCResponse:
        """
        get information by step (defined by StepEnum) and id (defined by InfoEnum)
        "request" : {
            "step" : "",
            "id" : ""
        },
        "response" : {
            "step" : "",
            "id" : "",
            "info" : {}
        }
        """
        # get data
        data = request.data
        step = data.get("step", "")
        id = data.get("id", "")

        response_data = {"step": step, "id": id, "info": {}}

        # check data
        if self.workspace is None or not os.path.exists(self.workspace.directory):
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"workspace not exist : {self.workspace.directory}"],
            )

        # process cmd
        try:
            # build information
            from .info import get_step_info

            info = get_step_info(
                workspace=self.workspace, step=self.engine_flow.get_workspace_step(step), id=id
            )

            if len(info) == 0:
                return ECCResponse(
                    cmd=request.cmd,
                    response=ResponseEnum.warning.value,
                    data=response_data,
                    message=[f"no information for step {step} : {self.workspace.directory}"],
                )
            else:
                response_data["info"] = info
        except Exception as e:
            logger.exception("get_info: get_step_info() raised exception")
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.error.value,
                data=response_data,
                message=[f"get information error for step {step} : {e}"],
            )

        return ECCResponse(
            cmd=request.cmd,
            response=ResponseEnum.success.value,
            data=response_data,
            message=[f"get information success : {step} - {id}"],
        )

    def home_page(self, request: ECCRequest) -> ECCResponse:
        """
        "request" : {},
        "response" : {
            "path" : ""
        }
        """
        if os.path.exists(self.workspace.home.path):
            response_data = {"path": self.workspace.home.path}
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.success.value,
                data=response_data,
                message=[f"build home page success : {self.workspace.home.path}"],
            )
        else:
            return ECCResponse(
                cmd=request.cmd,
                response=ResponseEnum.failed.value,
                data={},
                message=[f"build home page failed : {self.workspace.home.path}"],
            )
