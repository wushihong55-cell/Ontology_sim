# 企业本体平台 × LLM × Skill 架构方案

> 用途：作为本项目引入大模型能力的设计依据，供 VS Code + Claude Code 协同实现时参考。
> 目标：在不引入重型外部 Agent 平台的前提下，构建"本体 + Skill + LLM"三位一体的企业经营管理 AI 能力。

---

## 1. 核心判断

1. **本体平台本身就是 Agent 的"世界模型"**：Neo4j 中的概念、关系、流程、岗位、权限已经构成天然的状态空间。再引入外部 Agent 平台会导致"双世界模型"撕裂。
2. **Skill 抽象必须引入**：它是企业级 LLM 应用的工程化骨架，提供契约、版本、权限、审计、灰度能力。
3. **不需要重型 Agent 平台**：编排逻辑轻量自建在本体之上即可，复杂度上来后再评估。
4. **LLM 永远不直接改图**：所有写操作必须经过 Skill → Tool → 策略闸门 → Neo4j 的链路，保证可解释、可审计、可回滚。

---

## 2. 整体架构

### 2.0 当前基线（Phase 0，已实现）

```
┌──────────────────────────────────────────────────────┐
│  React 前端（src/store.ts + src/App.tsx）              │
│   ├── 4 个内置 Skill（src/lib/skills.ts）              │  ← 已实现
│   │   💬 自由对话 / 🧠 本体设计辅助（FC）              │
│   │   ✅ 一致性检查 / 📄 文档提炼（FC）                 │
│   ├── AI 建议审批面板（PatchCard + applyPatch）         │  ← 已实现
│   └── Ontology Store（Zustand + localStorage）         │
└──────────────────────────────────────────────────────┘
          ↓ HTTP（直连 or 代理）
    LLM Provider（Claude / DeepSeek / Ollama…）
    支持 Function Calling 的模型可产生结构化建议
```

**关键约束**：LLM 建议以 `OntologyPatch` 存入 `pendingPatches[]`，用户点击「✓ 应用」后才写入 Store，LLM 永远不直接改图。

### 2.1 目标架构（5 层，Phase 1+）

```
┌─────────────────────────────────────────────────┐
│ 5. LLM 推理引擎（可换模型，分级路由）              │
│    本地: Qwen2.5-32B / DeepSeek                  │
│    云端: Claude / GPT （高难推理 & 本体设计）     │
├─────────────────────────────────────────────────┤
│ 4. Agent / 编排层（多步流程、状态机）              │
│    轻量自建，状态存在 Neo4j                       │
├─────────────────────────────────────────────────┤
│ 3. Skill 层（业务能力封装）                       │
│    本体设计 / 风险监控 / 审批 / 业务问答 / 影响分析 │
├─────────────────────────────────────────────────┤
│ 2. Tool 层（原子能力）                            │
│    Cypher 安全执行器 / 规则引擎 / 文档 RAG /       │
│    Schema 反查 / 数据连接器                       │
├─────────────────────────────────────────────────┤
│ 1. Neo4j 本体 + 实例数据（Single Source of Truth）│
└─────────────────────────────────────────────────┘
```

### 各层职责边界

| 层 | 职责 | 不做 |
|---|---|---|
| Neo4j | 概念、关系、约束、实例、流程状态 | 业务逻辑、规则计算 |
| Tool | 原子操作，无业务语义 | 多步编排、Prompt |
| Skill | 业务能力，有明确契约 | 跨业务编排 |
| Agent | 多 Skill 编排、状态机、HITL | 业务规则 |
| LLM | 语言理解、生成、推理 | 直接写图、做合规决策 |

---

## 3. 阶段 A：LLM 辅助本体设计（设计时）

### 3.1 关键挑战
LLM 既要懂**业务**（行业 know-how），又要懂**本体工程**（OWL/RDFS/SKOS 设计原则）。任何一边缺位都会产出垃圾本体。

### 3.2 推荐方法

#### (1) 业务素材 RAG
- 灌入：SOP、组织架构、岗位说明书、合同模板、流程文档、历史报表、制度文件
- 分块策略：按文档结构 + 语义双层切分
- 检索：向量召回 + BM25 混合

#### (2) Competency Questions 驱动
让 LLM 从业务文档反推"本体应该能回答哪些问题"，再据此设计概念/关系/属性。这是本体工程的经典方法。

示例：
- 输入：信贷业务 SOP
- LLM 输出 CQ：
  - "某客户经理过去 12 个月触发过几次大额审批？"
  - "某产品的风险敞口超过阈值时谁是责任人？"
- 反推所需本体元素：`Customer`, `LoanOfficer`, `Approval`, `Threshold`, `Product`, `Responsibility` 等

