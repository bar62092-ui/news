# World Watch Backend

API FastAPI para o prototipo de mapa global com noticias e rotas.

## Execucao

```powershell
cd world-watch\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
uvicorn app.main:app --reload --port 8100
```
