#!/usr/bin/env bash
# macOS：熄屏后仍保持系统唤醒，局域网可继续访问本机 3000/8000 等服务。
# 不阻止显示器休眠（不加 caffeinate -d），仅防止整机睡眠断网。
#
# 用法:
#   ./scripts/mac_keep_awake.sh start   # 单独保持唤醒（服务已手动启动时）
#   ./scripts/mac_keep_awake.sh stop
#   ./scripts/mac_keep_awake.sh status
#
# start_local.sh / start_with_tunnel.sh 默认 KEEP_AWAKE=1 会自动调用 start/stop。

mac_keep_awake_pid_file() {
    local root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    echo "$root/logs/keep_awake.pid"
}

mac_keep_awake_start() {
    local project_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local log_fn="${2:-}"
    local pid_file
    pid_file="$(mac_keep_awake_pid_file "$project_dir")"
    mkdir -p "$(dirname "$pid_file")"

    if [ "$(uname -s)" != "Darwin" ]; then
        return 0
    fi
    if [ "${KEEP_AWAKE:-1}" = "0" ]; then
        [ -n "$log_fn" ] && $log_fn "  KEEP_AWAKE=0，跳过防睡眠"
        return 0
    fi
    if ! command -v caffeinate >/dev/null 2>&1; then
        [ -n "$log_fn" ] && $log_fn "  未找到 caffeinate，无法防睡眠（请升级 macOS）"
        return 1
    fi

    mac_keep_awake_stop "$project_dir" quiet

    # -i 防止空闲睡眠；-m 磁盘；-s 接电源时防止系统睡眠（不含 -d，允许熄屏）
    nohup caffeinate -ims >/dev/null 2>&1 &
    echo $! >"$pid_file"

    [ -n "$log_fn" ] && $log_fn "  防睡眠已开启 (caffeinate pid $(cat "$pid_file"))，熄屏后局域网仍可访问"
    [ -n "$log_fn" ] && $log_fn "  关闭: Ctrl+C 结束 start 脚本，或 ./scripts/mac_keep_awake.sh stop"
    return 0
}

mac_keep_awake_stop() {
    local project_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local quiet="${2:-}"
    local pid_file pid

    pid_file="$(mac_keep_awake_pid_file "$project_dir")"
    if [ ! -f "$pid_file" ]; then
        return 0
    fi
    pid="$(cat "$pid_file" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null
        [ "$quiet" != "quiet" ] && echo "已停止防睡眠 (pid $pid)"
    fi
    rm -f "$pid_file"
}

mac_keep_awake_status() {
    local project_dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
    local pid_file pid

    pid_file="$(mac_keep_awake_pid_file "$project_dir")"
    if [ -f "$pid_file" ]; then
        pid="$(cat "$pid_file" 2>/dev/null)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "运行中 (pid $pid)"
            return 0
        fi
    fi
    echo "未运行"
    return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    set -euo pipefail
    PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    case "${1:-status}" in
        start) mac_keep_awake_start "$PROJECT_DIR" echo ;;
        stop) mac_keep_awake_stop "$PROJECT_DIR" ;;
        status) mac_keep_awake_status "$PROJECT_DIR" ;;
        *)
            echo "用法: $0 {start|stop|status}"
            exit 1
            ;;
    esac
fi