#### (3) 本体设计模式库（ODP）
预置企业经营高频模式，LLM 优先复用而非创造：

| 模式 | 适用场景 |
|---|---|
| `Organization-Role-Person` | 组织/岗位/人员建模 |
| `Process-Activity-Actor` | 业务流程建模 |
| `Risk-Control-Indicator` | 风险与内控建模 |
| `Policy-Rule-Exception` | 制度规则建模 |
| `KPI-Measurement-Target` | 绩效与目标建模 |
| `Document-Approval-Authority` | 单据审批建模 |
| `Event-Trigger-Action` | 事件驱动建模 |

#### (4) 结构化建议：Function Calling → OntologyPatch → 审批应用

LLM 永远不直接修改本体，而是通过两条路径产生**结构化建议**（`OntologyPatch`）：

##### 路径 A：Function Calling（推荐，Claude / GPT-4o / DeepSeek V3 支持）

向 LLM 传入预定义工具集（`src/lib/skills.ts`），LLM 调用工具输出结构化参数，平台解析后存入 `pendingPatches[]`：

```typescript
// 平台预定义的 4 类建议工具
suggest_add_entity(name, label, entityType, description, properties[])
suggest_add_relation(name, sourceLabel, targetLabel, cardinality, description)
suggest_add_property(entityName, name, type, required, description)
suggest_cypher_note(description, cypher)  // 仅供参考，不可自动应用
```

##### 路径 B：Structured JSON（降级兜底，不支持 FC 的模型）

- 系统提示中要求 LLM 输出特定 JSON 格式
- 前端用 schema 校验后转换为 `OntologyPatch`
- 可靠性低于路径 A

##### 审批流（已实现）

```text
LLM 调用工具 → OntologyPatch 存入 pendingPatches[] → 用户在建议面板点「✓ 应用」
→ applyPatch() 调用 addEntity/addRelationBetween/updateEntity
→ 建议状态更新为 applied
```

平台不提供 Cypher Diff UI（Phase 1+ 可加），当前建议以卡片形式呈现。

#### (5) 一致性自检 Skill
每次变更后自动跑：
- 孤立节点检测
- 命名规范（驼峰 / 中英文一致性）
- 领域/值域冲突
- 循环继承
- 与已有实例数据的兼容性
- 与已注册 Skill 的兼容性（绑定的概念是否还在）

---

## 4. 阶段 B：基于本体的业务执行（运行时）

### 4.1 典型 Skill 示例

| Skill | 输入 | 关键步骤 | 输出 |
|---|---|---|---|
| **风险监控** | 实体/事件 | 遍历 `Risk-Indicator-Threshold` → Cypher 查现状 → 规则引擎判定 | 风险等级 + 证据链 |
| **审批** | 审批单 | 根据 `Policy-Authority-Threshold` 推导审批链 → 找 Person → 通知 → 状态回写 | 审批结果 |
| **业务问答** | 自然语言 | 用本体 schema 作 context 生成 Cypher → 执行 → 自然语言总结 | 结构化答复 |
| **变更影响分析** | 制度/岗位变更 | 沿本体追溯受影响的流程/角色/KPI | 影响清单 + 缓解建议 |
| **本体设计辅助** | 业务文档 | RAG → CQ 提炼 → 模式匹配 → Cypher Diff | schema 补丁建议 |

### 4.2 Skill 必备特性
- **契约化**：输入/输出 schema 明确
- **权限化**：声明所需 Cypher 读写权限、本体概念访问范围
- **可版本**：支持灰度、A/B、回滚
- **可审计**：每次调用记录 Cypher、Tool 调用、LLM I/O、决策路径
- **可观测**：耗时、token、成本、成功率指标

---

## 5. Skill 设计规范

### 5.1 核心理念：Manifest（声明式） + Code（扩展点）

**业务可配置的部分** → Manifest（YAML/JSON），平台内编辑
**技术扩展部分** → Code（Python/TS），IDE 内编辑

### 5.2 Skill Manifest 示例

