"""Shared exceptions for backend tool modules."""


class ToolError(Exception):
    """Base exception for recoverable tool failures."""


class MediaGenerationError(ToolError):
    """Raised when image, video, audio, or remix generation fails."""


class PublishError(ToolError):
    """Raised when platform publishing fails."""


class KnowledgeError(ToolError):
    """Raised when RAG or memory operations fail."""


class ToolConfigurationError(ToolError):
    """Raised when required credentials or runtime configuration are missing."""
