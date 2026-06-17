import json
import os
import unittest
from unittest.mock import patch, MagicMock
import sys

# Ensure backend folder is in path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from tools.lobster_tools import get_nodes_config, send_task_to_openclaw

class TestLobsterDistributed(unittest.TestCase):
    
    @patch.dict(os.environ, {"OPENCLAW_NODES": json.dumps([
        {"id": "local", "name": "Local Node", "url": "http://127.0.0.1:18789", "type": "local"},
        {"id": "cloud", "name": "Cloud Node", "url": "https://api.cloud-claw.ai", "type": "remote"}
    ])})
    def test_node_config_parsing(self):
        nodes = get_nodes_config()
        self.assertEqual(len(nodes), 2)
        self.assertEqual(nodes[0]["id"], "local")
        self.assertEqual(nodes[1]["id"], "cloud")

    @patch('tools.lobster_tools._call_openclaw_rest')
    def test_routing_to_specific_node(self, mock_rest):
        mock_rest.return_value = "Cloud Response"
        
        # Test routing to cloud
        with patch.dict(os.environ, {"OPENCLAW_NODES": json.dumps([
            {"id": "local", "name": "Local", "url": "http://127.0.0.1:18789"},
            {"id": "cloud", "name": "Cloud", "url": "http://cloud.claw"}
        ])}):
            result = send_task_to_openclaw.invoke({"task": "hi", "node_id": "cloud"})
            self.assertIn("Cloud Response", result)
            self.assertIn("Cloud", result)
            # Verify URL passed to REST call
            mock_rest.assert_called_with("http://cloud.claw", "hi")

    @patch('tools.lobster_tools._call_openclaw_cli')
    @patch('tools.lobster_tools._call_openclaw_rest')
    def test_local_fallback_to_cli(self, mock_rest, mock_cli):
        mock_rest.side_effect = Exception("Connection Failed")
        mock_cli.return_value = "CLI Response"
        
        with patch.dict(os.environ, {"OPENCLAW_NODES": json.dumps([
            {"id": "local", "name": "Local", "url": "http://127.0.0.1:18789", "type": "local"}
        ])}):
            result = send_task_to_openclaw.invoke({"task": "hi", "node_id": "local"})
            self.assertIn("CLI Response", result)
            mock_cli.assert_called_once()

if __name__ == "__main__":
    unittest.main()
