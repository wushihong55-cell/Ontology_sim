import type { SkillId, OdlSection } from '../types'

/* ─── Tool Schema Types ──────────────────────────────────────────────────── */

export type AnthropicTool = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type OpenAiTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export type SkillDefinition = {
  id: SkillId
  label: string
  description: string
  icon: string
  buildSystemPrompt: (schemaJson: string, odlYaml?: string) => string
  anthropicTools: AnthropicTool[]
  openAiTools: OpenAiTool[]
}

/* ─── Shared Input Schemas ───────────────────────────────────────────────── */

const ENTITY_TYPE_ENUM = ['physical', 'abstract', 'event', 'activity', 'agent', 'role', 'temporal', 'spatial']
const PROPERTY_TYPE_ENUM = ['string', 'number', 'date', 'boolean', 'enum', 'reference']
const CARDINALITY_ENUM = ['1:1', '1:N', 'N:M', '0..1']

const propertyItemSchema = {
  type: 'object',
  properties: {
    name:        { type: 'string',  description: '属性英文标识（驼峰命名）' },
    nameZh:      { type: 'string',  description: '属性中文名称（可选）' },
    type:        { type: 'string',  enum: PROPERTY_TYPE_ENUM },
    required:    { type: 'boolean', description: '是否为必填字段' },
    description: { type: 'string',  description: '属性描述' },
  },
  required: ['name', 'type'],
}

const ADD_ENTITY_SCHEMA = {
  type: 'object' as const,
  properties: {
    name:        { type: 'string', description: '实体英文标识，驼峰命名，如 Customer、LoanOfficer' },
    label:       { type: 'string', description: '实体中文名，如 客户、客户经理' },
    description: { type: 'string', description: '实体在业务领域中的语义描述' },
    entityType:  { type: 'string', enum: ENTITY_TYPE_ENUM },
    color:       { type: 'string', description: '节点颜色十六进制（可省略）' },
    properties:  { type: 'array',  items: propertyItemSchema, description: '实体初始属性列表（可省略）' },
  },
  required: ['name', 'label'],
}

const ADD_RELATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    name:        { type: 'string', description: '关系英文标识，如 hasContract、belongsTo' },
    sourceLabel: { type: 'string', description: '源实体名称（中/英文均可）' },
    targetLabel: { type: 'string', description: '目标实体名称（中/英文均可）' },
    cardinality: { type: 'string', enum: CARDINALITY_ENUM },
    description: { type: 'string', description: '关系的业务含义' },
  },
  required: ['name', 'sourceLabel', 'targetLabel'],
}

const ADD_PROPERTY_SCHEMA = {
  type: 'object' as const,
  properties: {
    entityName:  { type: 'string', description: '目标实体名称（中/英文均可）' },
    name:        { type: 'string', description: '属性英文标识' },
    nameZh:      { type: 'string', description: '属性中文名（可选）' },
    type:        { type: 'string', enum: PROPERTY_TYPE_ENUM },
    required:    { type: 'boolean' },
    description: { type: 'string', description: '属性描述' },
  },
  required: ['entityName', 'name', 'type'],
}

const CYPHER_NOTE_SCHEMA = {
  type: 'object' as const,
  properties: {
    description: { type: 'string', description: '建议说明' },
    cypher:      { type: 'string', description: 'Cypher 语句示例（仅供参考）' },
  },
  required: ['description', 'cypher'],
}

/* ─── Tool Arrays (Anthropic & OpenAI-compat) ───────────────────────────── */

function makeTools(defs: Array<{ name: string; desc: string; schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] } }>) {
  return {
    anthropic: defs.map(({ name, desc, schema }): AnthropicTool => ({
      name,
      description: desc,
      input_schema: schema,
    })),
    openai: defs.map(({ name, desc, schema }): OpenAiTool => ({
      type: 'function',
      function: { name, description: desc, parameters: schema },
    })),
  }
}