```yaml
# skills/risk_monitor_credit/skill.yaml
name: risk_monitor_credit
version: 1.2.0
owner: risk_team
description: 客户授信风险监控

# 输入输出契约
inputs:
  customer_id:
    type: string
    source: ontology://Customer
    required: true
outputs:
  risk_level:
    type: enum
    values: [low, med, high]
  evidence:
    type: array
    items: {type: object}

# 本体绑定（核心差异化能力）
ontology_bindings:
  primary_concept: Customer
  traverse_relations:
    - hasContract
    - hasIndicator
    - hasHistoricalEvent
  thresholds_from: ontology://Policy/CreditRisk
  schema_context_depth: 2  # 把本体子图传给 LLM 的深度

# Prompt 与 Tool
prompt_template: prompts/credit_risk.md
tools:
  - cypher_query
  - rule_engine
  - doc_rag

# 策略与治理
policy:
  approval_required_when: "risk_level == 'high'"
  audit: full
  data_scope: tenant_isolated
  rate_limit: 100/min

# LLM 路由
model:
  primary: qwen2.5-32b-local
  fallback: claude-sonnet  # 复杂 case 升级

# 代码扩展点（在 IDE 里写）
hooks:
  pre_process: ./hooks/normalize_customer.py
  post_process: ./hooks/format_evidence.py
  custom_tools: ./tools/  # Skill 私有的 Tool

# 测试用例
test_cases: ./tests/cases.yaml
```

### 5.3 目录约定

```
skills/
├── risk_monitor_credit/
│   ├── skill.yaml              # Manifest（平台内可编辑）
│   ├── prompts/
│   │   └── credit_risk.md      # Prompt 模板（平台内可编辑）
│   ├── hooks/                  # 代码扩展（IDE 内编辑）
│   │   ├── normalize_customer.py
│   │   └── format_evidence.py
│   ├── tools/                  # Skill 私有 Tool
│   ├── tests/
│   │   └── cases.yaml          # 回归测试用例
│   └── README.md
├── approval_standard/
├── ontology_design_assistant/
└── _shared/                    # 共享 Prompt 片段、工具
```

### 5.4 Skill 生命周期

```
draft → testing → staging → production → deprecated
   ↑        ↓         ↓          ↓
   └────── 回滚 ──────┴──────────┘
```

每次状态流转需要：
- Manifest 校验通过
- 测试用例通过率 ≥ 阈值
- 审计日志启用
- （进生产）负责人审批

---

## 6. Skill 编辑器策略

### 6.1 路线选择：混合方案

| 维度 | 平台内编辑器 | 外部 IDE (VS Code/Cursor) |
|---|---|---|
| Manifest（YAML） | ✅ 可视化表单 + 源码双视图 | ✅ 直接编辑 |
| Prompt 模板 | ✅ 带变量提示 + 测试 | ✅ |
| 本体绑定 | ✅ **必须在平台内**（拖拽本体概念） | ❌ |
| Hook 代码 | ❌（别造 Monaco 黑洞） | ✅ |
| 自定义 Tool | ❌ | ✅ |
| 测试运行 | ✅ | ✅ |
| Git 版本管理 | ✅ 集成 | ✅ 原生 |

### 6.2 平台内编辑器 MVP 功能（按优先级）

1. **Skill Manifest 可视化编辑**（YAML 双向）
2. **本体绑定面板** ⭐ 差异化核心 —— 从 Neo4j 拖拽概念/关系到 Skill I/O，自动生成 Cypher 模板
3. **Prompt 编辑器 + 变量提示** —— 显示可用本体变量、Tool 列表
4. **测试台** —— 单条用例 + 批量回归 + 与历史版本对比
5. **审计与运行轨迹** —— Cypher、Tool 调用、LLM I/O、决策路径
6. **版本管理 + 灰度发布** —— A/B、按部门灰度
7. **Skill 市场/目录** —— 内部复用，业务方可搜索

### 6.3 不要自己造的部分
- 代码编辑器组件（Hook 文件让用户在 VS Code 编辑即可）
- Git/版本管理底层（直接接 GitLab/Gitea）
- 通用 prompt playground（用现成的）

---

## 7. 落地路径（6 步走）

### Phase 1（1-2 月）：协议沉淀 + 双 Skill 验证
- 定义 Skill Manifest schema（v0.1）
- 实现 Tool 层最小集合：
  - `cypher_safe_executor`（权限过滤 + 注入防护）
  - `schema_introspector`（本体反查）
  - `rule_engine_adapter`
  - `doc_rag`
- 实现 2 个 Skill 端到端：
  - **本体设计辅助**（SOP 文档 → 概念建议 → Cypher Diff）
  - **业务问答**（自然语言 → Cypher → 结果总结）
- 无 UI，纯 Git + YAML + CLI 调试

### Phase 2（2-3 月）：MVP 编辑器
- 平台内 Skill Manifest 可视化编辑
- **本体绑定面板**（核心）
- 测试台 + 审计日志
- Skill 注册中心

### Phase 3（按需）：编排与生态
- 多 Skill 编排器（轻量状态机，状态存 Neo4j）
- Skill 市场
- 低代码组件（如果业务方真的有需求）

### 反模式警告
- ❌ 一上来立项做"企业 AI Skill 低代码平台"，半年憋大招
- ❌ 引入重型 Agent 平台与本体并行
- ❌ 让 LLM 直接执行写操作不经闸门
- ❌ 不做审计就上生产
- ❌ Skill 不分级，全用最贵的模型

