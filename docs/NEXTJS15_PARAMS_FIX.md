# Next.js 15 Params修复

## 问题

在Next.js 15中，动态路由的`params`从同步对象改为了Promise，需要先await才能访问。

## 错误信息

```
Error: Route "/api/connectors/oauth/authorize/[platform]" used `params.platform`. 
`params` is a Promise and must be unwrapped with `await` or `React.use()` 
before accessing its properties.
```

## 修复

### 之前（错误）❌
```typescript
export async function GET(
    req: NextRequest,
    { params }: { params: { platform: string } }
) {
    const platform = params.platform;  // ❌ 错误
    // ...
}
```

### 现在（正确）✅
```typescript
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ platform: string }> }  // ← Promise类型
) {
    const { platform } = await params;  // ← await解包
    // ...
}
```

## 已修复的文件

✅ `web/app/api/connectors/oauth/authorize/[platform]/route.ts`
✅ `web/app/api/connectors/qrcode/[platform]/route.ts`

## 参考

- https://nextjs.org/docs/messages/sync-dynamic-apis
- Next.js 15 Migration Guide

现在OAuth授权功能应该可以正常工作了！🎉
