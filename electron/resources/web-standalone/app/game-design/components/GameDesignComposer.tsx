"use client";

import { AssistantComposer } from "@/app/components/AssistantComposer";
import { useTranslation } from "@/hooks/useTranslation";

export function GameDesignComposer({
  loading,
  onStreamText,
  onError,
  composerKey = 0,
  onReset,
  showReset = false,
}: {
  loading: boolean;
  onStreamText: (text: string) => void;
  onError: (msg: string) => void;
  composerKey?: number;
  onReset?: () => void;
  showReset?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <AssistantComposer
      key={composerKey}
      agentId="game_design_agent"
      loading={loading}
      onStreamText={onStreamText}
      onError={onError}
      title={t("assistantPage.freeChatTitle")}
      description={t("assistantPage.tools.gameDesign.composerDesc")}
      placeholder={t("assistantPage.tools.gameDesign.composerPlaceholder")}
      hint={t("assistantPage.freeChatHint")}
      onReset={onReset}
      showReset={showReset}
      resetLabel={t("assistantPage.newChat")}
    />
  );
}
