"""
Mock Connector
模拟连接器 - 用于未实现真实API的平台
"""

import time
from typing import Dict, Any, List
from .base import BaseConnector, PublishResult


class MockConnector(BaseConnector):
    """
    通用模拟连接器
    在真实平台API未实现时使用
    """
    
    def __init__(self, platform_id: str, platform_name: str, credentials: Dict[str, Any] = None):
        super().__init__(platform_id, credentials)
        self._platform_name = platform_name
    
    @property
    def platform_name(self) -> str:
        return self._platform_name
    
    @property
    def required_credentials(self) -> List[str]:
        return ['access_token']  # 通用token
    
    async def verify_connection(self) -> bool:
        """模拟验证"""
        # 如果有凭证就认为已连接
        return bool(self.credentials.get('access_token'))
    
    async def get_account_info(self) -> Dict[str, Any]:
        """返回模拟账号信息"""
        return {
            'username': f'User_{self.platform_id}',
            'platform': self.platform_id,
            'status': 'mock'
        }
    
    async def publish_content(
        self,
        content_type: str,
        title: str,
        content: str,
        media_urls: List[str] = None,
        options: Dict[str, Any] = None
    ) -> PublishResult:
        """模拟发布"""
        # 模拟发布延迟
        import asyncio
        await asyncio.sleep(0.5)
        
        post_id = f"{self.platform_id}_{int(time.time())}"
        
        return PublishResult(
            success=True,
            platform=self.platform_id,
            post_id=post_id,
            url=f"https://mock.{self.platform_id}.com/post/{post_id}",
            metadata={
                'type': content_type,
                'mode': 'mock',
                'title': title,
                'media_count': len(media_urls) if media_urls else 0
            }
        )
