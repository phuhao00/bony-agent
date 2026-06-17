"""RAG incremental indexing unit tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


class RagIncrementalTests(unittest.TestCase):
    def test_update_metadata_skips_full_rebuild_without_category_change(self):
        from utils.rag_manager import RAGManager

        mgr = RAGManager.__new__(RAGManager)
        mgr.documents_meta = {
            "doc1": {
                "id": "doc1",
                "category": "general",
                "tags": [],
                "description": "old",
            }
        }
        mgr._save_documents_meta = MagicMock()
        mgr._reindex_document = MagicMock(return_value=True)
        mgr._rebuild_index = MagicMock()

        result = mgr.update_document_metadata("doc1", tags=["a"], description="new")

        self.assertTrue(result["success"])
        mgr._rebuild_index.assert_not_called()
        mgr._reindex_document.assert_not_called()

    def test_update_metadata_reindexes_on_category_change(self):
        from utils.rag_manager import RAGManager

        mgr = RAGManager.__new__(RAGManager)
        mgr.documents_meta = {
            "doc1": {"id": "doc1", "category": "general", "tags": [], "description": ""}
        }
        mgr._save_documents_meta = MagicMock()
        mgr._reindex_document = MagicMock(return_value=True)
        mgr._rebuild_index = MagicMock()

        mgr.update_document_metadata("doc1", category="faq")

        mgr._reindex_document.assert_called_once_with("doc1")
        mgr._rebuild_index.assert_not_called()


if __name__ == "__main__":
    unittest.main()
