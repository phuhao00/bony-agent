"""
媒体画廊页面 - 展示所有生成的图片和视频
"""
import streamlit as st
import os
import json
from datetime import datetime

# 页面配置
st.set_page_config(
    page_title="媒体画廊",
    page_icon="🎨",
    layout="wide"
)

st.title("🎨 媒体画廊")
st.markdown("查看所有通过 AI 生成的图片和视频")

# 媒体目录
# 获取项目根目录 (Streamlit 运行在 backend/admin/pages 下或者根目录)
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUTPUT_DIR = os.path.join(PROJECT_DIR, "storage", "outputs")
MEDIA_REGISTRY = os.path.join(OUTPUT_DIR, "media_registry.json")

def load_media_registry():
    """加载媒体注册表"""
    if os.path.exists(MEDIA_REGISTRY):
        try:
            with open(MEDIA_REGISTRY, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {"images": [], "videos": []}
    return {"images": [], "videos": []}

def get_media_files():
    """扫描目录获取所有媒体文件"""
    images = []
    videos = []
    
    if not os.path.exists(OUTPUT_DIR):
        return images, videos
    
    for filename in os.listdir(OUTPUT_DIR):
        filepath = os.path.join(OUTPUT_DIR, filename)
        if not os.path.isfile(filepath):
            continue
            
        # 获取文件修改时间
        mtime = os.path.getmtime(filepath)
        time_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
        
        if filename.endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
            images.append({
                "filename": filename,
                "path": filepath,
                "time": time_str,
                "mtime": mtime
            })
        elif filename.endswith(('.mp4', '.webm', '.mov')):
            videos.append({
                "filename": filename,
                "path": filepath,
                "time": time_str,
                "mtime": mtime
            })
    
    # 按时间倒序排列
    images.sort(key=lambda x: x["mtime"], reverse=True)
    videos.sort(key=lambda x: x["mtime"], reverse=True)
    
    return images, videos

# 获取媒体文件
images, videos = get_media_files()

# 创建标签页
tab1, tab2 = st.tabs([f"🖼️ 图片 ({len(images)})", f"🎥 视频 ({len(videos)})"])

with tab1:
    if not images:
        st.info("还没有生成任何图片。返回主页面开始创作吧！")
    else:
        # 使用列布局展示图片
        cols = st.columns(3)
        for idx, img in enumerate(images):
            with cols[idx % 3]:
                try:
                    st.image(img["path"], use_container_width=True)
                    st.caption(f"📅 {img['time']}")
                    
                    # 下载按钮
                    with open(img["path"], "rb") as f:
                        st.download_button(
                            label="⬇️ 下载",
                            data=f,
                            file_name=img["filename"],
                            mime="image/jpeg",
                            key=f"dl_img_{idx}"
                        )
                except Exception as e:
                    st.error(f"无法加载: {img['filename']}")

with tab2:
    if not videos:
        st.info("还没有生成任何视频。返回主页面开始创作吧！")
    else:
        for idx, vid in enumerate(videos):
            col1, col2 = st.columns([3, 1])
            with col1:
                try:
                    st.video(vid["path"])
                except Exception as e:
                    st.error(f"无法加载: {vid['filename']}")
            with col2:
                st.markdown(f"**文件名:** {vid['filename']}")
                st.markdown(f"📅 {vid['time']}")
                
                # 下载按钮
                try:
                    with open(vid["path"], "rb") as f:
                        st.download_button(
                            label="⬇️ 下载视频",
                            data=f,
                            file_name=vid["filename"],
                            mime="video/mp4",
                            key=f"dl_vid_{idx}"
                        )
                except:
                    pass
            st.markdown("---")

# 侧边栏
with st.sidebar:
    st.header("📊 统计")
    st.metric("图片总数", len(images))
    st.metric("视频总数", len(videos))
    
    st.markdown("---")
    
    if st.button("🔄 刷新", help="重新扫描媒体文件"):
        st.rerun()
    
    st.markdown("---")
    
    # 清理功能
    if st.button("🗑️ 清空所有媒体", type="secondary"):
        if st.session_state.get("confirm_delete"):
            # 执行删除
            deleted_count = 0
            for img in images:
                try:
                    os.remove(img["path"])
                    deleted_count += 1
                except:
                    pass
            for vid in videos:
                try:
                    os.remove(vid["path"])
                    deleted_count += 1
                except:
                    pass
            
            # 清空注册表
            if os.path.exists(MEDIA_REGISTRY):
                os.remove(MEDIA_REGISTRY)
                
            st.success(f"已删除 {deleted_count} 个文件")
            st.session_state["confirm_delete"] = False
            st.rerun()
        else:
            st.session_state["confirm_delete"] = True
            st.warning("再次点击确认删除")
