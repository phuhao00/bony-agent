#!/usr/bin/env node
/**
 * Interactive Browser Login Script - AppleScript Version
 * Opens a visible browser for user to login, then provides instructions for cookie extraction
 * 
 * Usage: node browser-login-simple.js <platform>
 * Example: node browser-login-simple.js douyin
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Platform configurations
const PLATFORMS = {
    douyin: {
        name: '抖音',
        loginUrl: 'https://creator.douyin.com/',
        requiredCookies: ['sessionid', 'passport_csrf_token', 'ttwid'],
    },
    bilibili: {
        name: 'Bilibili',
        loginUrl: 'https://member.bilibili.com/',
        requiredCookies: ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3'],
    },
    xiaohongshu: {
        name: '小红书',
        loginUrl: 'https://creator.xiaohongshu.com/',
        requiredCookies: ['web_session', 'a1', 'webId'],
    },
    weibo: {
        name: '微博',
        loginUrl: 'https://weibo.com/',
        requiredCookies: ['SUB', 'SUBP', 'XSRF-TOKEN'],
    },
    kuaishou: {
        name: '快手',
        loginUrl: 'https://cp.kuaishou.com/',
        requiredCookies: ['did', 'kuaishou.user_st', 'userId'],
    },
};

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CREDENTIALS_FILE = path.join(PROJECT_ROOT, 'platform_credentials.json');

async function openBrowserWithAppleScript(url) {
    const script = `
    tell application "Google Chrome"
        activate
        open location "${url}"
    end tell
    `;
    try {
        execSync(`osascript -e '${script}'`);
        return true;
    } catch (e) {
        // Try Safari as fallback
        try {
            execSync(`open -a "Safari" "${url}"`);
            return true;
        } catch (e2) {
            // Try default browser
            execSync(`open "${url}"`);
            return true;
        }
    }
}

function parseCookieString(cookieStr) {
    const cookies = {};
    cookieStr.split(';').forEach(item => {
        const [key, ...valueParts] = item.trim().split('=');
        if (key && valueParts.length > 0) {
            cookies[key.trim()] = valueParts.join('=').trim();
        }
    });
    return cookies;
}

async function runInteractiveLogin(platform) {
    const config = PLATFORMS[platform];
    if (!config) {
        console.error(`Unknown platform: ${platform}`);
        console.log('Available platforms:', Object.keys(PLATFORMS).join(', '));
        process.exit(1);
    }

    console.log(`\n🌐 正在打开 ${config.name} 登录页面...`);
    console.log(`📍 URL: ${config.loginUrl}\n`);

    // Open the browser
    await openBrowserWithAppleScript(config.loginUrl);

    console.log('✅ 浏览器已打开！请完成以下步骤：\n');
    console.log('   1. 在浏览器中完成登录（扫码或密码）');
    console.log('   2. 登录成功后，按 F12 或右键选择"检查"打开开发者工具');
    console.log('   3. 切换到 Application/应用程序 标签页');
    console.log('   4. 在左侧找到 Storage → Cookies');
    console.log('   5. 复制相关 Cookie 值\n');
    console.log(`📝 需要的 Cookie: ${config.requiredCookies.join(', ')}\n`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('🔑 请粘贴 Cookie 字符串（格式: key1=value1; key2=value2）:\n> ', (answer) => {
            rl.close();

            if (!answer.trim()) {
                console.log('❌ 未输入 Cookie，退出');
                process.exit(1);
            }

            const cookies = parseCookieString(answer);
            console.log(`\n📦 解析到 ${Object.keys(cookies).length} 个 Cookie`);

            // Check required cookies
            const foundRequired = config.requiredCookies.filter(name => cookies[name]);
            console.log(`✅ 找到关键 Cookie: ${foundRequired.join(', ') || '(无)'}`);

            if (foundRequired.length === 0) {
                console.log('⚠️ 警告: 未找到必需的 Cookie，登录可能不完整');
            }

            // Save to credentials file
            let allCredentials = {};
            if (fs.existsSync(CREDENTIALS_FILE)) {
                try {
                    allCredentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
                } catch (e) {
                    console.error('读取凭证文件失败:', e.message);
                }
            }

            allCredentials[platform] = cookies;
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(allCredentials, null, 2), 'utf-8');

            console.log(`\n✅ ${config.name} 登录凭证已保存！`);
            console.log('🎉 连接成功！\n');

            resolve();
        });
    });
}

// Main
const platform = process.argv[2];
if (!platform) {
    console.log('用法: node browser-login-simple.js <platform>');
    console.log('支持的平台:', Object.keys(PLATFORMS).join(', '));
    process.exit(1);
}

runInteractiveLogin(platform);
