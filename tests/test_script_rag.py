
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from tools.script_tools import generate_script

class TestScriptRAG(unittest.TestCase):
    @patch('tools.script_tools.search_knowledge_base')
    @patch('tools.script_tools.get_llm')
    def test_generate_script_with_rag(self, mock_get_llm, mock_search_kb):
        # Mock LLM response
        mock_llm_instance = MagicMock()
        mock_llm_instance.invoke.return_value.content = '{"scenes": []}'
        mock_get_llm.return_value = mock_llm_instance

        # Mock RAG response
        mock_search_kb.invoke.return_value = "Project Alpha launch date is 2025-12-12"

        # Call generate_script
        result = generate_script.invoke({
            "topic": "Project Alpha",
            "use_search": True
        })

        # Verify RAG was called
        mock_search_kb.invoke.assert_called_with("Project Alpha")

        # Verify context was passed to LLM (via prompt chain)
        # transform the call args to string to check for the context
        call_args = mock_llm_instance.invoke.call_args
        self.assertIn("Project Alpha launch date is 2025-12-12", str(call_args))
        print("✅ Test passed: RAG context was retrieved and passed to LLM")

    @patch('tools.script_tools.search_knowledge_base')
    @patch('tools.script_tools.get_llm')
    def test_generate_script_without_rag(self, mock_get_llm, mock_search_kb):
        # Mock LLM response
        mock_llm_instance = MagicMock()
        mock_llm_instance.invoke.return_value.content = '{"scenes": []}'
        mock_get_llm.return_value = mock_llm_instance

        # Call generate_script with use_search=False
        result = generate_script.invoke({
            "topic": "Project Beta",
            "use_search": False
        })

        # Verify RAG was NOT called
        mock_search_kb.invoke.assert_not_called()
        print("✅ Test passed: RAG was skipped as requested")

if __name__ == '__main__':
    unittest.main()
