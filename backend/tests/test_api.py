from __future__ import annotations

from fastapi.testclient import TestClient


def test_http_endpoints_and_websocket(app):
    with TestClient(app) as client:
        bootstrap = client.get("/api/bootstrap")
        assert bootstrap.status_code == 200
        payload = bootstrap.json()
        assert payload["countries"]

        news_response = client.get("/api/countries/BR/news")
        assert news_response.status_code == 200
        assert news_response.json()["items"]
        assert news_response.json()["items"][0]["contentText"]

        live_news_response = client.get("/api/news/live")
        assert live_news_response.status_code == 200
        assert live_news_response.json()["items"]
        assert live_news_response.json()["items"][0]["countryIso2"] == "BR"

        topics_response = client.get("/api/countries/BR/topics")
        assert topics_response.status_code == 200
        assert topics_response.json()["items"]

        dashboard_response = client.get("/api/dashboard")
        assert dashboard_response.status_code == 200
        assert dashboard_response.json()["signals"]
        assert dashboard_response.json()["stocks"]
        assert dashboard_response.json()["defcon"]["level"] >= 1

        air_response = client.get("/api/traffic/air", params={"bbox": "-60,-35,-30,5", "countryIso2": "BR"})
        assert air_response.status_code == 200
        assert air_response.json()["items"]

        sea_response = client.get("/api/traffic/sea", params={"bbox": "-60,-35,-30,5", "countryIso2": "BR"})
        assert sea_response.status_code == 200
        assert sea_response.json()["items"]

        with client.websocket_connect("/ws/live") as websocket:
            websocket.send_json(
                {
                    "bbox": [-60, -35, -30, 5],
                    "countryIso2": "BR",
                    "layers": ["air", "sea", "news"],
                }
            )
            snapshot = websocket.receive_json()
            assert snapshot["type"] == "snapshot"
            assert snapshot["air"]["items"]
            assert snapshot["sea"]["items"]
            assert snapshot["news"]["items"]
