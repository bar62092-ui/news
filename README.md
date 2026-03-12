# World Watch

Prototipo de mapa global com:

- pontos por pais
- rotas aereas por bbox usando OpenSky
- rotas maritimas por bbox usando AISStream ou fallback local
- noticias e topicos por pais com GDELT + RSS

## Estrutura

- `backend/`: FastAPI + SQLite
- `frontend/`: React + Vite + MapLibre + deck.gl
- `shared/`: metadados opcionais de paises

## Backend

```powershell
cd world-watch\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
uvicorn app.main:app --reload --port 8100
```

## Frontend

```powershell
cd world-watch\frontend
npm install
npm run dev
```

## Variaveis uteis

- `WORLD_WATCH_OPENSKY_USERNAME`
- `WORLD_WATCH_OPENSKY_PASSWORD`
- `WORLD_WATCH_AISSTREAM_API_KEY`
- `VITE_API_BASE_URL`

## Deploy publico em URL unica

O projeto agora inclui:

- `Dockerfile` na raiz de `world-watch/`
- `render.yaml` para um web service no Render

Fluxo esperado:

1. subir `world-watch/` para um repositorio Git
2. criar um Web Service no Render usando o `Dockerfile`
3. opcionalmente anexar disco persistente e apontar `WORLD_WATCH_DATABASE_PATH=/var/data/world_watch.sqlite3`
