# 餐费模块对外链接：使用局域网 http://<IP>:3000，不用公网域名。
# 用法: source "$PROJECT_DIR/scripts/meal_lan_env.sh" && meal_export_lan_web_base

meal_detect_lan_ip() {
    if command -v ipconfig >/dev/null 2>&1; then
        local _ip
        for _iface in en0 en1 en2 en3; do
            _ip=$(ipconfig getifaddr "$_iface" 2>/dev/null)
            if [ -n "$_ip" ]; then
                echo "$_ip"
                return 0
            fi
        done
    fi
    if command -v ip >/dev/null 2>&1; then
        ip -4 addr show scope global 2>/dev/null \
            | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}(?=/)' \
            | head -1
        return 0
    fi
    hostname -I 2>/dev/null | awk '{print $1}'
}

meal_export_lan_web_base() {
    if [ -n "${MEAL_WEB_BASE_URL:-}" ]; then
        export MEAL_WEB_BASE_URL="${MEAL_WEB_BASE_URL%/}"
        return 0
    fi
    local _lan
    _lan="$(meal_detect_lan_ip)"
    if [ -n "$_lan" ]; then
        export MEAL_WEB_BASE_URL="http://${_lan}:3000"
    else
        export MEAL_WEB_BASE_URL="http://127.0.0.1:3000"
    fi
    export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$MEAL_WEB_BASE_URL}"
}
