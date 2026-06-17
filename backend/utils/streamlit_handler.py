import logging
import streamlit as st

class StreamlitLogHandler(logging.Handler):
    """
    自定义日志处理器，将日志输出到 Streamlit 的容器中（如 st.status 或 st.expander）。
    """
    def __init__(self, container):
        super().__init__()
        self.container = container
        
    def emit(self, record):
        try:
            msg = self.format(record)
            # 使用 markdown 显示日志，稍微美化一下（斜体）
            # 注意：这里假设 container 有 markdown 方法（st.status, st.container 等都有）
            self.container.markdown(f"📝 *{msg}*")
        except Exception:
            self.handleError(record)
