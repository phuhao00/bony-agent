#!/usr/bin/env bash
# 由 start_local.sh / start_with_tunnel.sh 在服务启动完成后 source。
# 自动：餐费局域网链接 + macOS 防睡眠（熄屏仍可访问本机端口）

# 启动后收尾：打印餐费链接、开启防睡眠
# 依赖调用方已定义：PROJECT_DIR, log, LAN_IP(可选), MEAL_LAN_AUTO(可选)
start_finalize_after_services() {
    local _meal_url=""

    if [ "${MEAL_LAN_AUTO:-1}" != "0" ]; then
        # shellcheck source=scripts/meal_lan_env.sh
        if [ -f "$PROJECT_DIR/scripts/meal_lan_env.sh" ]; then
            # shellcheck disable=SC1091
            source "$PROJECT_DIR/scripts/meal_lan_env.sh"
            meal_export_lan_web_base
            _meal_url="${MEAL_WEB_BASE_URL}/meal/upload"
            log "  MEAL_WEB_BASE_URL     = $MEAL_WEB_BASE_URL"
        fi
    fi

    if [ "$(uname -s)" = "Darwin" ] && [ "${KEEP_AWAKE:-1}" != "0" ]; then
        # shellcheck source=scripts/mac_keep_awake.sh
        # shellcheck disable=SC1091
        source "$PROJECT_DIR/scripts/mac_keep_awake.sh"
        mac_keep_awake_start "$PROJECT_DIR" log
    elif [ "${KEEP_AWAKE:-1}" = "0" ]; then
        log "  KEEP_AWAKE=0，未开启防睡眠"
    fi

    START_FINALIZE_MEAL_URL="$_meal_url"
    START_FINALIZE_KEEP_AWAKE="$([ "${KEEP_AWAKE:-1}" != "0" ] && [ "$(uname -s)" = "Darwin" ] && echo 1 || echo 0)"
}

start_finalize_print_summary() {
    local _fmt_label="${1:-%-14s}"
    local _fmt_val="${2:-%s}"

    if [ -n "${START_FINALIZE_MEAL_URL:-}" ]; then
        # shellcheck disable=SC2059
        printf "$_fmt_label $_fmt_val\n" "餐费上传" "$START_FINALIZE_MEAL_URL"
    fi
    if [ "${START_FINALIZE_KEEP_AWAKE:-0}" = "1" ]; then
        # shellcheck disable=SC2059
        printf "$_fmt_label $_fmt_val\n" "防睡眠" "已开启（熄屏可访问，Ctrl+C 结束 start 时关闭）"
    fi
}

start_finalize_cleanup() {
    # shellcheck source=scripts/mac_keep_awake.sh
    if [ -f "${PROJECT_DIR}/scripts/mac_keep_awake.sh" ]; then
        # shellcheck disable=SC1091
        source "$PROJECT_DIR/scripts/mac_keep_awake.sh"
        mac_keep_awake_stop "$PROJECT_DIR" quiet 2>/dev/null || true
    fi
}
