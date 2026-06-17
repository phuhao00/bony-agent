"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import {
  User,
  apiListUsers,
  apiCreateUser,
  apiUpdateUser,
  apiDeleteUser,
  apiResetPassword,
  ROLE_LABELS,
  ROLE_COLORS,
} from "@/lib/auth";

// ── 子组件：角色徽章 ──────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[role] || "bg-gray-100 text-gray-600"}`}>
      {ROLE_LABELS[role] || role}
    </span>
  );
}

// ── 模态框：新建用户 ──────────────────────────────────

function CreateUserModal({ onClose, onSuccess }: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({ username: "", password: "", email: "", role: "viewer" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiCreateUser({ ...form, email: form.email || undefined });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalWrapper title="新建用户" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="用户名 *">
          <input type="text" required minLength={2} value={form.username}
            onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
            className={inputCls} placeholder="至少 2 个字符" />
        </Field>
        <Field label="密码 *">
          <input type="password" required minLength={6} value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
            className={inputCls} placeholder="至少 6 个字符" />
        </Field>
        <Field label="邮箱">
          <input type="email" value={form.email}
            onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
            className={inputCls} placeholder="选填" />
        </Field>
        <Field label="角色">
          <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
            className={inputCls}>
            <option value="viewer">只读</option>
            <option value="editor">编辑</option>
            <option value="admin">管理员</option>
          </select>
        </Field>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <ModalActions onClose={onClose} loading={loading} submitLabel="创建" />
      </form>
    </ModalWrapper>
  );
}

// ── 模态框：重置密码 ──────────────────────────────────

function ResetPasswordModal({ user, onClose, onSuccess }: {
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiResetPassword(user.id, password);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalWrapper title={`重置密码 — ${user.username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="新密码 *">
          <input type="password" required minLength={6} value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputCls} placeholder="至少 6 个字符" autoFocus />
        </Field>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <ModalActions onClose={onClose} loading={loading} submitLabel="重置" />
      </form>
    </ModalWrapper>
  );
}

// ── 主页面 ────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [toast, setToast] = useState("");
  const [page, setPage] = useState(0);
  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiListUsers(page * limit, limit);
      setUsers(data.users);
      setTotal(data.total);
    } catch {
      showToast("加载失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!isAdmin) { router.replace("/settings"); return; }
    fetchUsers();
  }, [isAdmin, fetchUsers, router]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function toggleActive(user: User) {
    try {
      await apiUpdateUser(user.id, { is_active: !user.is_active });
      showToast(user.is_active ? "账户已禁用" : "账户已启用");
      fetchUsers();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function changeRole(user: User, role: string) {
    try {
      await apiUpdateUser(user.id, { role });
      showToast("角色已更新");
      fetchUsers();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function deleteUser(user: User) {
    if (!confirm(`确认删除用户「${user.username}」？此操作不可撤销。`)) return;
    try {
      await apiDeleteUser(user.id);
      showToast("用户已删除");
      fetchUsers();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "删除失败");
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="h-screen overflow-auto bg-[#f8fafc]">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">用户管理</h1>
            <p className="text-gray-500 text-sm mt-1">共 {total} 个账户</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建用户
          </button>
        </div>

        {/* 表格 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
              加载中...
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">用户</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">角色</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">状态</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3.5">最后登录</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {u.username[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {u.username}
                              {isSelf && <span className="ml-2 text-xs text-blue-500 font-normal">(我)</span>}
                            </p>
                            <p className="text-xs text-gray-400">{u.email || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {isSelf ? (
                          <RoleBadge role={u.role} />
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                          >
                            <option value="viewer">只读</option>
                            <option value="editor">编辑</option>
                            <option value="admin">管理员</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          u.is_active
                            ? "bg-green-50 text-green-700"
                            : "bg-red-50 text-red-600"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-green-500" : "bg-red-400"}`} />
                          {u.is_active ? "正常" : "已禁用"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-400">
                        {u.last_login ? new Date(u.last_login).toLocaleString("zh-CN") : "从未"}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setResetTarget(u)}
                            className="text-xs text-gray-500 hover:text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                          >
                            重置密码
                          </button>
                          {!isSelf && (
                            <>
                              <button
                                onClick={() => toggleActive(u)}
                                className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                                  u.is_active
                                    ? "text-orange-500 hover:bg-orange-50"
                                    : "text-green-600 hover:bg-green-50"
                                }`}
                              >
                                {u.is_active ? "禁用" : "启用"}
                              </button>
                              <button
                                onClick={() => deleteUser(u)}
                                className="text-xs text-red-400 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                第 {page + 1} / {totalPages} 页
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => p - 1)} disabled={page === 0}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 模态框 */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { showToast("用户创建成功"); fetchUsers(); }}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={() => showToast("密码已重置")}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-2xl animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── 通用 UI 组件 ──────────────────────────────────────

const inputCls = "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all bg-white";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ModalWrapper({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, loading, submitLabel }: {
  onClose: () => void;
  loading: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onClose}
        className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
        取消
      </button>
      <button type="submit" disabled={loading}
        className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
        {loading && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}
