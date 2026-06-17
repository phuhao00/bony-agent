// Platform configurations
const PLATFORMS = {
    'douyin.com': {
        name: '抖音',
        id: 'douyin',
        requiredCookies: ['sessionid', 'passport_csrf_token', 'ttwid', 'sid_guard']
    },
    'bilibili.com': {
        name: 'Bilibili',
        id: 'bilibili',
        requiredCookies: ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3']
    },
    'xiaohongshu.com': {
        name: '小红书',
        id: 'xiaohongshu',
        requiredCookies: ['web_session', 'a1', 'webId']
    },
    'weibo.com': {
        name: '微博',
        id: 'weibo',
        requiredCookies: ['SUB', 'SUBP']
    },
    'kuaishou.com': {
        name: '快手',
        id: 'kuaishou',
        requiredCookies: ['did', 'userId']
    }
};

let currentPlatform = null;
let currentUrl = '';

// Detect platform from URL
function detectPlatform(url) {
    for (const [domain, config] of Object.entries(PLATFORMS)) {
        if (url.includes(domain)) {
            return { domain, ...config };
        }
    }
    return null;
}

// Get all cookies for the current tab
async function getCookiesForTab(url) {
    const urlObj = new URL(url);
    const cookies = await chrome.cookies.getAll({ domain: urlObj.hostname.replace('www.', '') });

    // Also get cookies without www prefix
    const baseDomain = urlObj.hostname.replace('www.', '').split('.').slice(-2).join('.');
    const moreCookies = await chrome.cookies.getAll({ domain: baseDomain });

    // Merge and deduplicate
    const cookieMap = {};
    [...cookies, ...moreCookies].forEach(c => {
        cookieMap[c.name] = c.value;
    });

    return cookieMap;
}

// Update UI based on current tab
async function updateUI() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentUrl = tab.url;

    const platform = detectPlatform(currentUrl);
    const platformName = document.getElementById('platformName');
    const platformStatus = document.getElementById('platformStatus');
    const saveBtn = document.getElementById('saveBtn');

    if (platform) {
        currentPlatform = platform;
        platformName.textContent = `${platform.name}`;

        // Check if logged in
        const cookies = await getCookiesForTab(currentUrl);
        const hasRequired = platform.requiredCookies.some(name => cookies[name]);

        if (hasRequired) {
            platformStatus.textContent = '✅ 已检测到登录状态';
            saveBtn.disabled = false;
            saveBtn.textContent = '保存 Cookie';
        } else {
            platformStatus.textContent = '⚠️ 请先登录';
            saveBtn.disabled = true;
            saveBtn.textContent = '未登录';
        }
    } else {
        currentPlatform = null;
        platformName.textContent = '未知平台';
        platformStatus.textContent = '请访问支持的平台';
        saveBtn.disabled = true;
        saveBtn.textContent = '不支持';
    }
}

// Show message
function showMessage(text, type) {
    const msg = document.getElementById('message');
    msg.textContent = text;
    msg.className = `message show ${type}`;
}

// Save cookies
async function saveCookies() {
    if (!currentPlatform) return;

    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';

    try {
        const cookies = await getCookiesForTab(currentUrl);

        // Prepare data for API
        const data = {
            platform: currentPlatform.id,
            credentials: cookies
        };

        // Send to local server
        let apiSuccess = false;
        try {
            const response = await fetch('http://localhost:3000/api/connectors/connect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    apiSuccess = true;
                }
            }
        } catch (netError) {
            console.log('API connection failed, falling back to file download');
        }

        if (apiSuccess) {
            saveBtn.textContent = '✅ 已同步';
            saveBtn.className = 'save-btn success';
            showMessage(`${currentPlatform.name} 登录成功！Cookie 已自动同步到 Agent。`, 'success');
        } else {
            // Fallback: Download file

            // Read existing credentials or create new
            const result = await chrome.storage.local.get(['credentials']);
            const credentials = result.credentials || {};

            // Update with new cookies
            credentials[currentPlatform.id] = cookies;

            // Save to storage
            await chrome.storage.local.set({ credentials });

            // Download as file
            const blob = new Blob([JSON.stringify(credentials, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            await chrome.downloads.download({
                url: url,
                filename: 'platform_credentials.json',
                saveAs: false,
                conflictAction: 'overwrite'
            });

            saveBtn.textContent = '已保存(本地)';
            showMessage('无法连接服务器，已下载凭证文件。请手动移动文件到项目根目录。', 'error');
        }

    } catch (error) {
        console.error('Save error:', error);
        saveBtn.textContent = '保存失败';
        showMessage('保存失败: ' + error.message, 'error');
    }

    setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存 Cookie';
        saveBtn.className = 'save-btn';
    }, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    updateUI();
    document.getElementById('saveBtn').addEventListener('click', saveCookies);
});
