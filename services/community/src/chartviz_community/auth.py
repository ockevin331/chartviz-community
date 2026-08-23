from __future__ import annotations

import hmac

from fastapi import Header, HTTPException


class LocalTokenAuth:
    def __init__(self, expected_token: str) -> None:
        self._expected_token = expected_token

    async def __call__(self, authorization: str | None = Header(default=None)) -> None:
        scheme, separator, supplied_token = (authorization or "").partition(" ")
        valid = (
            separator == " "
            and scheme.lower() == "bearer"
            and bool(supplied_token)
            and hmac.compare_digest(supplied_token, self._expected_token)
        )
        if not valid:
            raise HTTPException(
                status_code=401,
                detail="Authentication required.",
                headers={"WWW-Authenticate": "Bearer"},
            )
