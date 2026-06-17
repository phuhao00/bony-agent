"""Auth API integration tests."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("AUTH_REQUIRED", "false")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from utils.auth import hash_password  # noqa: E402
from utils.auth_db import create_user, init_db  # noqa: E402


class AuthApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory()
        import utils.auth_db as auth_db

        auth_db.DB_PATH = Path(cls._tmpdir.name) / "auth.db"
        init_db()
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls._tmpdir.cleanup()

    def test_login_and_me(self):
        create_user(
            username="testuser_auth",
            password_hash=hash_password("secret123"),
            role="admin",
        )
        login = self.client.post(
            "/auth/login",
            json={"username": "testuser_auth", "password": "secret123"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        token = login.json()["access_token"]
        me = self.client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["user"]["username"], "testuser_auth")


if __name__ == "__main__":
    unittest.main()
