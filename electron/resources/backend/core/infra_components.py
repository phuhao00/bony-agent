"""Infrastructure component registry and health probes for Programmer Agent."""

from __future__ import annotations

import socket
import subprocess
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from core.programmer_command_policy import current_platform, validate_programmer_shell_command
from utils.logger import setup_logger

logger = setup_logger("infra_components")


@dataclass(frozen=True)
class InfraComponent:
    id: str
    name: str
    category: str
    default_port: int
    description: str
    cli_binaries: List[str] = field(default_factory=list)
    health_command: str = ""
    docker_image_hint: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


INFRA_COMPONENTS: Dict[str, InfraComponent] = {
    "redis": InfraComponent(
        id="redis",
        name="Redis",
        category="cache",
        default_port=6379,
        description="In-memory key-value store",
        cli_binaries=["redis-cli", "redis-server"],
        health_command="redis-cli ping",
        docker_image_hint="redis",
    ),
    "mysql": InfraComponent(
        id="mysql",
        name="MySQL",
        category="database",
        default_port=3306,
        description="Relational database",
        cli_binaries=["mysql", "mysqld"],
        health_command="mysqladmin ping",
        docker_image_hint="mysql",
    ),
    "mongodb": InfraComponent(
        id="mongodb",
        name="MongoDB",
        category="database",
        default_port=27017,
        description="Document database",
        cli_binaries=["mongosh", "mongo", "mongod"],
        health_command="mongosh --eval 'db.runCommand({ping:1})'",
        docker_image_hint="mongo",
    ),
    "etcd": InfraComponent(
        id="etcd",
        name="etcd",
        category="coordination",
        default_port=2379,
        description="Distributed key-value store",
        cli_binaries=["etcd", "etcdctl"],
        health_command="etcdctl endpoint health",
        docker_image_hint="etcd",
    ),
    "consul": InfraComponent(
        id="consul",
        name="Consul",
        category="coordination",
        default_port=8500,
        description="Service mesh and discovery",
        cli_binaries=["consul"],
        health_command="consul members",
        docker_image_hint="consul",
    ),
    "nsq": InfraComponent(
        id="nsq",
        name="NSQ",
        category="messaging",
        default_port=4150,
        description="Distributed message queue",
        cli_binaries=["nsqd", "nsqadmin", "nsqlookupd"],
        health_command="curl -s http://127.0.0.1:4151/ping",
        docker_image_hint="nsqio/nsq",
    ),
    "postgres": InfraComponent(
        id="postgres",
        name="PostgreSQL",
        category="database",
        default_port=5432,
        description="Relational database",
        cli_binaries=["psql", "pg_isready"],
        health_command="pg_isready",
        docker_image_hint="postgres",
    ),
    "rabbitmq": InfraComponent(
        id="rabbitmq",
        name="RabbitMQ",
        category="messaging",
        default_port=5672,
        description="Message broker",
        cli_binaries=["rabbitmqctl"],
        health_command="rabbitmqctl status",
        docker_image_hint="rabbitmq",
    ),
    "kafka": InfraComponent(
        id="kafka",
        name="Kafka",
        category="messaging",
        default_port=9092,
        description="Distributed streaming platform",
        cli_binaries=["kafka-topics", "kafka-server-start"],
        health_command="",
        docker_image_hint="confluentinc/cp-kafka",
    ),
    "elasticsearch": InfraComponent(
        id="elasticsearch",
        name="Elasticsearch",
        category="search",
        default_port=9200,
        description="Search and analytics engine",
        cli_binaries=["curl"],
        health_command="curl -s http://127.0.0.1:9200",
        docker_image_hint="elasticsearch",
    ),
}


def list_components() -> List[Dict[str, Any]]:
    return [c.to_dict() for c in INFRA_COMPONENTS.values()]


def get_component(component_id: str) -> Optional[InfraComponent]:
    return INFRA_COMPONENTS.get(component_id)


def _port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _which(binary: str) -> Optional[str]:
    try:
        completed = subprocess.run(
            ["which", binary] if current_platform() != "win32" else ["where", binary],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if completed.returncode == 0 and completed.stdout.strip():
            return completed.stdout.strip().splitlines()[0]
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def _run_readonly(command: str, *, timeout: int = 15) -> Dict[str, Any]:
    try:
        policy = validate_programmer_shell_command(command, read_only=True)
        completed = subprocess.run(
            policy["argv"],
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
            check=False,
        )
        return {
            "success": completed.returncode == 0,
            "command": command,
            "returncode": completed.returncode,
            "stdout": (completed.stdout or "")[:8192],
            "stderr": (completed.stderr or "")[:4096],
        }
    except ValueError as exc:
        return {"success": False, "command": command, "error": str(exc)}


def probe_component(component_id: str) -> Dict[str, Any]:
    comp = get_component(component_id)
    if not comp:
        return {"id": component_id, "error": "unknown component"}

    binaries_found = {b: _which(b) for b in comp.cli_binaries}
    installed = any(path for path in binaries_found.values())
    port_open = _port_open("127.0.0.1", comp.default_port)

    health: Dict[str, Any] = {"skipped": True}
    if comp.health_command and (installed or port_open):
        health = _run_readonly(comp.health_command)

    return {
        "id": comp.id,
        "name": comp.name,
        "category": comp.category,
        "default_port": comp.default_port,
        "description": comp.description,
        "installed": installed,
        "binaries": binaries_found,
        "port_open": port_open,
        "likely_running": port_open or health.get("success"),
        "health": health,
    }


def scan_all_components() -> Dict[str, Any]:
    results = [probe_component(cid) for cid in INFRA_COMPONENTS]
    running = [r for r in results if r.get("likely_running")]
    installed = [r for r in results if r.get("installed")]
    return {
        "total": len(results),
        "installed_count": len(installed),
        "running_count": len(running),
        "components": results,
    }


def build_infra_command(action: str, component_id: str, *, platform: Optional[str] = None) -> str:
    """Build start/stop/restart command for a component (docker-first, then brew services)."""
    comp = get_component(component_id)
    if not comp:
        raise ValueError(f"Unknown component: {component_id}")
    platform = platform or current_platform()
    image = comp.docker_image_hint or component_id

    if action == "start":
        if platform == "darwin":
            return f"brew services start {component_id}"
        return f"docker start {component_id} 2>/dev/null || docker run -d --name {component_id} -p {comp.default_port}:{comp.default_port} {image}"
    if action == "stop":
        if platform == "darwin":
            return f"brew services stop {component_id}"
        return f"docker stop {component_id}"
    if action == "restart":
        if platform == "darwin":
            return f"brew services restart {component_id}"
        return f"docker restart {component_id}"
    raise ValueError(f"Unknown action: {action}")
