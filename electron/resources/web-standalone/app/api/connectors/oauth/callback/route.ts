import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * OAuth回调处理
 * 用户在第三方平台授权后，会重定向到这个URL
 * URL参数会包含: code, state 等
 */
export async function GET(req: NextRequest) {
    try {
        const searchParams = req.nextUrl.searchParams;
        const code = searchParams.get("code");
        const state = searchParams.get("state");
        const platform = searchParams.get("platform");
        const error = searchParams.get("error");

        // 如果用户拒绝授权
        if (error) {
            return new NextResponse(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>授权失败</title>
                    <style>
                        body {
                            font-family: system-ui, -apple-system, sans-serif;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 16px;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                            text-align: center;
                            max-width: 400px;
                        }
                        h1 { color: #ef4444; margin-bottom: 16px; }
                        p { color: #666; margin-bottom: 24px; }
                        button {
                            background: #ef4444;
                            color: white;
                            border: none;
                            padding: 12px 24px;
                            border-radius: 8px;
                            cursor: pointer;
                            font-weight: 600;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>❌ 授权失败</h1>
                        <p>用户取消了授权或授权过程中出现错误</p>
                        <button onclick="window.close()">关闭窗口</button>
                    </div>
                    <script>
                        // 通知父窗口授权失败
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'OAUTH_ERROR',
                                message: '用户取消了授权'
                            }, '*');
                        }
                        // 3秒后自动关闭
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
                </html>
            `, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        if (!code || !state || !platform) {
            throw new Error("Missing required parameters");
        }

        // 调用后端API，用授权码换取访问令牌
        const response = await fetch(
            `${BACKEND_URL}/connectors/oauth/callback`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    platform,
                    code,
                    state
                })
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Failed to complete OAuth");
        }

        // 授权成功页面
        return new NextResponse(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>授权成功</title>
                <style>
                    body {
                        font-family: system-ui, -apple-system, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 16px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        text-align: center;
                        max-width: 400px;
                    }
                    .icon {
                        font-size: 64px;
                        margin-bottom: 16px;
                    }
                    h1 { color: #10b981; margin-bottom: 16px; }
                    p { color: #666; margin-bottom: 8px; }
                    .username {
                        font-weight: 600;
                        color: #333;
                        font-size: 18px;
                        margin: 16px 0;
                    }
                    .loading {
                        display: inline-block;
                        width: 20px;
                        height: 20px;
                        border: 3px solid #f3f3f3;
                        border-top: 3px solid #667eea;
                        border-radius: 50%;
                        animation: spin 1s linear infinite;
                        margin-right: 8px;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">✅</div>
                    <h1>授权成功！</h1>
                    <p>已成功连接 ${data.account?.name || data.account?.username || '您的账号'}</p>
                    ${data.account?.username ? `<div class="username">@${data.account.username}</div>` : ''}
                    <p style="color: #10b981; margin-top: 24px;">
                        <span class="loading"></span>
                        正在返回...
                    </p>
                </div>
                <script>
                    // 通知父窗口授权成功
                    if (window.opener) {
                        window.opener.postMessage({
                            type: 'OAUTH_SUCCESS',
                            platform: '${platform}',
                            account: ${JSON.stringify(data.account || {})}
                        }, '*');
                    }
                    // 1秒后自动关闭
                    setTimeout(() => window.close(), 1500);
                </script>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });

    } catch (error: any) {
        console.error("OAuth callback error:", error);

        return new NextResponse(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>授权错误</title>
                <style>
                    body {
                        font-family: system-ui, -apple-system, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 16px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        text-align: center;
                        max-width: 400px;
                    }
                    h1 { color: #ef4444; margin-bottom: 16px; }
                    p { color: #666; margin-bottom: 24px; }
                    .error { background: #fee; padding: 12px; border-radius: 8px; margin: 16px 0; color: #c00; font-size: 14px; }
                    button {
                        background: #ef4444;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        cursor: pointer;
                        font-weight: 600;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ 授权失败</h1>
                    <p>连接平台时出现错误</p>
                    <div class="error">${error.message}</div>
                    <button onclick="window.close()">关闭窗口</button>
                </div>
                <script>
                    if (window.opener) {
                        window.opener.postMessage({
                            type: 'OAUTH_ERROR',
                            message: '${error.message}'
                        }, '*');
                    }
                    setTimeout(() => window.close(), 5000);
                </script>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}