const designToolDefs = [
  { name: 'suggest_add_entity',   desc: '建议新增实体概念（显示为待审批卡片，用户决定是否应用）', schema: ADD_ENTITY_SCHEMA },
  { name: 'suggest_add_relation', desc: '建议新增实体间关系',                                   schema: ADD_RELATION_SCHEMA },
  { name: 'suggest_add_property', desc: '建议为现有实体新增属性',                               schema: ADD_PROPERTY_SCHEMA },
  { name: 'suggest_cypher_note',  desc: '给出 Cypher 结构建议（不可自动应用，仅供参考）',        schema: CYPHER_NOTE_SCHEMA },
]

const { anthropic: DESIGN_TOOLS_ANTHROPIC, openai: DESIGN_TOOLS_OPENAI } = makeTools(designToolDefs)

const ODL_SECTION_ENUM: OdlSection[] = [
  'concepts', 'metrics', 'disambiguation_rules', 'query_templates', 'data_quality_rules',
]

const SUGGEST_ODL_UPDATE_SCHEMA = {
  type: 'object' as const,
  properties: {
    description: { type: 'string', description: '本次 ODL 更新的业务说明' },
    section: {
      type: 'string',
      enum: ODL_SECTION_ENUM,
      description: '要更新的 ODL 节名称',
    },
    content: {
      type: 'string',
      description: '该节下所有条目的完整 YAML（以 "  - " 开头的多行文本，不含节名行）',
    },
  },
  required: ['description', 'section', 'content'],
}

const odlToolDefs = [
  { name: 'suggest_odl_update', desc: '建议更新 ODL 知识层的某个节（结果显示为待审批卡片）', schema: SUGGEST_ODL_UPDATE_SCHEMA },
]

const { anthropic: ODL_TOOLS_ANTHROPIC, openai: ODL_TOOLS_OPENAI } = makeTools(odlToolDefs)

/* ─── ODP System Prompt Fragment ─────────────────────────────────────────── */

const ODP_PROMPT = `
## 本体设计模式库（ODP）
优先复用以下模式，避免重复建模：
- **Organization-Role-Person**：组织/岗位/人员建模
- **Process-Activity-Actor**：业务流程/活动/参与方
- **Risk-Control-Indicator**：风险/内控措施/风险指标
- **Policy-Rule-Exception**：制度/规则/例外情形
- **KPI-Measurement-Target**：绩效指标/计量方式/目标值
- **Document-Approval-Authority**：业务单据/审批环节/审批权限
- **Event-Trigger-Action**：事件/触发条件/响应动作
`

/* ─── Skill Definitions ──────────────────────────────────────────────────── */

export const SKILL_DEFINITIONS: Record<SkillId, SkillDefinition> = {
  'free-chat': {
    id: 'free-chat',
    label: '自由对话',
    description: '与 AI 自由探讨本体设计问题',
    icon: '💬',
    buildSystemPrompt: (schemaJson) =>
      `你是一位专业的本体设计助手，帮助用户分析和改进领域本体模型。\n\n当前 Schema：\n\`\`\`json\n${schemaJson}\n\`\`\`\n\n请使用中文回答，分析时结合上方 Schema 上下文。`,
    anthropicTools: [],
    openAiTools: [],
  },

  'ontology-design': {
    id: 'ontology-design',
    label: '本体设计辅助',
    description: '结合业务场景给出可直接应用的实体/关系建议',
    icon: '🧠',
    buildSystemPrompt: (schemaJson) =>
      `你是一位资深的企业本体工程师，将业务场景转化为严谨的本体模型。\n${ODP_PROMPT}\n## 当前 Schema\n\`\`\`json\n${schemaJson}\n\`\`\`\n\n## 要求\n1. 优先扩展已有实体/关系，避免重复\n2. 每个建议必须通过工具函数提出，不要只用文字描述\n3. 给出简短的业务理由\n4. 全部建议完成后，用中文总结整体逻辑\n\n你的建议将显示为待审批卡片，由用户决定是否应用。`,
    anthropicTools: DESIGN_TOOLS_ANTHROPIC,
    openAiTools: DESIGN_TOOLS_OPENAI,
  },

  'consistency-check': {
    id: 'consistency-check',
    label: '一致性检查',
    description: '检查 Schema 的设计问题并给出修复建议',
    icon: '✅',
    buildSystemPrompt: (schemaJson) =>
      `你是本体工程质量审核专家。请对以下 Schema 进行全面检查。\n\n\`\`\`json\n${schemaJson}\n\`\`\`\n\n## 检查维度\n1. 结构完整性：孤立节点、缺少关键关系、缺少必填属性\n2. 命名规范：英文标识驼峰、中文名清晰\n3. 业务语义：关系方向和基数是否合理\n4. 设计模式：是否有可用 ODP 替代的冗余设计\n5. 可扩展性：是否有明显设计瓶颈\n\n输出格式：发现问题 → 影响分析 → 修复建议，标注严重程度（高/中/低），使用中文。`,
    anthropicTools: [],
    openAiTools: [],
  },

  'doc-extract': {
    id: 'doc-extract',
    label: '文档提炼',
    description: '从业务文档中提炼 CQ 和实体建议',
    icon: '📄',
    buildSystemPrompt: (schemaJson) =>
      `你是擅长从业务文档提炼本体元素的专家，使用 Competency Questions（CQ）驱动方法。\n${ODP_PROMPT}\n## 当前已有 Schema\n\`\`\`json\n${schemaJson}\n\`\`\`\n\n## 工作流程\n1. 分析用户提供的文档，列出 5-10 个核心 CQ（本体应能回答的业务问题）\n2. 从 CQ 反推所需实体、关系、属性，优先与已有 schema 融合\n3. 通过工具函数提出结构化建议\n\n先输出 CQ 列表，再逐一调用工具，最后中文总结。`,
    anthropicTools: DESIGN_TOOLS_ANTHROPIC,
    openAiTools: DESIGN_TOOLS_OPENAI,
  },

  'odl-edit': {
    id: 'odl-edit',
    label: 'ODL 编辑',
    description: '根据当前 Schema 和业务意图，生成或优化 ODL 知识层各节内容',
    icon: '📖',
    buildSystemPrompt: (schemaJson, odlYaml) =>
      `你是企业经营知识层（ODL）专家，帮助用户填写和优化 ODL 各知识节。\nODL 是 LLM ↔ Query Planner 的知识中枢，让 LLM 理解业务概念/指标/规则/意图，而非直接面对 Neo4j Schema。\n\n## 当前 Schema（执行层参考）\n\`\`\`json\n${schemaJson}\n\`\`\`\n\n## 当前 ODL（待优化）\n\`\`\`yaml\n${odlYaml ?? '（尚未填写）'}\n\`\`\`\n\n## ODL 节说明\n- **concepts**：业务概念 → Schema 节点的映射，含同义词、描述\n- **metrics**：业务指标定义，含计算公式和字段映射\n- **disambiguation_rules**：歧义消解规则，含触发关键词和处理方式\n- **query_templates**：意图 → Cypher 模板映射，供 Query Planner 使用\n- **data_quality_rules**：字段质量规则\n\n## 工作要求\n1. 每次只更新一个节，通过工具函数 suggest_odl_update 提交，不要直接输出完整 YAML\n2. content 字段须为合法 YAML 列表条目（以 "  - " 缩进开头的多行文本）\n3. 优先复用已有条目 id，concepts 的 maps_to_node 须与 Schema 节点 name 精确匹配\n4. 全部建议完成后用中文总结改动逻辑\n\n你的建议将显示为待审批卡片，由用户决定是否合并到 ODL 编辑器。`,
    anthropicTools: ODL_TOOLS_ANTHROPIC,
    openAiTools: ODL_TOOLS_OPENAI,
  },
}

export const SKILL_ORDER: SkillId[] = ['free-chat', 'ontology-design', 'consistency-check', 'doc-extract', 'odl-edit']
