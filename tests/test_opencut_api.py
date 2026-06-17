"""
OpenCut API 集成测试
覆盖 /opencut 下新增的前端友好端点及 command 模式。
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def test_video():
    """生成一个 1 秒 1280x720 的测试视频（含音频）"""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=1:size=1280x720:rate=30",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", path,
        ],
        capture_output=True,
        check=True,
    )
    yield path
    os.remove(path)


@pytest.fixture(scope="module")
def silent_video():
    """生成一个 1 秒无声测试视频"""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=1:size=1280x720:rate=30",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", path,
        ],
        capture_output=True,
        check=True,
    )
    yield path
    os.remove(path)


@pytest.fixture
def project():
    r = client.post("/opencut/projects", json={"name": "API Test Project"})
    assert r.status_code == 200
    proj = r.json()["project"]
    return {
        "id": proj["metadata"]["id"],
        "scene_id": proj["scenes"][0]["id"],
        "main_track_id": proj["scenes"][0]["tracks"]["main"]["id"],
    }


def _upload_video(path: str) -> str:
    with open(path, "rb") as f:
        r = client.post("/opencut/assets/upload", files={"file": ("test.mp4", f, "video/mp4")})
    assert r.status_code == 200
    return r.json()["asset"]["assetId"]


def test_create_and_get_project():
    r = client.post("/opencut/projects", json={"name": "Create Test"})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    pid = data["project"]["metadata"]["id"]

    r2 = client.get(f"/opencut/projects/{pid}")
    assert r2.status_code == 200
    assert r2.json()["project"]["metadata"]["id"] == pid


def test_assets_upload_and_list(test_video):
    aid = _upload_video(test_video)

    r2 = client.get("/opencut/assets")
    assert r2.status_code == 200
    assert any(a["assetId"] == aid for a in r2.json()["assets"])


def test_add_scene_element(project, test_video):
    asset_id = _upload_video(test_video)

    r2 = client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0.5},
    )
    assert r2.status_code == 200
    data = r2.json()
    assert data["success"] is True
    assert data["elementId"]

    r3 = client.get(f"/opencut/projects/{project['id']}")
    proj = r3.json()["project"]
    assert any(el["id"] == data["elementId"] for el in proj["scenes"][0]["tracks"]["main"]["elements"])


def test_export_project(project, test_video):
    asset_id = _upload_video(test_video)

    client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0},
    )

    r2 = client.post(f"/opencut/projects/{project['id']}/export")
    assert r2.status_code == 200
    data = r2.json()
    assert data["success"] is True
    assert data["url"]
    assert os.path.exists(data["path"])


def test_export_silent_video(project, silent_video):
    """无声视频应自动回退到静音轨道，不应 500"""
    asset_id = _upload_video(silent_video)
    client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0},
    )
    r2 = client.post(f"/opencut/projects/{project['id']}/export")
    assert r2.status_code == 200
    assert r2.json()["success"] is True


def test_move_and_undo_command(project, test_video):
    asset_id = _upload_video(test_video)
    r = client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0},
    )
    element_id = r.json()["elementId"]

    r2 = client.post(
        f"/opencut/projects/{project['id']}/command",
        json={
            "command_type": "moveElements",
            "params": {
                "moves": [{"elementId": element_id, "newStartTime": 2.0}]
            },
        },
    )
    assert r2.status_code == 200
    proj = r2.json()["project"]
    el = proj["scenes"][0]["tracks"]["main"]["elements"][0]
    assert el["startTime"] == 2.0

    r3 = client.post(f"/opencut/projects/{project['id']}/undo")
    assert r3.status_code == 200
    el2 = r3.json()["project"]["scenes"][0]["tracks"]["main"]["elements"][0]
    assert el2["startTime"] == 0.0

    r4 = client.post(f"/opencut/projects/{project['id']}/redo")
    assert r4.status_code == 200
    el3 = r4.json()["project"]["scenes"][0]["tracks"]["main"]["elements"][0]
    assert el3["startTime"] == 2.0


def test_delete_command(project, test_video):
    asset_id = _upload_video(test_video)
    r = client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0},
    )
    element_id = r.json()["elementId"]

    r2 = client.post(
        f"/opencut/projects/{project['id']}/command",
        json={
            "command_type": "deleteElements",
            "params": {
                "elementRefs": [{"trackId": project["main_track_id"], "elementId": element_id}]
            },
        },
    )
    assert r2.status_code == 200
    assert len(r2.json()["project"]["scenes"][0]["tracks"]["main"]["elements"]) == 0


def test_serve_media(project, test_video):
    asset_id = _upload_video(test_video)
    r = client.get("/opencut/assets")
    asset = next(a for a in r.json()["assets"] if a["assetId"] == asset_id)

    r2 = client.get(f"/opencut/media-file?path={asset['path']}")
    assert r2.status_code == 200
    assert r2.headers["content-type"] in ("video/mp4", "application/octet-stream")


def test_export_with_effects(project, test_video):
    asset_id = _upload_video(test_video)
    client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={
            "trackId": project["main_track_id"],
            "assetId": asset_id,
            "startTime": 0,
            "duration": 1,
        },
    )
    # 通过 update_project 写入滤镜参数
    r = client.get(f"/opencut/projects/{project['id']}")
    proj = r.json()["project"]
    el = proj["scenes"][0]["tracks"]["main"]["elements"][0]
    el["params"] = {"brightness": 1.2, "contrast": 1.1, "blur": 2, "maskType": "cinematic-bars"}
    r2 = client.put(f"/opencut/projects/{project['id']}", json=proj)
    assert r2.status_code == 200

    r3 = client.post(f"/opencut/projects/{project['id']}/export")
    assert r3.status_code == 200
    assert r3.json()["success"] is True


def test_frame_preview(project, test_video):
    asset_id = _upload_video(test_video)
    client.post(
        f"/opencut/projects/{project['id']}/scenes/{project['scene_id']}/elements",
        json={"trackId": project["main_track_id"], "assetId": asset_id, "startTime": 0},
    )
    r = client.get(f"/opencut/projects/{project['id']}/frame?time=0.3&width=640&height=360")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert len(r.content) > 100


def test_media_outside_storage_denied():
    r = client.get("/opencut/media-file?path=/etc/passwd")
    assert r.status_code == 403
