"""
命令模式基类
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from opencut.models import CommandResult, EditorSelection, ElementRef, TProject


class Command(ABC):
    """命令基类"""

    @abstractmethod
    def execute(self, project: TProject) -> Optional[CommandResult]:
        """执行命令，修改项目状态"""
        pass

    def undo(self, project: TProject) -> None:
        """撤销命令"""
        raise NotImplementedError("Undo not implemented for this command")

    def redo(self, project: TProject) -> Optional[CommandResult]:
        """重做命令，默认重新执行"""
        return self.execute(project)


def create_element_selection(element_refs: List[ElementRef]) -> CommandResult:
    """创建选区结果"""
    return CommandResult(selection=EditorSelection(selected_elements=element_refs))


class BatchCommand(Command):
    """批量命令"""

    def __init__(self, commands: List[Command]):
        self.commands = commands
        self._results: List[Optional[CommandResult]] = []

    def execute(self, project: TProject) -> Optional[CommandResult]:
        self._results = []
        last_result = None
        for cmd in self.commands:
            result = cmd.execute(project)
            self._results.append(result)
            if result is not None:
                last_result = result
        return last_result

    def undo(self, project: TProject) -> None:
        for cmd in reversed(self.commands):
            cmd.undo(project)
