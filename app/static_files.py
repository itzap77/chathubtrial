from pathlib import Path

from fastapi.staticfiles import StaticFiles


class SecureStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            filename = Path(path).name
            response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class NoCacheStaticFiles(StaticFiles):
    """Serves app CSS/JS but forces the browser to revalidate every time, so a
    freshly deployed version is never masked by a stale cached copy."""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response
