export type LegalAdvisorPreset = {
  label: string;
  recipe_id: string;
  params?: Record<string, unknown>;
  category: string;
};

export const LEGAL_ADVISOR_PRESETS: LegalAdvisorPreset[] = [
  {
    label: "劳动争议案例解读",
    recipe_id: "case.research",
    params: { topic: "劳动合同解除与经济补偿", context: "科技公司用工" },
    category: "case",
  },
  {
    label: "初创公司合规体检",
    recipe_id: "compliance.audit",
    params: { company_profile: "互联网 SaaS 公司，50 人规模", stage: "成长期" },
    category: "compliance",
  },
  {
    label: "个人信息保护法解读",
    recipe_id: "regulation.interpret",
    params: { regulation: "个人信息保护法", business_scenario: "用户数据采集" },
    category: "regulation",
  },
  {
    label: "股权投资协议审查",
    recipe_id: "contract.risk",
    params: { contract_type: "股权投资协议", party_role: "融资方" },
    category: "contract",
  },
  {
    label: "股权转让税务合规",
    recipe_id: "finance.legal",
    params: { topic: "股权转让税务合规", entity: "自然人股东" },
    category: "finance",
  },
];
