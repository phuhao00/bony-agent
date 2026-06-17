"use client";

import { MealReceiptWorkbench } from "@/components/meal/MealReceiptWorkbench";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function MealRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const embed = params.get("embed") === "1";

  useEffect(() => {
    if (!embed) {
      router.replace("/lark-cli?tab=meal");
    }
  }, [embed, router]);

  if (!embed) {
    return (
      <div className="page-canvas min-h-[40vh] flex items-center justify-center p-6 text-sm opacity-60">
        正在打开飞书工作台…
      </div>
    );
  }

  return <MealReceiptWorkbench embedded />;
}

export default function MealPage() {
  return (
    <Suspense
      fallback={
        <div className="page-canvas min-h-[40vh] flex items-center justify-center p-6 text-sm opacity-60">
          加载中…
        </div>
      }
    >
      <MealRedirect />
    </Suspense>
  );
}
