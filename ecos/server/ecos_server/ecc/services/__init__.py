from .ecc import ECCService

_ecc_service = None


def ecc_service():
    global _ecc_service
    if _ecc_service is None:
        _ecc_service = ECCService()
    return _ecc_service


def get_step_info(*args, **kwargs):
    from .info import get_step_info as _get_step_info

    return _get_step_info(*args, **kwargs)


__all__ = ["ECCService", "ecc_service", "get_step_info"]