---

## 8. 模型与成本策略

### 8.1 分级路由

| 任务类型 | 推荐模型 | 理由 |
|---|---|---|
| 本体设计辅助（CQ 提炼、模式匹配） | Claude / GPT-4 级 | 推理复杂度高、低频 |
| 复杂风险推理 | DeepSeek-V3 / Claude | 多跳推理、决策链长 |
| 日常业务问答 / Cypher 生成 | Qwen2.5-32B 本地 | 高频、数据敏感 |
| 模板化任务（摘要、抽取） | Qwen2.5-14B / 7B 本地 | 量大、可控 |

### 8.2 成本控制
- Skill 级别配置成本预算和告警
- Prompt 缓存（公共 schema context 部分）
- 本体子图按需裁剪，不全量塞 prompt
- 失败重试限制 + 降级策略

---

## 9. 安全与治理

### 9.1 数据安全
- 多租户隔离：Cypher 执行器强制注入 `tenant_id` 过滤
- 敏感数据出域控制：高敏数据强制走本地模型
- 审计日志不可篡改（append-only）

### 9.2 决策治理
- Skill 分级（L1 只读 / L2 写非关键 / L3 写关键），L3 必须 HITL
- 关键 Skill 调用需双因素：用户授权 + 策略校验
- 决策证据链可追溯到本体节点与原始数据

### 9.3 LLM 治理
- Prompt 注入防护（输入清洗、输出 schema 校验）
- 幻觉控制：所有事实性输出必须可追溯到 Cypher 结果或 RAG 来源
- 模型输出 schema 强校验（pydantic / zod）

---

## 10. 与现有项目的集成点

### Phase 0（纯前端，已实现）

当前项目为单一 React + TypeScript + Vite 前端应用，无后端服务。

| 文件 | 内容 |
| --- | --- |
| `src/types.ts` | `SkillId`, `OntologyPatch`, `PatchItem` 类型定义 |
| `src/lib/skills.ts` | 4 个内置 Skill 定义（系统提示 + Anthropic/OpenAI 工具声明） |
| `src/store.ts` | `activeSkillId`, `pendingPatches`, `docContext`；`sendAiMessage()` 支持 Function Calling；`applyPatch()` / `dismissPatch()` |
| `src/App.tsx` | `AiChatPanel` 新增 Skill 选择器 + 文档粘贴区 + `PatchCard` 建议审批面板 |
| `src/lib/cypherExporter.ts` | 现有 Cypher 生成能力，可在建议卡片中引用 |

### Phase 1（引入后端，按需）

当需要文档 RAG 或持久化审计日志时新增 `server/` 目录（Node.js + Express）：

- `POST /api/skills/invoke` — Skill 执行入口（带 SQLite 审计）
- `GET  /api/skills/audit`  — 审计日志查询
- `POST /api/rag/index`     — 文档向量化（vectra 本地索引）
- `GET  /api/rag/search`    — 语义搜索

Vite proxy 将 `/api/skills/*` 转发到 server；`packages/shared-types/` 共享 TS 类型。

---

## 11. 给 Claude Code 的实现提示

实现时建议遵循的优先级：

1. **先写 Skill Manifest 的 JSON Schema** —— 一切的契约源头，用它生成 TS 类型和校验器
2. **先做 `cypher_safe_executor`** —— 所有后续 Skill 都依赖它，安全性是底线
3. **第一个端到端 Skill 选"业务问答"** —— 链路最短，能快速验证整套架构
4. **审计先于功能** —— 任何 Skill 调用都必须留痕，否则后期补不上
5. **测试用例与 Skill 同生命周期** —— `tests/cases.yaml` 是 Skill 的一部分，CI 必跑

代码风格约定：
- TypeScript 优先（与现有 `packages/shared-types` 一致）
- 关键 Tool（如 Cypher 执行器）必须有单元测试覆盖
- Skill Manifest 校验失败必须 fail fast，禁止"宽容解析"
- LLM 调用必须支持 mock，便于本地测试

---

## 附录 A：Skill Manifest JSON Schema 草案

待补充，建议在 `packages/skill-runtime/schema/skill.schema.json` 中维护，作为唯一真相源。

## 附录 B：本体设计模式库

待补充，建议在 `docs/ontology-patterns/` 下按模式建独立文档。

## 附录 C：典型 Cypher 安全规约

待补充：禁用 `CALL apoc.*` 中的危险过程、强制 `LIMIT`、强制 `tenant_id` 注入等。

---

*本文档为活文档，随实现演进更新。修改请走 PR review。*
