#!/usr/bin/env python3
"""
AI Media Agent — 架构图生成脚本

用法:
    python docs/diagrams/generate_diagrams.py

功能:
    生成项目架构图，保存到 docs/diagrams/ 目录:
    - system_architecture.png    系统整体架构图
    - data_flow.png              数据流图
    - multi_language_arch.png    三语言协作架构图
    - deployment_arch.png        部署架构图
    - module_relations.png       模块关系图

依赖:
    pip install matplotlib numpy

字体:
    优先使用 PingFang HK / Arial Unicode MS 支持中文显示
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np
import os
import sys

# 使用支持中文的字体
plt.rcParams['font.family'] = ['PingFang HK', 'Arial Unicode MS', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

# 输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))


def draw_box(ax, x, y, width, height, text, color, text_color='white', fontsize=9, alpha=0.9, radius=0.15):
    """绘制圆角矩形框"""
    box = FancyBboxPatch((x - width/2, y - height/2), width, height,
                         boxstyle=f"round,pad=0.02,rounding_size={radius}",
                         facecolor=color, edgecolor='white', linewidth=1.5, alpha=alpha)
    ax.add_patch(box)
    ax.text(x, y, text, ha='center', va='center', fontsize=fontsize,
            color=text_color, fontweight='bold', wrap=True)
    return box


def draw_arrow(ax, x1, y1, x2, y2, color='#666666', style='->', lw=1.5):
    """绘制箭头"""
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle=style, color=color, lw=lw,
                              connectionstyle="arc3,rad=0"))


def draw_group_box(ax, x, y, width, height, title, color, alpha=0.12):
    """绘制分组框"""
    box = FancyBboxPatch((x, y), width, height,
                         boxstyle="round,pad=0.02,rounding_size=0.3",
                         facecolor=color, edgecolor=color, linewidth=2, alpha=alpha)
    ax.add_patch(box)
    title_box = FancyBboxPatch((x, y + height - 0.45), width, 0.45,
                               boxstyle="round,pad=0.02,rounding_size=0.1",
                               facecolor=color, edgecolor=color, linewidth=0, alpha=0.5)
    ax.add_patch(title_box)
    ax.text(x + width/2, y + height - 0.22, title, ha='center', va='center',
            fontsize=12, color=color, fontweight='bold')


# ==================== 1. 系统整体架构图 ====================
def generate_system_architecture():
    fig, ax = plt.subplots(1, 1, figsize=(20, 14))
    ax.set_xlim(0, 20)
    ax.set_ylim(0, 14)
    ax.axis('off')
    ax.set_facecolor('#F8F9FA')
    fig.patch.set_facecolor('#F8F9FA')
    
    ax.text(10, 13.5, 'AI Media Agent — 系统整体架构 (V4)', ha='center', va='center',
            fontsize=20, fontweight='bold', color='#1a1a2e')
    ax.text(10, 13.1, '三语言协作 · 微服务架构 · 全链路内容生产', ha='center', va='center',
            fontsize=12, color='#666666')
    
    # 用户层
    draw_group_box(ax, 0.5, 11.5, 19, 1.2, '用户层', '#4A90E2')
    draw_box(ax, 5, 12.1, 2.8, 0.6, 'Web 浏览器', '#4A90E2')
    draw_box(ax, 10, 12.1, 2.8, 0.6, 'API 客户端', '#4A90E2')
    draw_box(ax, 15, 12.1, 2.8, 0.6, '桌面应用', '#4A90E2')
    
    # 前端层
    draw_group_box(ax, 0.5, 9.2, 19, 2.0, '前端层 (Next.js 16)', '#50C878')
    draw_box(ax, 3.5, 10.2, 2.5, 0.6, 'AI 对话 / 工作台', '#50C878', fontsize=8)
    draw_box(ax, 6.8, 10.2, 2.5, 0.6, '创作 / 媒体 / 流水线', '#50C878', fontsize=8)
    draw_box(ax, 10.1, 10.2, 2.5, 0.6, '定时发布 / 热点', '#50C878', fontsize=8)
    draw_box(ax, 13.4, 10.2, 2.5, 0.6, 'Computer Use', '#50C878', fontsize=8)
    draw_box(ax, 16.7, 10.2, 2.5, 0.6, '设置 / 知识库', '#50C878', fontsize=8)
    draw_box(ax, 5.5, 9.5, 3.5, 0.5, '主题系统 · CSS 变量令牌', '#3CB371', fontsize=8)
    draw_box(ax, 11, 9.5, 3.5, 0.5, 'SSE 流式代理 · i18n', '#3CB371', fontsize=8)
    
    # 后端层
    draw_group_box(ax, 0.5, 5.5, 19, 3.4, '后端层 (FastAPI + Python)', '#FF6B6B')
    
    draw_group_box(ax, 1, 7.8, 4, 1.0, '核心层', '#FF6B6B', 0.08)
    draw_box(ax, 3, 8.3, 3.5, 0.5, 'LLM Provider / Media Models', '#FF6B6B', fontsize=8)
    
    draw_group_box(ax, 5.5, 7.8, 4.5, 1.0, 'Agent 层 (LangGraph)', '#FF6B6B', 0.08)
    draw_box(ax, 7.75, 8.3, 4, 0.5, 'Orchestrator / Router / Registry', '#FF6B6B', fontsize=8)
    
    draw_group_box(ax, 10.5, 7.8, 4, 1.0, '工具层', '#FF6B6B', 0.08)
    draw_box(ax, 12.5, 8.3, 3.5, 0.5, 'Connectors / RAG / Multimodal', '#FF6B6B', fontsize=8)
    
    draw_group_box(ax, 15, 7.8, 4, 1.0, '服务层', '#FF6B6B', 0.08)
    draw_box(ax, 17, 8.3, 3.5, 0.5, 'Scheduler / MCP / gRPC', '#FF6B6B', fontsize=8)
    
    draw_box(ax, 5, 7.0, 4, 0.5, '能力注册 · 审批门控 · 任务管理', '#E74C3C', fontsize=8)
    draw_box(ax, 10, 7.0, 4, 0.5, '媒体流水线 · 研究链路 · 记忆协调', '#E74C3C', fontsize=8)
    draw_box(ax, 15, 7.0, 3.5, 0.5, '平台连接器矩阵', '#E74C3C', fontsize=8)
    
    draw_box(ax, 5.5, 6.2, 4.5, 0.5, '安全执行面: 沙箱 · 审计 · 回滚', '#C0392B', fontsize=8)
    draw_box(ax, 11, 6.2, 4.5, 0.5, 'Computer Use · Platform Actions', '#C0392B', fontsize=8)
    
    # 微服务层
    draw_group_box(ax, 0.5, 3.5, 19, 1.8, '微服务层 (gRPC)', '#9B59B6')
    draw_box(ax, 3.5, 4.5, 4, 0.6, 'Go 高并发引擎\n:50053 目录服务', '#9B59B6', fontsize=8)
    draw_box(ax, 8.5, 4.5, 4, 0.6, 'Rust 安全引擎\n:50052 文档/视频解析', '#9B59B6', fontsize=8)
    draw_box(ax, 13.5, 4.5, 4, 0.6, 'OCR Service\n:50051 文字识别', '#9B59B6', fontsize=8)
    draw_box(ax, 3.5, 3.8, 4, 0.5, '>=500 URL/s 抓取', '#8E44AD', fontsize=8)
    draw_box(ax, 8.5, 3.8, 4, 0.5, 'GB 级流式解析 <128MB', '#8E44AD', fontsize=8)
    draw_box(ax, 13.5, 3.8, 4, 0.5, '图片文字提取', '#8E44AD', fontsize=8)
    
    # 外部服务
    draw_group_box(ax, 0.5, 1.8, 9, 1.4, '外部服务', '#F39C12')
    draw_box(ax, 3.5, 2.7, 3.5, 0.5, 'LLM 供应商\n智谱 · GPT · Claude', '#F39C12', fontsize=8)
    draw_box(ax, 7.5, 2.7, 3.5, 0.5, '媒体生成\n即梦 · SeaDance · CogVideoX', '#F39C12', fontsize=8)
    
    # 存储层
    draw_group_box(ax, 10.5, 1.8, 9, 1.4, '存储层', '#1ABC9C')
    draw_box(ax, 12.5, 2.7, 2.8, 0.5, 'ChromaDB\n向量库', '#1ABC9C', fontsize=8)
    draw_box(ax, 16, 2.7, 2.8, 0.5, 'SQLite\nauth.db', '#1ABC9C', fontsize=8)
    draw_box(ax, 12.5, 2.1, 2.8, 0.5, 'JSON 配置', '#16A085', fontsize=8)
    draw_box(ax, 16, 2.1, 2.8, 0.5, '本地文件系统', '#16A085', fontsize=8)
    
    # 连接线
    for x in [5, 10, 15]:
        draw_arrow(ax, x, 11.5, x, 11.3, '#4A90E2')
    draw_arrow(ax, 10, 9.2, 10, 8.9, '#50C878')
    draw_arrow(ax, 10, 5.5, 10, 5.3, '#FF6B6B')
    draw_arrow(ax, 5, 5.5, 5, 4.2, '#FF6B6B')
    draw_arrow(ax, 14, 5.5, 14, 4.2, '#FF6B6B')
    draw_arrow(ax, 14, 3.5, 14, 3.2, '#9B59B6')
    
    # 图例
    legend_y = 0.8
    legend_items = [
        (1.5, '#4A90E2', '用户层'),
        (4.5, '#50C878', '前端层'),
        (7.5, '#FF6B6B', '后端层'),
        (10.5, '#9B59B6', '微服务层'),
        (13.5, '#F39C12', '外部服务'),
        (16.5, '#1ABC9C', '存储层'),
    ]
    for x, color, label in legend_items:
        ax.add_patch(FancyBboxPatch((x, legend_y-0.15), 0.4, 0.3, boxstyle="round,pad=0.02", facecolor=color, edgecolor='white'))
        ax.text(x+0.6, legend_y, label, fontsize=9, va='center')
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'system_architecture.png'), 
                dpi=200, bbox_inches='tight', facecolor='#F8F9FA', edgecolor='none')
    plt.close()
    print("  [OK] system_architecture.png")


# ==================== 2. 数据流图 ====================
def generate_data_flow():
    fig, ax = plt.subplots(1, 1, figsize=(16, 10))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 10)
    ax.axis('off')
    ax.set_facecolor('#F8F9FA')
    fig.patch.set_facecolor('#F8F9FA')
    
    ax.text(8, 9.5, '典型数据流：生成视频并发布到 B站', ha='center', va='center',
            fontsize=16, fontweight='bold', color='#1a1a2e')
    
    actors = [
        (1.5, 7.5, '用户', '#4A90E2'),
        (4.5, 7.5, '前端', '#50C878'),
        (7.5, 7.5, 'FastAPI', '#FF6B6B'),
        (10.5, 7.5, 'Agent', '#E74C3C'),
        (13.5, 7.5, '工具层', '#C0392B'),
    ]
    for x, y, text, color in actors:
        draw_box(ax, x, y, 2.2, 0.8, text, color, fontsize=10)
    
    draw_box(ax, 13.5, 5.5, 2.2, 0.8, '媒体生成\n即梦/SeaDance', '#F39C12', fontsize=9)
    draw_box(ax, 13.5, 3.5, 2.2, 0.8, '平台连接器\nB站/抖音/微博', '#9B59B6', fontsize=9)
    
    steps = [
        (1.5, 6.2, '1', '生成猫咪视频，发布到B站'),
        (4.5, 6.2, '2', 'POST /multi-agent/stream'),
        (7.5, 6.2, '3', '创建任务 + Trace'),
        (10.5, 6.2, '4', 'Supervisor -> media_agent'),
        (10.5, 5.2, '5', 'generate_video("猫咪")'),
        (13.5, 5.2, '6', '调用视频生成 API'),
        (13.5, 4.5, '7', '返回视频 URL'),
        (10.5, 4.5, '8', '视频生成完成'),
        (10.5, 3.5, '9', 'Supervisor -> 发布'),
        (10.5, 2.5, '10', 'publish_to_platform(bilibili)'),
        (13.5, 2.5, '11', 'Playwright 自动化'),
        (13.5, 1.8, '12', '发布成功，返回链接'),
        (10.5, 1.8, '13', '发布完成'),
        (7.5, 1.8, '14', 'SSE: final + done'),
        (4.5, 1.8, '15', '展示结果 + 链接'),
        (1.5, 1.8, '16', '查看发布结果'),
    ]
    for x, y, num, text in steps:
        ax.text(x, y, f'{num}. {text}', ha='center', va='center', fontsize=8,
                color='#333333', bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor='#DDDDDD'))
    
    # 箭头
    draw_arrow(ax, 1.5, 7.1, 1.5, 6.6, '#4A90E2')
    draw_arrow(ax, 1.5, 6.0, 3.3, 6.2, '#4A90E2')
    draw_arrow(ax, 4.5, 7.1, 4.5, 6.6, '#50C878')
    draw_arrow(ax, 4.5, 6.0, 6.3, 6.2, '#50C878')
    draw_arrow(ax, 7.5, 7.1, 7.5, 6.6, '#FF6B6B')
    draw_arrow(ax, 7.5, 6.0, 9.3, 6.2, '#FF6B6B')
    draw_arrow(ax, 10.5, 7.1, 10.5, 6.6, '#E74C3C')
    draw_arrow(ax, 10.5, 5.8, 10.5, 5.5, '#E74C3C')
    draw_arrow(ax, 11.6, 5.2, 12.3, 5.2, '#E74C3C')
    draw_arrow(ax, 13.5, 5.1, 13.5, 5.9, '#C0392B')
    draw_arrow(ax, 13.5, 5.1, 13.5, 4.9, '#F39C12')
    draw_arrow(ax, 12.3, 4.5, 11.6, 4.5, '#F39C12')
    draw_arrow(ax, 10.5, 4.1, 10.5, 3.8, '#E74C3C')
    draw_arrow(ax, 10.5, 3.2, 10.5, 2.9, '#E74C3C')
    draw_arrow(ax, 11.6, 2.5, 12.3, 2.5, '#E74C3C')
    draw_arrow(ax, 13.5, 2.9, 13.5, 3.1, '#C0392B')
    draw_arrow(ax, 13.5, 1.4, 13.5, 1.6, '#9B59B6')
    draw_arrow(ax, 12.3, 1.8, 11.6, 1.8, '#9B59B6')
    draw_arrow(ax, 9.3, 1.8, 8.3, 1.8, '#E74C3C')
    draw_arrow(ax, 6.3, 1.8, 5.7, 1.8, '#FF6B6B')
    draw_arrow(ax, 3.3, 1.8, 2.7, 1.8, '#50C878')
    
    ax.text(9, 2.2, 'SSE 流式返回', ha='center', va='center', fontsize=8,
            color='#FF6B6B', style='italic',
            bbox=dict(boxstyle='round,pad=0.2', facecolor='#FFF3F3', edgecolor='#FF6B6B'))
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'data_flow.png'),
                dpi=200, bbox_inches='tight', facecolor='#F8F9FA', edgecolor='none')
    plt.close()
    print("  [OK] data_flow.png")


# ==================== 3. 三语言协作架构图 ====================
def generate_multi_language():
    fig, ax = plt.subplots(1, 1, figsize=(14, 10))
    ax.set_xlim(0, 14)
    ax.set_ylim(0, 10)
    ax.axis('off')
    ax.set_facecolor('#F8F9FA')
    fig.patch.set_facecolor('#F8F9FA')
    
    ax.text(7, 9.5, '三语言协作架构', ha='center', va='center',
            fontsize=18, fontweight='bold', color='#1a1a2e')
    ax.text(7, 9.1, 'Python · Go · Rust 通过 gRPC + Protocol Buffers 协作', ha='center', va='center',
            fontsize=11, color='#666666')
    
    draw_group_box(ax, 0.5, 5.5, 4.5, 3.0, 'Python FastAPI', '#FF6B6B')
    draw_box(ax, 2.75, 7.5, 3.5, 0.6, 'Agent 编排 · LLM 调用', '#FF6B6B', fontsize=9)
    draw_box(ax, 2.75, 6.8, 3.5, 0.6, '业务逻辑 · API 网关', '#FF6B6B', fontsize=9)
    draw_box(ax, 2.75, 6.1, 3.5, 0.6, '快速迭代 · 生态丰富', '#E74C3C', fontsize=9)
    
    draw_group_box(ax, 5.5, 5.5, 3.5, 3.0, 'Go 引擎', '#4A90E2')
    draw_box(ax, 7.25, 7.5, 2.8, 0.6, '目录检索', '#4A90E2', fontsize=9)
    draw_box(ax, 7.25, 6.8, 2.8, 0.6, '批量抓取', '#4A90E2', fontsize=9)
    draw_box(ax, 7.25, 6.1, 2.8, 0.6, '>=500 URL/s', '#2980B9', fontsize=9)
    
    draw_group_box(ax, 9.5, 5.5, 4, 3.0, 'Rust 引擎', '#9B59B6')
    draw_box(ax, 11.5, 7.5, 3.2, 0.6, '文档解析 · 视频解析', '#9B59B6', fontsize=9)
    draw_box(ax, 11.5, 6.8, 3.2, 0.6, '加密 · 私钥存储', '#9B59B6', fontsize=9)
    draw_box(ax, 11.5, 6.1, 3.2, 0.6, 'GB 级流式 <128MB', '#8E44AD', fontsize=9)
    
    ax.text(7, 5.0, 'gRPC + Protocol Buffers', ha='center', va='center',
            fontsize=12, fontweight='bold', color='#333333',
            bbox=dict(boxstyle='round,pad=0.4', facecolor='#FFF9E6', edgecolor='#F39C12', linewidth=2))
    
    draw_box(ax, 3.5, 4.0, 3, 0.6, 'common.proto\n通用类型、错误码', '#F39C12', fontsize=8)
    draw_box(ax, 7, 4.0, 3, 0.6, 'directory.proto\n目录搜索、文件监控', '#F39C12', fontsize=8)
    draw_box(ax, 10.5, 4.0, 3, 0.6, 'document.proto / video.proto\n文档/视频解析', '#F39C12', fontsize=8)
    
    draw_box(ax, 2.5, 2.8, 3.5, 0.6, 'Python -> Go\ngRPC + TLS', '#4A90E2', fontsize=9)
    draw_box(ax, 7, 2.8, 3.5, 0.6, 'Python -> Rust\ngRPC + mTLS', '#9B59B6', fontsize=9)
    draw_box(ax, 11.5, 2.8, 2.5, 0.6, 'Python -> OCR\ngRPC', '#1ABC9C', fontsize=9)
    
    draw_arrow(ax, 5.0, 6.5, 5.5, 6.5, '#FF6B6B', lw=2)
    draw_arrow(ax, 9.0, 6.5, 9.5, 6.5, '#FF6B6B', lw=2)
    draw_arrow(ax, 7.0, 5.5, 7.0, 5.3, '#333333', lw=1.5)
    draw_arrow(ax, 5.0, 4.3, 5.0, 3.4, '#F39C12')
    draw_arrow(ax, 8.5, 4.3, 8.5, 3.4, '#F39C12')
    draw_arrow(ax, 12.0, 4.3, 12.0, 3.4, '#F39C12')
    
    ax.text(5.25, 6.7, ':50053', ha='center', va='center', fontsize=8, color='#FF6B6B', fontweight='bold')
    ax.text(9.25, 6.7, ':50052', ha='center', va='center', fontsize=8, color='#FF6B6B', fontweight='bold')
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'multi_language_arch.png'),
                dpi=200, bbox_inches='tight', facecolor='#F8F9FA', edgecolor='none')
    plt.close()
    print("  [OK] multi_language_arch.png")


# ==================== 4. 部署架构图 ====================
def generate_deployment():
    fig, ax = plt.subplots(1, 1, figsize=(16, 10))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 10)
    ax.axis('off')
    ax.set_facecolor('#F8F9FA')
    fig.patch.set_facecolor('#F8F9FA')
    
    ax.text(8, 9.5, '部署架构对比', ha='center', va='center',
            fontsize=18, fontweight='bold', color='#1a1a2e')
    
    draw_group_box(ax, 0.5, 5.0, 7, 4.0, '本地开发环境', '#50C878')
    draw_box(ax, 2, 8.0, 2.5, 0.6, './start_local.sh', '#50C878', fontsize=9)
    draw_box(ax, 5.5, 8.0, 2.5, 0.6, '一键启动所有服务', '#3CB371', fontsize=9)
    draw_box(ax, 2, 7.0, 2.5, 0.6, 'Next.js\n:3000', '#50C878', fontsize=9)
    draw_box(ax, 5.5, 7.0, 2.5, 0.6, 'FastAPI\n:8000', '#50C878', fontsize=9)
    draw_box(ax, 2, 6.0, 2.5, 0.6, 'Go Directory\n:50053', '#4A90E2', fontsize=9)
    draw_box(ax, 5.5, 6.0, 2.5, 0.6, 'Rust Parser\n:50052', '#9B59B6', fontsize=9)
    draw_box(ax, 3.75, 5.2, 2.5, 0.5, 'OCR Service\n:50051', '#1ABC9C', fontsize=9)
    
    draw_group_box(ax, 8.5, 5.0, 7, 4.0, 'Docker Compose 生产', '#4A90E2')
    draw_box(ax, 10, 8.0, 2.5, 0.6, 'Nginx 反向代理', '#4A90E2', fontsize=9)
    draw_box(ax, 13.5, 8.0, 2.5, 0.6, 'SSL/TLS 终止', '#2980B9', fontsize=9)
    draw_box(ax, 10, 7.0, 2.5, 0.6, 'web 容器\nNext.js', '#50C878', fontsize=9)
    draw_box(ax, 13.5, 7.0, 2.5, 0.6, 'api 容器\nFastAPI', '#FF6B6B', fontsize=9)
    draw_box(ax, 10, 6.0, 2.5, 0.6, 'go 容器\nDirectory', '#4A90E2', fontsize=9)
    draw_box(ax, 13.5, 6.0, 2.5, 0.6, 'rust 容器\nParser', '#9B59B6', fontsize=9)
    draw_box(ax, 11.75, 5.2, 2.5, 0.5, 'chroma 容器\n向量库', '#1ABC9C', fontsize=9)
    
    draw_arrow(ax, 10, 7.7, 10, 7.4, '#4A90E2')
    draw_arrow(ax, 13.5, 7.7, 13.5, 7.4, '#4A90E2')
    draw_arrow(ax, 10, 6.7, 10, 6.4, '#50C878')
    draw_arrow(ax, 13.5, 6.7, 13.5, 6.4, '#FF6B6B')
    
    draw_box(ax, 4, 9.3, 2.5, 0.5, '用户', '#333333', fontsize=10)
    draw_arrow(ax, 5.25, 8.9, 5.25, 8.3, '#333333')
    draw_arrow(ax, 5.25, 8.9, 11.75, 8.3, '#333333')
    
    ax.text(8, 4.2, '特性对比', ha='center', va='center',
            fontsize=13, fontweight='bold', color='#1a1a2e')
    
    features = [
        ('特性', '本地开发', 'Docker 生产'),
        ('启动方式', './start_local.sh', 'docker compose up -d'),
        ('服务发现', 'localhost + 端口', 'Docker 网络 DNS'),
        ('数据持久化', '本地目录', 'Docker Volumes'),
        ('扩展性', '手动启动多实例', 'docker compose scale'),
        ('日志', '本地日志文件', 'docker logs / 集中收集'),
        ('监控', 'tail -f', 'Prometheus + Grafana'),
    ]
    
    y_pos = 3.6
    for i, (feat, local, docker) in enumerate(features):
        bg_color = '#F0F0F0' if i == 0 else 'white'
        text_weight = 'bold' if i == 0 else 'normal'
        ax.add_patch(FancyBboxPatch((1, y_pos-0.2), 4, 0.4, boxstyle="round,pad=0.02", facecolor=bg_color, edgecolor='#DDDDDD'))
        ax.text(3, y_pos, feat, ha='center', va='center', fontsize=9, fontweight=text_weight)
        ax.add_patch(FancyBboxPatch((5.5, y_pos-0.2), 4, 0.4, boxstyle="round,pad=0.02", facecolor=bg_color, edgecolor='#DDDDDD'))
        ax.text(7.5, y_pos, local, ha='center', va='center', fontsize=9, fontweight=text_weight)
        ax.add_patch(FancyBboxPatch((10, y_pos-0.2), 4, 0.4, boxstyle="round,pad=0.02", facecolor=bg_color, edgecolor='#DDDDDD'))
        ax.text(12, y_pos, docker, ha='center', va='center', fontsize=9, fontweight=text_weight)
        y_pos -= 0.5
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'deployment_arch.png'),
                dpi=200, bbox_inches='tight', facecolor='#F8F9FA', edgecolor='none')
    plt.close()
    print("  [OK] deployment_arch.png")


# ==================== 5. 模块关系图 ====================
def generate_module_relations():
    fig, ax = plt.subplots(1, 1, figsize=(16, 12))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 12)
    ax.axis('off')
    ax.set_facecolor('#F8F9FA')
    fig.patch.set_facecolor('#F8F9FA')
    
    ax.text(8, 11.5, '核心模块依赖关系图', ha='center', va='center',
            fontsize=18, fontweight='bold', color='#1a1a2e')
    
    draw_box(ax, 8, 9.5, 3, 0.8, 'main.py\nAPI 入口 / 应用工厂', '#FF6B6B', fontsize=10)
    
    layer1 = [
        (3, 8.0, 'agents/\nLangGraph 编排', '#E74C3C'),
        (6.5, 8.0, 'core/\nLLM / 能力 / 审批', '#E74C3C'),
        (9.5, 8.0, 'tools/\n原子工具 / 连接器', '#E74C3C'),
        (13, 8.0, 'services/\n调度 / MCP / gRPC', '#E74C3C'),
    ]
    for x, y, text, color in layer1:
        draw_box(ax, x, y, 2.5, 0.7, text, color, fontsize=9)
        draw_arrow(ax, 8, 9.1, x, 8.4, '#FF6B6B')
    
    layer2_agents = [
        (1.5, 6.5, 'orchestrator.py\nSupervisor', '#C0392B'),
        (3.5, 6.5, 'router.py\n意图路由', '#C0392B'),
        (1.5, 5.7, 'registry.py\nAgent 注册', '#C0392B'),
        (3.5, 5.7, 'bot.py\nReAct', '#C0392B'),
    ]
    for x, y, text, color in layer2_agents:
        draw_box(ax, x, y, 1.8, 0.6, text, color, fontsize=8)
    draw_arrow(ax, 3, 7.6, 2.5, 6.8, '#E74C3C')
    
    layer2_core = [
        (5.5, 6.5, 'llm_provider.py', '#C0392B'),
        (7.5, 6.5, 'capabilities.py', '#C0392B'),
        (5.5, 5.7, 'execution_approval.py', '#C0392B'),
        (7.5, 5.7, 'media_pipeline.py', '#C0392B'),
    ]
    for x, y, text, color in layer2_core:
        draw_box(ax, x, y, 1.8, 0.6, text, color, fontsize=8)
    draw_arrow(ax, 6.5, 7.6, 6.5, 6.8, '#E74C3C')
    
    layer2_tools = [
        (9, 6.5, 'connectors/\n平台连接器', '#C0392B'),
        (11, 6.5, 'multimodal_tools.py', '#C0392B'),
        (9, 5.7, 'content/\n内容 facade', '#C0392B'),
        (11, 5.7, 'media/\n媒体 facade', '#C0392B'),
    ]
    for x, y, text, color in layer2_tools:
        draw_box(ax, x, y, 1.8, 0.6, text, color, fontsize=8)
    draw_arrow(ax, 9.5, 7.6, 10, 6.8, '#E74C3C')
    
    layer2_services = [
        (12.5, 6.5, 'scheduler.py', '#C0392B'),
        (14.5, 6.5, 'mcp_client.py', '#C0392B'),
        (12.5, 5.7, 'grpc_client.py', '#C0392B'),
        (14.5, 5.7, 'memory_coordinator.py', '#C0392B'),
    ]
    for x, y, text, color in layer2_services:
        draw_box(ax, x, y, 1.8, 0.6, text, color, fontsize=8)
    draw_arrow(ax, 13, 7.6, 13.5, 6.8, '#E74C3C')
    
    draw_group_box(ax, 1, 3.5, 14, 1.5, '基础设施层', '#9B59B6')
    infra = [
        (2.5, 4.3, 'auth.py / auth_db.py', '#9B59B6'),
        (5.5, 4.3, 'rag_manager.py', '#9B59B6'),
        (8, 4.3, 'chroma_client.py', '#9B59B6'),
        (10.5, 4.3, 'trace_store.py', '#9B59B6'),
        (13, 4.3, 'task_manager.py', '#9B59B6'),
        (4, 3.7, 'logger.py', '#8E44AD'),
        (7, 3.7, 'history_manager.py', '#8E44AD'),
        (10, 3.7, 'media_resolver.py', '#8E44AD'),
        (13, 3.7, 'oauth_manager.py', '#8E44AD'),
    ]
    for x, y, text, color in infra:
        draw_box(ax, x, y, 2.2, 0.5, text, color, fontsize=8)
    
    for x in [3, 6.5, 9.5, 13]:
        draw_arrow(ax, x, 5.4, x, 5.0, '#9B59B6', lw=1)
    
    draw_group_box(ax, 1, 1.5, 14, 1.5, '外部依赖', '#F39C12')
    external = [
        (3, 2.3, '智谱 AI / OpenRouter', '#F39C12'),
        (6, 2.3, '即梦 / SeaDance', '#F39C12'),
        (9, 2.3, 'Playwright 浏览器', '#F39C12'),
        (12, 2.3, 'ChromaDB / SQLite', '#F39C12'),
        (4.5, 1.7, 'DuckDuckGo 搜索', '#E67E22'),
        (8, 1.7, 'MCP 服务器', '#E67E22'),
        (11.5, 1.7, 'gRPC 微服务', '#E67E22'),
    ]
    for x, y, text, color in external:
        draw_box(ax, x, y, 2.5, 0.5, text, color, fontsize=8)
    
    for x in [3, 6.5, 9.5, 13]:
        draw_arrow(ax, x, 3.5, x, 3.0, '#F39C12', lw=1)
    
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'module_relations.png'),
                dpi=200, bbox_inches='tight', facecolor='#F8F9FA', edgecolor='none')
    plt.close()
    print("  [OK] module_relations.png")


def main():
    print("=" * 60)
    print("AI Media Agent — 架构图生成工具")
    print("=" * 60)
    print(f"\n输出目录: {OUTPUT_DIR}")
    print("\n开始生成架构图...\n")
    
    generate_system_architecture()
    generate_data_flow()
    generate_multi_language()
    generate_deployment()
    generate_module_relations()
    
    print("\n" + "=" * 60)
    print("所有架构图生成完成!")
    print("=" * 60)
    print("\n生成的文件:")
    for f in ['system_architecture.png', 'data_flow.png', 'multi_language_arch.png', 
              'deployment_arch.png', 'module_relations.png']:
        path = os.path.join(OUTPUT_DIR, f)
        size = os.path.getsize(path) / 1024
        print(f"  {f:30s} {size:8.1f} KB")
    print()


if __name__ == '__main__':
    main()
