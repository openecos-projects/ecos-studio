def __getattr__(name):
    if name == "app":
        from .main import app

        return app
    raise AttributeError(name)


__all__ = ["app"]
