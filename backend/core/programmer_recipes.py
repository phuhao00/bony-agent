"""Programmer Agent recipe registry."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class RecipeStep:
    id: str
    kind: str
    description: str


@dataclass(frozen=True)
class ProgrammerRecipe:
    id: str
    name: str
    category: str
    description: str
    platforms: List[str]
    risk_level: str
    requires_approval: bool
    capability_id: str
    steps: List[RecipeStep] = field(default_factory=list)
    params_schema: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["steps"] = [asdict(s) for s in self.steps]
        return data


_ALL_PLATFORMS = ["darwin", "win32", "linux"]

PROGRAMMER_RECIPES: Dict[str, ProgrammerRecipe] = {
    "git.inspect": ProgrammerRecipe(
        id="git.inspect",
        name="Git & SSH 环境检查",
        category="git",
        description="扫描工作区 Git 状态、远程仓库、SSH 公钥与 config。",
        platforms=_ALL_PLATFORMS,
        risk_level="low",
        requires_approval=False,
        capability_id="dev_git_ops",
        steps=[RecipeStep("scan", "diagnose", "Collect git and ssh profile")],
    ),
    "git.status": ProgrammerRecipe(
        id="git.status",
        name="Git 状态",
        category="git",
        description="查看当前分支、短状态与最近提交。",
        platforms=_ALL_PLATFORMS,
        risk_level="low",
        requires_approval=False,
        capability_id="dev_git_ops",
        steps=[RecipeStep("status", "diagnose", "git status and log")],
    ),
    "infra.scan_all": ProgrammerRecipe(
        id="infra.scan_all",
        name="基础设施扫描",
        category="infra",
        description="探测 Redis/MySQL/MongoDB/etcd/Consul/NSQ 等组件安装与运行状态。",
        platforms=_ALL_PLATFORMS,
        risk_level="low",
        requires_approval=False,
        capability_id="dev_infra_manage",
        steps=[RecipeStep("scan", "diagnose", "Probe all infra components")],
    ),
    "infra.health_check": ProgrammerRecipe(
        id="infra.health_check",
        name="组件健康检查",
        category="infra",
        description="对指定组件执行健康探测。",
        platforms=_ALL_PLATFORMS,
        risk_level="low",
        requires_approval=False,
        capability_id="dev_infra_manage",
        params_schema={"component_id": {"type": "string", "required": True}},
        steps=[RecipeStep("health", "diagnose", "Run health command")],
    ),
    "infra.start": ProgrammerRecipe(
        id="infra.start",
        name="启动组件",
        category="infra",
        description="通过 docker/brew services 启动指定组件（需审批）。",
        platforms=_ALL_PLATFORMS,
        risk_level="high",
        requires_approval=True,
        capability_id="dev_infra_manage",
        params_schema={"component_id": {"type": "string", "required": True}},
        steps=[RecipeStep("start", "execute", "Start component")],
    ),
    "infra.stop": ProgrammerRecipe(
        id="infra.stop",
        name="停止组件",
        category="infra",
        description="停止指定组件（需审批）。",
        platforms=_ALL_PLATFORMS,
        risk_level="high",
        requires_approval=True,
        capability_id="dev_infra_manage",
        params_schema={"component_id": {"type": "string", "required": True}},
        steps=[RecipeStep("stop", "execute", "Stop component")],
    ),
    "infra.restart": ProgrammerRecipe(
        id="infra.restart",
        name="重启组件",
        category="infra",
        description="重启指定组件（需审批）。",
        platforms=_ALL_PLATFORMS,
        risk_level="high",
        requires_approval=True,
        capability_id="dev_infra_manage",
        params_schema={"component_id": {"type": "string", "required": True}},
        steps=[RecipeStep("restart", "execute", "Restart component")],
    ),
    "dev.run_tests": ProgrammerRecipe(
        id="dev.run_tests",
        name="运行测试",
        category="dev",
        description="在工作区运行 pytest（需审批）。",
        platforms=_ALL_PLATFORMS,
        risk_level="medium",
        requires_approval=True,
        capability_id="shell_command",
        params_schema={"path": {"type": "string", "required": False}},
        steps=[RecipeStep("test", "execute", "Run pytest")],
    ),
    "dev.lint": ProgrammerRecipe(
        id="dev.lint",
        name="Python Lint",
        category="dev",
        description="对工作区运行 ruff/flake8 静态检查（只读）。",
        platforms=_ALL_PLATFORMS,
        risk_level="low",
        requires_approval=False,
        capability_id="code_analysis",
        steps=[RecipeStep("lint", "diagnose", "Run linter")],
    ),
}


def list_recipes(*, category: Optional[str] = None) -> List[Dict[str, Any]]:
    recipes = PROGRAMMER_RECIPES.values()
    if category:
        recipes = [r for r in recipes if r.category == category]
    return [r.to_dict() for r in recipes]


def get_recipe(recipe_id: str) -> Optional[ProgrammerRecipe]:
    return PROGRAMMER_RECIPES.get(recipe_id)
