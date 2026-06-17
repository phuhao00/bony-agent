// Background Service Worker for automatic cookie syncing

const API_ENDPOINT = 'http://localhost:3000/api/connectors/connect';

// Platform configurations
const PLATFORMS = {
    'douyin.com': { id: 'douyin', requiredCookies: ['sessionid', 'passport_csrf_token'] },
    'bilibili.com': { id: 'bilibili', requiredCookies: ['SESSDATA', 'bili_jct'] },
    'xiaohongshu.com': { id: 'xiaohongshu', requiredCookies: ['web_session', 'a1'] },
    'weibo.com': { id: 'weibo', requiredCookies: ['SUB'] },
    'kuaishou.com': { id: 'kuaishou', requiredCookies: ['did', 'userId'] }
};

// Debounce map to prevent spamming the API
const lastSyncTime = {};
const SYNC_INTERVAL = 60000; // Sync at most once per minute per platform

// Detect platform from URL
function detectPlatform(url) {
    if (!url) return null;
    for (const [domain, config] of Object.entries(PLATFORMS)) {
        if (url.includes(domain)) {
            return { domain, ...config };
        }
    }
    return null;
}

// Get cookies for domain
async function getCookies(domain) {
    const hostname = domain.startsWith('.') ? domain.substring(1) : domain;
    const cookies = await chrome.cookies.getAll({ domain: hostname });

    // Normalize to map
    const cookieMap = {};
    cookies.forEach(c => {
        cookieMap[c.name] = c.value;
    });
    return cookieMap;
}

// Check and sync cookies
async function checkAndSync(tabId, url) {
    const platform = detectPlatform(url);
    if (!platform) return;

    // Check throttle
    const now = Date.now();
    if (lastSyncTime[platform.id] && (now - lastSyncTime[platform.id] < SYNC_INTERVAL)) {
        return;
    }

    try {
        // Get cookies
        const cleanDomain = platform.domain.replace('www.', '').replace('.com', '');
        const cookies = await getCookies(cleanDomain); // broad search

        // Check required
        const hasRequired = platform.requiredCookies.every(name => Object.keys(cookies).some(k => k.includes(name) || name.includes(k)));
        // (Simplistic check, better to be exact match but domains vary)

        // Exact match try
        const cookieMap = {};
        const exactCookies = await chrome.cookies.getAll({}); // Get all and filter might be heavy? 
        // fast path:
        const domainCookies = await chrome.cookies.getAll({ domain: platform.domain });
        domainCookies.forEach(c => cookieMap[c.name] = c.value);

        // Secondary check for root domain cookies e.g. .douyin.com
        const rootCookies = await chrome.cookies.getAll({ domain: '.' + platform.domain });
        rootCookies.forEach(c => cookieMap[c.name] = c.value);

        // Verify requirements
        const missing = platform.requiredCookies.filter(name => !cookieMap[name]);
        if (missing.length > 0) {
            // Not logged in fully
            return;
        }

        console.log(`[Cookie Saver] Detected login for ${platform.id}, syncing...`);

        // Send to API
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                platform: platform.id,
                credentials: cookieMap
            })
        });

        if (response.ok) {
            console.log(`[Cookie Saver] Synced ${platform.id} success`);
            lastSyncTime[platform.id] = now;

            // Optional: Show notification?
            // chrome.action.setBadgeText({ text: 'OK', tabId });
            // chrome.action.setBadgeBackgroundColor({ color: '#4caf50', tabId });
        }

    } catch (e) {
        console.error('[Cookie Saver] Sync failed:', e);
    }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        checkAndSync(tabId, tab.url);
    }
});

// Listen for cookie changes? (Might be too aggressive, tab updates usually sufficient for login flow)
