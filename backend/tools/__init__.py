"""Backend tool package.

The existing `*_tools.py` modules remain the stable implementation modules.
New code can import grouped facades from `tools.media`, `tools.content`,
`tools.social`, and `tools.knowledge` while older imports continue to work.
"""

from .exceptions import (
    KnowledgeError,
    MediaGenerationError,
    PublishError,
    ToolConfigurationError,
    ToolError,
)

__all__ = [
    "KnowledgeError",
    "MediaGenerationError",
    "PublishError",
    "ToolConfigurationError",
    "ToolError",
]
