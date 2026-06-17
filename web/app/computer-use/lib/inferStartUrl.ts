/** DuckDuckGo HTML 版：带稳定 id 的搜索框，比主站/Lite 更不易被可见性检测卡住 */
export const DDG_SEARCH_HTML = "https://html.duckduckgo.com/html/";

export function inferStartUrl(goal: string): { url: string; hint: string } {
  const g = goal.trim();
  const embedded = g.match(/https?:\/\/[^\s)\]'"<>]+/i);
  if (embedded?.[0]) {
    try {
      const u = new URL(embedded[0]);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return { url: u.href, hint: "已从描述中提取链接作为起点" };
      }
    } catch {
      /* fallthrough */
    }
  }
  const lower = g.toLowerCase();
  if (/b站|哔哩|bilibili/.test(g)) {
    return { url: "https://www.bilibili.com", hint: "哔哩哔哩首页" };
  }
  if (/知乎/.test(g)) {
    return { url: "https://www.zhihu.com", hint: "知乎首页" };
  }
  if (/github/.test(lower)) {
    return { url: "https://github.com", hint: "GitHub 首页" };
  }
  if (/微博/.test(g)) {
    return { url: "https://weibo.com", hint: "微博首页" };
  }
  if (/淘宝|天猫/.test(g)) {
    return { url: "https://www.taobao.com", hint: "淘宝首页" };
  }
  if (/京东/.test(g)) {
    return { url: "https://www.jd.com", hint: "京东首页" };
  }
  if (/google|谷歌/.test(lower)) {
    return { url: "https://www.google.com", hint: "Google 首页" };
  }
  if (/duckduckgo|\bddg\b|鸭鸭走/.test(lower)) {
    return {
      url: DDG_SEARCH_HTML,
      hint: "DuckDuckGo HTML 版（稳定搜索框，适合自动化）",
    };
  }
  if (/天气|搜索|查|搜一下|帮我找/.test(g)) {
    return {
      url: DDG_SEARCH_HTML,
      hint: "DuckDuckGo HTML（搜索/查资料；要说 Google 可在描述里写「谷歌」）",
    };
  }
  return {
    url: DDG_SEARCH_HTML,
    hint: "默认：DuckDuckGo HTML（可展开高级选项改为 Google 等）",
  };
}
