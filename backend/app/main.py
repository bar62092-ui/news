from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import build_services, create_api_router, mount_frontend, websocket_live
from .config import Settings, load_settings


def create_app(custom_settings: Settings | None = None) -> FastAPI:
    settings = custom_settings or load_settings()
    services = build_services(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services.watchlist_task = asyncio.create_task(services.news.start_watchlist_loop())
        try:
            yield
        finally:
            if services.watchlist_task:
                services.watchlist_task.cancel()
                await asyncio.gather(services.watchlist_task, return_exceptions=True)
            await services.news.stop()
            await services.http_client.aclose()

    app = FastAPI(title="World Watch", version="0.1.0", lifespan=lifespan)
    app.state.services = services
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(create_api_router(services))
    mount_frontend(app, settings.frontend_dist_path)

    @app.websocket("/ws/live")
    async def live_socket(websocket: WebSocket) -> None:
        await websocket_live(websocket, services)

    return app


app = create_app()
