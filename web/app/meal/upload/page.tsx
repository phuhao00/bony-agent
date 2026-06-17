"use client";

import { MealRecognitionCard } from "@/components/MealRecognitionCard";
import { MealMobileShell, mealTouchButtonClass } from "@/components/MealMobileShell";
import { MealMemberPicker, type MealMember } from "@/components/MealMemberPicker";
import { parseJsonResponse } from "@/lib/apiJson";
import {
  MAX_MEAL_UPLOAD_IMAGES,
  appendMealFiles,
  dedupeMealFiles,
  type MealRecognizedPayload,
  type MealSavedRecord,
} from "@/lib/mealUpload";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

function UploadInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [employeeName, setEmployeeName] = useState("");
  const [pickedMember, setPickedMember] = useState<MealMember | null>(null);
  const [mealDate, setMealDate] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [msg, setMsg] = useState("");
  const [resultVariant, setResultVariant] = useState<
    "success" | "warning" | "error" | null
  >(null);
  const [recognized, setRecognized] = useState<MealRecognizedPayload | null>(null);
  const [savedRecord, setSavedRecord] = useState<MealSavedRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualAmount, setManualAmount] = useState("");
  const [manualAmountHint, setManualAmountHint] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const urls = selectedFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [selectedFiles]);

  const parsedManualAmount = useMemo(() => {
    const raw = manualAmount.trim().replace(/[^\d.]/g, "");
    if (!raw) return null;
    const v = Number.parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [manualAmount]);

  const canSubmit =
    selectedFiles.length > 0 &&
    !busy &&
    (Boolean(token) || employeeName.trim().length > 0);

  const clearResult = () => {
    setResultVariant(null);
    setRecognized(null);
    setSavedRecord(null);
  };

  const pickFile = () => {
    setMsg("");
    clearResult();
    fileRef.current?.click();
  };

  const clearFiles = () => {
    setSelectedFiles([]);
    setMsg("");
    clearResult();
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFilesPicked = async (list: FileList | null) => {
    if (!list?.length) return;
    const { files: picked, skipped } = await dedupeMealFiles(Array.from(list));
    if (!picked.length) {
      setMsg("❌ 所选图片内容重复，请换一张后重试");
      return;
    }
    const parts: string[] = [];
    if (list.length > MAX_MEAL_UPLOAD_IMAGES) {
      parts.push(`最多 ${MAX_MEAL_UPLOAD_IMAGES} 张，已保留前 ${picked.length} 张`);
    }
    if (skipped > 0) {
      parts.push(`已忽略 ${skipped} 张重复图`);
    }
    setMsg(parts.length ? `ℹ️ ${parts.join("；")}` : "");
    setSelectedFiles(picked);
    clearResult();
  };

  const upload = async () => {
    if (selectedFiles.length === 0) {
      setMsg("❌ 请先选择餐费截图（最多 3 张）");
      return;
    }
    if (!token && !employeeName.trim()) {
      setMsg("❌ 请填写姓名（与飞书显示一致）");
      return;
    }
    setBusy(true);
    setManualAmountHint(false);
    setMsg(`🔍 正在识别 ${selectedFiles.length} 张截图并上传…`);
    clearResult();
    try {
      const fd = new FormData();
      appendMealFiles(fd, selectedFiles);
      fd.append("overwrite", overwrite ? "true" : "false");
      if (token) {
        fd.append("token", token);
      } else {
        const ename = (pickedMember?.name || employeeName).trim();
        fd.append("employee_name", ename);
        if (pickedMember?.open_id) {
          fd.append("employee_id", pickedMember.open_id);
        }
        if (mealDate.trim()) fd.append("meal_date", mealDate.trim());
      }
      if (overwrite && mealDate.trim()) {
        fd.append("meal_date", mealDate.trim());
      }
      if (parsedManualAmount != null) {
        fd.append("manual_amount", String(parsedManualAmount));
      }
      const res = await fetch("/api/meal/upload", { method: "POST", body: fd });
      const d = await parseJsonResponse<{
        status?: string;
        error?: string;
        detail?: string;
        message?: string;
        skipped_duplicates?: number;
        record?: MealSavedRecord;
        recognized?: MealRecognizedPayload;
      }>(res);
      const rec = d.recognized || null;
      setRecognized(rec);
      const dupNote =
        (d.skipped_duplicates || 0) > 0
          ? `（已跳过 ${d.skipped_duplicates} 张重复图）`
          : "";

      if (d.status === "created" || d.status === "updated") {
        const r = d.record;
        setSavedRecord(r || null);
        setResultVariant("success");
        const pending = r?.pending_review ? " · 待处理" : "";
        setMsg(
          `✅ 已${d.status === "updated" ? "更新" : "登记"}：${r?.employee_name || employeeName} · ${r?.meal_date} · ¥${r?.amount}${pending}${dupNote}`,
        );
        setManualAmount("");
        setManualAmountHint(false);
        clearFiles();
      } else if (d.status === "unchanged") {
        setSavedRecord(d.record || null);
        setResultVariant("warning");
        setMsg(`ℹ️ ${d.message || "图片与当日记录重复"}${dupNote}`);
      } else if (d.status === "exists") {
        setSavedRecord(d.record || null);
        setResultVariant("warning");
        setMsg(
          `⚠️ 当天已有记录 ¥${d.record?.amount}。勾选「覆盖当天记录」后点「确认上传」即可更新。`,
        );
      } else {
        setResultVariant("error");
        setRecognized(rec || { error: d.error || d.detail || "识别失败" });
        setManualAmountHint(true);
        const manualTip = parsedManualAmount
          ? ""
          : " 可在下方手动填写金额后再次点击「确认上传」。";
        setMsg(`❌ ${d.error || d.detail || "识别失败"}${manualTip}`);
      }
    } catch (e) {
      setMsg(`❌ ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const useTokenMode = Boolean(token);

  const historyHref = useMemo(() => {
    const q = new URLSearchParams();
    if (token) q.set("token", token);
    else if (employeeName.trim()) q.set("name", employeeName.trim());
    const s = q.toString();
    return s ? `/meal/upload/history?${s}` : "";
  }, [token, employeeName]);

  const inputClass =
    "border rounded-lg px-3 py-2.5 text-base sm:text-sm bg-transparent w-full min-h-11";

  return (
    <MealMobileShell>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-2 mb-1">
        <h1 className="text-xl sm:text-lg font-bold leading-snug">🧾 餐费截图上传</h1>
        {historyHref && (
          <Link
            href={historyHref}
            className="inline-flex items-center justify-center min-h-10 px-4 rounded-lg text-sm font-medium text-indigo-600 bg-indigo-500/10 sm:bg-transparent sm:px-0 sm:min-h-0 sm:justify-start hover:underline shrink-0"
          >
            我的记录 →
          </Link>
        )}
      </header>
      <p className="text-sm opacity-70 mb-5 sm:mb-6 leading-relaxed">
        {useTokenMode
          ? `飞书个人链接 · 单次最多 ${MAX_MEAL_UPLOAD_IMAGES} 张 · 可自动识别或手动填金额`
          : `填写信息 → 选择截图 → 确认上传（识别失败可手动填金额）`}
      </p>

      {!useTokenMode && (
        <div className="space-y-4 mb-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs opacity-70">
              姓名 <span className="text-red-500">*</span>
            </span>
            <MealMemberPicker
              value={employeeName}
              onChange={(n, m) => {
                setEmployeeName(n);
                setPickedMember(m);
              }}
              placeholder="搜索群成员姓名"
            />
          </div>
          <label className="text-xs opacity-70 flex flex-col gap-1.5">
            餐费日期（可选，留空则按今日登记；须与票据日期一致）
            <input
              type="date"
              value={mealDate}
              onChange={(e) => setMealDate(e.target.value)}
              className={inputClass}
              style={{ borderColor: "var(--separator-subtle)" }}
            />
          </label>
          <label className="text-sm flex items-center gap-3 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="shrink-0"
            />
            <span>覆盖当天已有记录</span>
          </label>
        </div>
      )}

      {useTokenMode && (
        <label className="text-sm flex items-center gap-3 cursor-pointer py-1 mb-4">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="shrink-0"
          />
          <span>覆盖当天已有记录</span>
        </label>
      )}

      {useTokenMode && !token && (
        <p className="text-sm text-red-500 mb-4">缺少有效令牌，请从飞书重新打开链接。</p>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={busy || (useTokenMode && !token)}
          onClick={pickFile}
          className={mealTouchButtonClass(false)}
          style={{ borderColor: "var(--separator-subtle)" }}
        >
          {selectedFiles.length
            ? `重新选择（已选 ${selectedFiles.length}/${MAX_MEAL_UPLOAD_IMAGES}）`
            : `1. 选择餐费截图（最多 ${MAX_MEAL_UPLOAD_IMAGES} 张）`}
        </button>

        {selectedFiles.length > 0 && (
          <div
            className="rounded-xl border p-3 space-y-3"
            style={{ borderColor: "var(--separator-subtle)" }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {selectedFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="space-y-1">
                  <p className="text-xs opacity-70 break-all line-clamp-2">{f.name}</p>
                  {previewUrls[i] && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={previewUrls[i]}
                      alt={`截图 ${i + 1}`}
                      className="max-h-40 w-full object-contain rounded-lg bg-black/5"
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={clearFiles}
              disabled={busy}
              className="min-h-10 text-sm opacity-60 hover:opacity-100 underline touch-manipulation"
            >
              清空已选图片
            </button>
          </div>
        )}

        <div
          className={`rounded-xl border p-3 space-y-2 ${
            manualAmountHint ? "border-amber-400/80 bg-amber-500/5" : ""
          }`}
          style={
            manualAmountHint
              ? undefined
              : { borderColor: "var(--separator-subtle)" }
          }
        >
          <label className="text-xs opacity-70 flex flex-col gap-1.5">
            手动填写金额（元，识别失败时填写）
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              placeholder="例如 28.50"
              disabled={busy}
              className={inputClass}
              style={{ borderColor: "var(--separator-subtle)" }}
            />
          </label>
          <p className="text-[11px] opacity-55 leading-relaxed">
            自动识别失败时，填写实付金额后再次点「确认上传」，记录会标为待处理。
          </p>
        </div>

        <button
          type="button"
          disabled={!canSubmit || (useTokenMode && !token)}
          onClick={upload}
          className={mealTouchButtonClass(true)}
        >
          {busy ? "上传中…" : "2. 确认上传"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />

      {msg && (
        <p className="text-sm mt-4 whitespace-pre-wrap break-words leading-relaxed">
          {msg}
        </p>
      )}

      {resultVariant && (recognized || savedRecord) && (
        <MealRecognitionCard
          title={
            resultVariant === "success"
              ? "📋 识别结果（已入库）"
              : resultVariant === "warning"
                ? "📋 识别结果（与已有记录冲突）"
                : "📋 识别说明"
          }
          recognized={recognized}
          record={savedRecord}
          variant={resultVariant}
        />
      )}

      {selectedFiles.length === 0 && !msg && (
        <p className="text-xs opacity-50 mt-3 leading-relaxed">
          可一次选多张截图，金额分别识别后合计；商家以逗号连接。未识别到日期或与登记日不一致将标红待处理。
        </p>
      )}
      <p className="text-xs opacity-50 mt-6 leading-relaxed">
        也可在飞书私聊机器人直接发送截图，或发送「餐费」获取上传与历史链接。
        {historyHref && (
          <>
            {" "}
            <Link href={historyHref} className="text-indigo-600 hover:underline">
              查看我的提交记录
            </Link>
          </>
        )}
      </p>
    </MealMobileShell>
  );
}

export default function MealUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="meal-mobile-page page-canvas min-h-[100dvh] flex items-center justify-center p-6">
          加载中…
        </div>
      }
    >
      <UploadInner />
    </Suspense>
  );
}
