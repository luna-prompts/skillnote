import os
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["setup"])

_TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "scripts" / "setup-template.sh"


def _derive_urls(request: Request):
    host = request.headers.get("host", "localhost:8082").split(":")[0]
    return {
        "api": os.environ.get("SKILLNOTE_API_URL", f"http://{host}:8082"),
        "mcp": os.environ.get("SKILLNOTE_MCP_URL", f"http://{host}:8083/mcp"),
        "web": os.environ.get("SKILLNOTE_WEB_URL", f"http://{host}:3000"),
    }


@router.get("/v1/config")
def get_config(request: Request):
    """Return service URLs for plugin/hook discovery."""
    urls = _derive_urls(request)
    return {"api_url": urls["api"], "mcp_url": urls["mcp"], "web_url": urls["web"]}


@router.get("/setup")
def get_setup_script(request: Request):
    """Serve the curl|bash install script that creates the full SkillNote plugin."""
    urls = _derive_urls(request)
    template = _TEMPLATE_PATH.read_text()
    script = (template
              .replace("__API_URL__", urls["api"])
              .replace("__MCP_URL__", urls["mcp"])
              .replace("__WEB_URL__", urls["web"]))
    return PlainTextResponse(script, media_type="text/plain")
