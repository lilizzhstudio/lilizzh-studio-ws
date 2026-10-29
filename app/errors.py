class ApiError(Exception):
    """Raised by handlers; converted to a JSON {"detail": ...} response."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail
