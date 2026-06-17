import streamlit as st
import pandas as pd
from utils.vector_store import get_vector_store

st.set_page_config(
    page_title="记忆查看器",
    page_icon="🧠",
    layout="wide"
)

st.title("🧠 向量记忆查看器")
st.markdown("这里展示了 TurboVec 中存储的所有向量记忆。")

# 获取 API Key (优先从 session state 获取，或者尝试从环境变量)
# 注意：多页面应用中，主页面的 session_state 是共享的，但为了保险，我们检查一下
api_key = st.sidebar.text_input("ZhipuAI API Key", type="password", key="memory_viewer_api_key")

if not api_key:
    # 尝试从主页面的输入（如果用户在主页面输过，通常在 session_state 里可能没直接存，除非我们在 app.py 里存了）
    # 这里简单处理：如果没输入，提示用户
    st.info("请先输入 API Key 以连接向量数据库（因为需要初始化 Embedding 模型）。")
    st.stop()

# 初始化 Store
try:
    store = get_vector_store(api_key)
except Exception as e:
    st.error(f"无法连接向量数据库: {e}")
    st.stop()

if not store:
    st.error("向量数据库初始化失败。")
    st.stop()

# 获取所有记忆
if st.button("🔄 刷新数据"):
    st.rerun()

memories = store.get_all_memories()

if not memories:
    st.info("暂无记忆数据。去主页生成一些内容吧！")
else:
    st.metric("记忆总数", len(memories))
    
    # 转换为 DataFrame 以便展示
    data = []
    for mem in memories:
        item = {
            "ID": mem["id"],
            "Content (Prompt)": mem["content"],
            "Type": mem["metadata"].get("type", "unknown"),
            "URL": mem["metadata"].get("url", "N/A"),
        }
        # 把其他 metadata 也放进去
        for k, v in mem["metadata"].items():
            if k not in ["type", "url"]:
                item[k] = v
        data.append(item)
    
    df = pd.DataFrame(data)
    
    # 展示表格
    st.dataframe(
        df,
        column_config={
            "URL": st.column_config.LinkColumn("URL"),
        },
        use_container_width=True
    )

    # 详情查看器
    st.markdown("### 🔍 记忆详情")
    selected_id = st.selectbox("选择 ID 查看详情", df["ID"])
    if selected_id:
        selected_mem = next((m for m in memories if m["id"] == selected_id), None)
        if selected_mem:
            col1, col2 = st.columns([1, 1])
            with col1:
                st.markdown("**Content:**")
                st.info(selected_mem["content"])
                st.markdown("**Metadata:**")
                st.json(selected_mem["metadata"])
            with col2:
                url = selected_mem["metadata"].get("url")
                type_ = selected_mem["metadata"].get("type")
                if url:
                    if type_ == "video":
                        st.video(url)
                    elif type_ == "image":
                        st.image(url)
                    else:
                        st.markdown(f"[链接]({url})")
