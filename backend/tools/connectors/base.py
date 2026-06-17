"""
Base Connector Class
所有平台连接器的基类
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
import time


class ConnectorStatus(Enum):
    """连接器状态"""
    DISCONNECTED = "disconnected"  # 未连接
    CONNECTED = "connected"        # 已连接
    EXPIRED = "expired"            # 会话过期
    ERROR = "error"                # 错误状态


@dataclass
class PublishResult:
    """发布结果"""
    success: bool
    platform: str
    post_id: Optional[str] = None
    url: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def to_dict(self):
        return {
            "success": self.success,
            "platform": self.platform,
            "post_id": self.post_id,
            "url": self.url,
            "error": self.error,
            "metadata": self.metadata or {}
        }


class BaseConnector(ABC):
    """
    基础连接器类
    所有平台连接器必须继承此类并实现相关方法
    """
    
    def __init__(self, platform_id: str, credentials: Optional[Dict[str, Any]] = None):
        self.platform_id = platform_id
        self.credentials = credentials or {}
        self.status = ConnectorStatus.DISCONNECTED
        self.last_check_time = 0
        self.account_info = {}
    
    def get_project_root(self) -> str:
        """获取项目根目录 (动态计算，并处理临时执行环境)"""
        import os
        # 1. 尝试基于文件路径计算 (开发/本地环境)
        # 本文件位于 backend/tools/connectors/base.py，跳三级到达项目根目录 (agent)
        file_based_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        
        # 2. 检查当前目录下是否有 .browsers (如果被复制到了 tmp 运行，可能 CWD 才是真正的项目根或者上级)
        if os.path.exists(os.path.join(os.getcwd(), ".browsers")):
            return os.getcwd()
            
        # 3. 如果 file_based_root 看起来像 tmp 目录，尝试使用 CWD
        if "tmp" in file_based_root.lower() or "agent_run" in file_based_root.lower():
            if os.path.exists(os.path.join(os.getcwd(), ".browsers")):
                return os.getcwd()
            # 尝试回退到硬编码的已知路径（如果是特定的用户环境）
            primary_path = "/Users/tutu/Documents/agent"
            if os.path.exists(primary_path):
                return primary_path
        
        return file_based_root
    
    @property
    @abstractmethod
    def platform_name(self) -> str:
        """平台名称"""
        pass
    
    @property
    @abstractmethod
    def required_credentials(self) -> List[str]:
        """
        需要的认证字段
        例如: ['cookie', 'sessdata'] 或 ['access_token', 'refresh_token']
        """
        pass
    
    @abstractmethod
    async def verify_connection(self) -> bool:
        """
        验证连接是否有效
        检查凭证是否过期，账号是否正常
        """
        pass
    
    @abstractmethod
    async def publish_content(
        self,
        content_type: str,  # 'image', 'video', 'text', 'mixed'
        title: str,
        content: str,
        media_urls: Optional[List[str]] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> PublishResult:
        """
        发布内容到平台
        
        Args:
            content_type: 内容类型
            title: 标题
            content: 正文/描述
            media_urls: 媒体文件URL列表
            options: 平台特定选项
            
        Returns:
            PublishResult: 发布结果
        """
        pass
    
    @abstractmethod
    async def get_account_info(self) -> Dict[str, Any]:
        """
        获取账号信息
        返回账号名、粉丝数等基本信息
        """
        pass
    
    def _detect_content_type(self, media_urls: List[str]) -> str:
        """
        根据媒体文件后缀智能检测内容类型
        """
        if not media_urls:
            return "text"
        
        video_exts = ['.mp4', '.mov', '.avi', '.flv', '.webm']
        image_exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        
        has_video = False
        has_image = False
        
        for url in media_urls:
            url_lower = url.lower()
            if any(ext in url_lower for ext in video_exts):
                has_video = True
                break  # 视频优先级最高
            if any(ext in url_lower for ext in image_exts):
                has_image = True
        
        if has_video:
            return "video"
        if has_image:
            return "image"
        return "text"

    def is_connected(self) -> bool:
        """检查是否已连接"""
        return self.status == ConnectorStatus.CONNECTED
    
    def update_credentials(self, credentials: Dict[str, Any]):
        """更新认证信息"""
        self.credentials = credentials
        self.status = ConnectorStatus.DISCONNECTED
    
    def validate_credentials(self) -> bool:
        """验证凭证是否完整"""
        for field in self.required_credentials:
            if field not in self.credentials or not self.credentials[field]:
                return False
        return True
    
    async def initialize(self) -> bool:
        """
        初始化连接器
        验证凭证并建立连接
        """
        if not self.validate_credentials():
            self.status = ConnectorStatus.ERROR
            return False
        
        try:
            is_valid = await self.verify_connection()
            if is_valid:
                self.status = ConnectorStatus.CONNECTED
                self.account_info = await self.get_account_info()
                self.last_check_time = time.time()
                return True
            else:
                self.status = ConnectorStatus.EXPIRED
                return False
        except Exception as e:
            self.status = ConnectorStatus.ERROR
            return False
    
    def to_dict(self) -> Dict[str, Any]:
        """导出为字典"""
        return {
            "platform_id": self.platform_id,
            "platform_name": self.platform_name,
            "status": self.status.value,
            "account_info": self.account_info,
            "last_check_time": self.last_check_time,
            "has_credentials": self.validate_credentials()
        }
