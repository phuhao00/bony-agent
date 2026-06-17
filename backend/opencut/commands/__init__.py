"""
OpenCut Command 模式

参考 OpenCut classic 的 apps/web/src/commands/
每个命令负责：
1. 保存执行前的状态快照
2. 修改项目状态
3. 提供 undo() 方法还原快照
"""

from .base import Command, BatchCommand, CommandResult, create_element_selection
from .track_commands import (
    AddTrackCommand,
    RemoveTrackCommand,
    ToggleTrackMuteCommand,
    ToggleTrackVisibilityCommand,
)
from .element_commands import (
    InsertElementCommand,
    DeleteElementsCommand,
    MoveElementsCommand,
    SplitElementsCommand,
    UpdateElementTrimCommand,
)

__all__ = [
    "Command",
    "BatchCommand",
    "CommandResult",
    "create_element_selection",
    "AddTrackCommand",
    "RemoveTrackCommand",
    "ToggleTrackMuteCommand",
    "ToggleTrackVisibilityCommand",
    "InsertElementCommand",
    "DeleteElementsCommand",
    "MoveElementsCommand",
    "SplitElementsCommand",
    "UpdateElementTrimCommand",
]
