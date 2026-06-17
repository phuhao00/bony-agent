"use client";

import Link from "next/link";
import { useTranslation } from "@/hooks/useTranslation";

export type AssistantToolKey =
  | "productManager"
  | "legalAdvisor"
  | "adCampaign"
  | "businessPartnership"
  | "procurementAssistant"
  | "gameArt"
  | "gameDesign"
  | "programmer";

export function AssistantPageFooterHint({
  toolKey,
  extraNoteKey,
}: {
  toolKey: AssistantToolKey;
  extraNoteKey?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <p className="text-xs leading-relaxed text-[color:var(--label-tertiary)]">
        {t("assistantPage.footerIntro")}
        <Link href="/" className="mx-1 text-[color:var(--accent)] hover:underline">
          {t("assistantPage.footerMainChat")}
        </Link>
        {t("assistantPage.footerMiddle")}
        {t(`assistantPage.tools.${toolKey}.footerExamples`)}
        {t("assistantPage.footerSuffix")}
      </p>
      {extraNoteKey ? (
        <p className="text-xs text-[color:var(--label-tertiary)]">{t(extraNoteKey)}</p>
      ) : null}
    </div>
  );
}
