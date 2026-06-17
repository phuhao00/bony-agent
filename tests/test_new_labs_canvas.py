"""Quick integration smoke tests for new Labs canvas endpoints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_short_drama_recipes():
    r = client.get("/short-drama/recipes")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "recipes" in data
    ids = {x["id"] for x in data["recipes"]}
    assert "short_drama.script" in ids
    assert "short_drama.storyboard" in ids
    assert "short_drama.produce" in ids
    print("short-drama recipes OK", ids)


def test_music_run_mock():
    r = client.post("/music/run", json={
        "recipe_id": "music.text_to_music",
        "params": {"prompt": "轻快吉他 BGM", "style": "流行", "mood": "欢快", "duration": 30, "instrumental": True},
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["status"] == "completed"
    assert "audio_url" in data["result"]
    print("music run OK", data["result"].get("provider"))


def test_short_drama_run_script():
    r = client.post("/short-drama/run", json={
        "recipe_id": "short_drama.script",
        "params": {"brief": "女主误会男主出轨，最后发现是为了给她准备惊喜", "platform": "douyin", "duration": 60, "style": "甜宠"},
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["status"] == "completed"
    assert "script" in data["result"]
    print("short-drama script OK", data["result"]["script"].get("title"))


def test_podcast_run_plan():
    r = client.post("/podcast/run", json={
        "recipe_id": "podcast.plan",
        "params": {"topic": "AI 如何改变普通人的内容创作", "format": "双人对话", "tone": "轻松", "duration": 15, "audience": "25-35 岁创作者"},
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["status"] == "completed"
    assert "plan" in data["result"]
    print("podcast plan OK", data["result"]["plan"].get("title"))


def test_assistant_catalog():
    r = client.get("/agent/assistant-catalog")
    assert r.status_code == 200, r.text
    data = r.json()
    ids = {a["agent_id"] for a in data.get("assistants", [])}
    assert "short_drama_agent" in ids
    assert "music_agent" in ids
    assert "podcast_agent" in ids
    print("assistant catalog OK", ids & {"short_drama_agent", "music_agent", "podcast_agent"})


if __name__ == "__main__":
    test_short_drama_recipes()
    test_music_run_mock()
    test_short_drama_run_script()
    test_podcast_run_plan()
    test_assistant_catalog()
    print("\nAll smoke tests passed.")
