"""Shared provider errors used across domain boundaries."""


class ProposalProviderError(RuntimeError):
    def __init__(self, message: str, failure_class: str = "tool_error") -> None:
        super().__init__(message)
        self.failure_class = failure_class
