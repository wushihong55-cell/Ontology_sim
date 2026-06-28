import { Router, Request, Response as ExpressResponse } from 'express'
import { runQuery, runWrite } from '../neo4j/driver'

export const aiRouter = Router()

interface AiServiceCfg {
  provider: 'anthropic' | 'openai-compat'
  baseUrl: string
  model: string
  apiKey: string
}

interface SkillTool {
  id: string
  toolName: string
  toolDescription: string
  toolInputSchema: Record<string, unknown>
  cypherExecution: string
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

async function loadTools(modelId?: string | null): Promise<SkillTool[]> {
  /* Load generic (no model binding) tools + model-specific tools for modelId */
  const rows = await runQuery(`
    MATCH (s:Skill { skillType: 'tool', enabled: true })
    WHERE s.toolName IS NOT NULL AND s.toolName <> ''
      AND (s.modelId IS NULL OR s.modelId = '' OR s.modelId = $modelId)
    RETURN s { .* } AS skill
    ORDER BY s.category, s.name
  `, { modelId: modelId ?? null })
  return rows.map((r: any) => ({
    id:              r.skill.id,
    toolName:        r.skill.toolName,
    toolDescription: r.skill.toolDescription,
    toolInputSchema: r.skill.toolInputSchema ? JSON.parse(r.skill.toolInputSchema) : {},
    cypherExecution: r.skill.cypherExecution ?? '',
  }))
}

async function executeToolCypher(
  skill: SkillTool,
  params: Record<string, unknown>,
): Promise<string> {
  if (!skill.cypherExecution || skill.cypherExecution.trim().startsWith('//')) {
    return '__NO_DATA__: 此技能没有可执行的查询，无法获取真实数据。'
  }
  try {
    const rows = await runQuery(skill.cypherExecution, params)
    if (rows.length === 0) return '__NO_DATA__: 查询执行成功，但未找到任何匹配数据。'
    return JSON.stringify(rows.slice(0, 100), null, 2)
  } catch (e) {
    return `__NO_DATA__: Cypher 执行失败: ${String(e)}`
  }
}

/**
 * Special handler for nl_to_cypher: uses a sub-LLM call to generate Cypher
 * from natural language, then executes it and returns real data.
 */
async function executeNlToCypher(
  naturalLanguage: string,
  twinId: string,
  cfg: AiServiceCfg,
  schemaContext?: string,
): Promise<string> {
  /* Fetch actual EntityDef + their properties from Neo4j so LLM knows real field names */
  let entityFieldHints = ''
  try {
    const entityRows = await runQuery(`
      MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)
      RETURN e.id AS id, e.name AS name, e.label AS label, e.properties AS propertiesJson
      LIMIT 30
    `)
    entityFieldHints = entityRows.map((r: any) => {
      let props: any[] = []
      try { props = JSON.parse(r.propertiesJson ?? '[]') } catch {}
      const propNames = props.map((p: any) => p.name).filter(Boolean).join(', ')
      return `- ${r.label}（${r.name}，entityDefId="${r.id}"）属性：${propNames || '无'}`
    }).join('\n')
  } catch { /* ignore — hints are optional */ }

  const genPrompt = `你是 Neo4j Cypher 专家。根据图谱 Schema 和用户问题，生成一条可直接执行的 Cypher。

【实例节点查询规则（必须遵守）】
- 实例节点标签统一为 :EntityInstance
- 用 _entityDefId 区分实体类型，值即下方各实体的 entityDefId
- 与孪生体关联：(n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
- 参数只能用 $twinId（已自动注入），其余参数全部硬编码为字面量
- 禁止使用 n.entityLabel 或中文属性名作为过滤条件

【当前本体实体及属性字段】
${entityFieldHints || '（未获取到实体定义）'}

【本体 Schema（补充参考）】
${schemaContext ?? '（未提供）'}

【用户查询需求】
${naturalLanguage}

只输出 Cypher 语句本身，不要 markdown 代码块、不要注释、不要任何解释。`

  const genResp = await callLLMOnce(cfg, [{ role: 'user', content: genPrompt }],
    '你是 Cypher 生成器，只输出纯 Cypher，禁止输出其他任何内容。', [])

  const isAnthropic = cfg.provider === 'anthropic'
  let cypher = (isAnthropic
    ? (genResp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    : (genResp.choices?.[0]?.message?.content ?? '')
  ).trim().replace(/^```(?:cypher)?\n?/i, '').replace(/\n?```$/, '').trim()

  if (!cypher) return '__NO_DATA__: LLM 未能生成有效的 Cypher 查询。'

  try {
    const rows = await runQuery(cypher, { twinId })
    if (rows.length === 0) return `__NO_DATA__: 查询未返回任何数据。\n执行的 Cypher：${cypher}`
    return `查询：${cypher}\n\n结果：\n${JSON.stringify(rows.slice(0, 50), null, 2)}`
  } catch (e) {
    return `__NO_DATA__: 生成的 Cypher 执行失败：${String(e)}\n查询：${cypher}`
  }
}

/** Single non-streaming LLM call — used for the first turn when tools are enabled */
async function callLLMOnce(
  cfg: AiServiceCfg,
  messages: { role: string; content: unknown }[],
  systemPrompt: string,
  tools: SkillTool[],
  forceToolName?: string,
): Promise<any> {
  const anthropicTools = tools.map((sk) => ({
    name:         sk.toolName,
    description:  sk.toolDescription,
    input_schema: sk.toolInputSchema,
  }))
  const openaiTools = tools.map((sk) => ({
    type: 'function',
    function: {
      name:        sk.toolName,
      description: sk.toolDescription,
      parameters:  sk.toolInputSchema,
    },
  }))

  let resp: globalThis.Response

  if (cfg.provider === 'anthropic') {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      cfg.model || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     systemPrompt,
        messages,
        tools:      anthropicTools.length ? anthropicTools : undefined,
        tool_choice: forceToolName ? { type: 'tool', name: forceToolName } : undefined,
      }),
    })
  } else {
    const base = cfg.baseUrl?.replace(/\/$/, '') ?? ''
    resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model:      cfg.model || 'gpt-4o',
        max_tokens: 4096,
        messages:   [{ role: 'system', content: systemPrompt }, ...messages],
        tools:      openaiTools.length ? openaiTools : undefined,
        tool_choice: forceToolName ? { type: 'function', function: { name: forceToolName } } : undefined,
      }),
    })
  }

  if (!resp.ok) throw new Error(`LLM ${resp.status}: ${await resp.text()}`)
  return resp.json()
}

/** Streaming LLM call — used for the final answer (no tools needed) */
async function streamLLMResponse(
  cfg: AiServiceCfg,
  messages: { role: string; content: unknown }[],
  systemPrompt: string,
  onChunk: (text: string) => void,
): Promise<void> {
  let resp: globalThis.Response

  if (cfg.provider === 'anthropic') {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      cfg.model || 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream:     true,
        system:     systemPrompt,
        messages,
      }),
    })
  } else {
    const base = cfg.baseUrl?.replace(/\/$/, '') ?? ''
    resp = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model:    cfg.model || 'gpt-4o',
        max_tokens: 4096,
        stream:   true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
  }

  if (!resp.ok) throw new Error(`LLM stream ${resp.status}: ${await resp.text()}`)

  const reader  = (resp.body as any).getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const ev    = JSON.parse(raw)
        const chunk = cfg.provider === 'anthropic'
          ? (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : '')
          : (ev.choices?.[0]?.delta?.content ?? '')
        if (chunk) onChunk(chunk)
      } catch { /* skip malformed SSE */ }
    }
  }
}

/* ── POST /api/ai/chat ──────────────────────────────────────────────────────── */

/**
 * Agentic chat endpoint with skill tool dispatch.
 *
 * Flow:
 *   1. Load enabled tool-type skills from Neo4j
 *   2. Non-streaming LLM call with tools defined
 *   3. If LLM requests tool_use → execute Cypher → second streaming call with results
 *   4. If no tool_use → send first response text directly
 *
 * SSE format: `data: "text chunk"\n\n`  (JSON-encoded string)
 *             `data: [DONE]\n\n`
 */
aiRouter.post('/chat', async (req: Request, res: ExpressResponse) => {
  const { message, twinId, modelId, schemaContext, odlContext, aiConfig, history = [], useSkills = true } = req.body as {
    message:        string
    twinId?:        string
    modelId?:       string
    schemaContext?: string
    odlContext?:    string
    aiConfig:       AiServiceCfg
    history:        { role: string; content: string }[]
    useSkills?: boolean
  }

  if (!message)   return res.status(400).json({ error: 'message is required' })
  if (!aiConfig)  return res.status(400).json({ error: 'aiConfig is required' })

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')

  const send    = (text: string) => res.write(`data: ${JSON.stringify(text)}\n\n`)
  const sendEnd = () => { res.write('data: [DONE]\n\n'); res.end() }

  try {
    // ── 1. Build system prompt ──────────────────────────────────────────────
    let systemPrompt = `你是一个专业的知识图谱助手，擅长本体设计、图谱查询、数据分析与业务洞察。请用中文回答，语言专业简洁。

【重要规则】你的回答必须严格基于技能工具返回的真实数据：
- 如果工具结果以 "__NO_DATA__" 开头，说明未查到任何数据，你必须如实回复"未查到相关数据，无法回答该问题"，禁止编造或推测任何数字、姓名、结果。
- 如果工具返回了数据，只能引用数据中实际存在的内容，不可补充或推断未出现的信息。
- 宁可说"不知道"，也不可给出无依据的答案。`

    if (twinId) {
      const twinRows = await runQuery(
        `MATCH (t:BizTwin { id: $twinId }) RETURN t.name AS name, t.description AS desc`,
        { twinId },
      ).catch(() => [])

      if (twinRows.length) {
        const t = twinRows[0] as any
        systemPrompt += `\n\n当前业务孪生：**${t.name}**。${t.desc ? t.desc : ''}`

        // ── 注入 ODL（企业经营知识层，优先于 Schema，是 LLM 理解业务的主要依据）──
        if (odlContext) {
          systemPrompt += `\n\n【企业经营知识层（ODL）】\n以下是本业务域的经营知识定义，包含业务概念、指标口径、歧义消解规则和查询意图模板。\n回答问题时，业务概念的理解、指标字段的选取、查询路径的判断，必须以 ODL 定义为准，不得自行从 Schema 推断。\n\n${odlContext}`
        }

        // ── 注入本体 Schema（作为执行层参考，LLM 生成 Cypher 时使用）──
        if (schemaContext) {
          systemPrompt += odlContext
            ? `\n\n【图数据库 Schema（执行参考）】\n以下是 Neo4j 图数据库的技术 Schema，供生成 Cypher 时参考，业务含义以 ODL 为准。\n${schemaContext}`
            : `\n\n【本体 Schema】\n${schemaContext}`
        }

        // ── 注入实例数据规模 ───────────────────────────────────────────────
        const countRows = await runQuery(
          `MATCH (n:EntityInstance)-[:IN_TWIN]->(t:BizTwin { id: $twinId })
           OPTIONAL MATCH (e:EntityDef { id: n._entityDefId })
           RETURN coalesce(e.label, n._entityDefId, 'Unknown') AS type,
                  n._entityDefId AS entityDefId,
                  count(n) AS cnt
           ORDER BY cnt DESC LIMIT 20`,
          { twinId },
        ).catch(() => [])

        if (countRows.length) {
          const summary = countRows.map((r: any) => `${r.type}(entityDefId="${r.entityDefId}"): ${r.cnt} 条`).join('、')
          systemPrompt += `\n\n【实例数据规模】${summary}`
          systemPrompt += `\n\n【数据查询技能使用规则】`
          systemPrompt += `\n- 所有实例节点标签统一为 :EntityInstance，用 _entityDefId 属性区分实体类型`
          systemPrompt += `\n- 查询数据时优先使用 nl_to_cypher 或 aggregate_stats 技能，传入 naturalLanguage 参数描述查询意图`
          systemPrompt += `\n- 用 entityDefId（括号中的值）区分实体，禁止在 Cypher 或参数中使用中文实体名`
          systemPrompt += `\n- twinId 参数已自动注入到所有技能调用中，无需手动传入`
          systemPrompt += `\n- 若工具返回 __NO_DATA__ 开头的结果，则代表无真实数据，必须如实告知用户，不得编造数据`
        }
      }
    }

    // ── 2. Load tool-type skills (generic + model-specific) ────────────────
    const tools = useSkills ? await loadTools(modelId).catch(() => [] as SkillTool[]) : []

    const conversationMsgs: { role: string; content: unknown }[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ]

    // ── 3. When no tools: stream directly ──────────────────────────────────
    if (tools.length === 0) {
      await streamLLMResponse(aiConfig, conversationMsgs, systemPrompt, send)
      return sendEnd()
    }

    // ── 4. Non-streaming call with tools ────────────────────────────────────
    const firstResponse = await callLLMOnce(aiConfig, conversationMsgs, systemPrompt, tools)

    // ── 4. Check for tool_use / tool_calls ──────────────────────────────────
    const isAnthropic = aiConfig.provider === 'anthropic'

    const toolUseBlocks: any[] = isAnthropic
      ? (firstResponse.content ?? []).filter((b: any) => b.type === 'tool_use')
      : (firstResponse.choices?.[0]?.message?.tool_calls ?? [])

    if (toolUseBlocks.length === 0) {
      // No tools needed — stream text from first response directly
      const text = isAnthropic
        ? (firstResponse.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        : (firstResponse.choices?.[0]?.message?.content ?? '')
      if (text) send(text)
      return sendEnd()
    }

    // ── 5. Execute each tool and collect results ────────────────────────────
    const toolResultMsgs: { role: string; content: unknown }[] = []

    for (const tu of toolUseBlocks) {
      const toolName  = isAnthropic ? tu.name : tu.function?.name
      const toolInput = isAnthropic ? (tu.input ?? {}) : JSON.parse(tu.function?.arguments ?? '{}')
      const skill     = tools.find((s) => s.toolName === toolName)

      send(`\n> 🔧 调用技能：**${toolName}**…\n`)

      let result: string
      /* Tools that need dynamic Cypher generation via a sub-LLM call */
      const NL_CYPHER_TOOLS = new Set(['nl_to_cypher', 'aggregate_stats', 'list_instances'])
      if (NL_CYPHER_TOOLS.has(toolName)) {
        const nlQuery = toolInput.naturalLanguage ?? toolInput.query ?? toolInput.description ?? ''
        result = await executeNlToCypher(
          nlQuery || JSON.stringify(toolInput),
          toolInput.twinId ?? twinId ?? '',
          aiConfig,
          schemaContext,
        )
      } else {
        result = skill
          ? await executeToolCypher(skill, { twinId, ...toolInput })
          : `(未找到名为 "${toolName}" 的技能)`
      }

      if (isAnthropic) {
        toolResultMsgs.push({
          role:    'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: result }],
        })
      } else {
        toolResultMsgs.push({
          role:         'tool',
          tool_call_id: tu.id,
          content:      result,
        } as any)
      }
    }

    // ── 6. Build second-round messages with tool results ────────────────────
    let secondMsgs: { role: string; content: unknown }[]

    if (isAnthropic) {
      secondMsgs = [
        ...conversationMsgs,
        { role: 'assistant', content: firstResponse.content },
        ...toolResultMsgs,
      ]
    } else {
      const assistantMsg = firstResponse.choices[0].message
      secondMsgs = [
        ...conversationMsgs,
        { role: 'assistant', content: assistantMsg.content ?? '', tool_calls: assistantMsg.tool_calls } as any,
        ...toolResultMsgs,
      ]
    }

    // ── 7. Stream final answer ──────────────────────────────────────────────
    send('\n')
    await streamLLMResponse(aiConfig, secondMsgs, systemPrompt, send)
    sendEnd()

  } catch (e) {
    send(`\n❌ 服务器错误：${String(e)}`)
    sendEnd()
  }
})

/* ── POST /api/ai/regenerate-skills ────────────────────────────────────────── */

/**
 * Regenerate cypherExecution for data-query skills based on current schema.
 * Skips ontology-design skills and nl_to_cypher (handled separately).
 */
aiRouter.post('/regenerate-skills', async (req: Request, res: ExpressResponse) => {
  const { schemaContext, twinId, aiConfig } = req.body as {
    schemaContext?: string
    twinId?:        string
    aiConfig:       AiServiceCfg
  }
  if (!aiConfig) return res.status(400).json({ error: 'aiConfig is required' })

  // Skills handled by special logic or irrelevant to instance data
  const SKIP_TOOLS = new Set([
    'nl_to_cypher', 'ontology_suggest', 'property_generator', 'cypher_explain',
    'relation_completion', 'constraint_generator', 'ontology_from_doc',
    'ontology_model_compare', 'batch_import_gen', 'cypher_formatter',
    'update_statement_gen', 'index_management', 'query_optimizer',
  ])

  try {
    const allSkills = await loadTools()
    const targetSkills = allSkills.filter((s) => !SKIP_TOOLS.has(s.toolName))

    const schemaStr = schemaContext ?? '（未提供 Schema）'
    const graphRules = `【图谱节点规则】
- 实例节点统一标签：:EntityInstance
- _entityDefId 属性区分实体类型（值即 schema 中各实体的 id，如 "tn-employee"）
- 实例与孪生体关联：(n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
- $twinId 会自动注入，无需 LLM 传入；其他参数由调用方按 toolInputSchema 传入
- 禁止用 label 名称（如 '员工'）做实体过滤，必须用 _entityDefId`

    const results: Array<{ id: string; toolName: string; cypher: string; error?: string }> = []

    for (const skill of targetSkills) {
      const genPrompt = `你是 Neo4j Cypher 专家。请根据以下规则、Schema 和技能定义，生成该技能的 cypherExecution 查询。

${graphRules}

【本体 Schema】
${schemaStr}

【技能定义】
工具名：${skill.toolName}
描述：${skill.toolDescription}
输入参数 schema：${JSON.stringify(skill.toolInputSchema, null, 2)}

【要求】
- 只输出纯 Cypher 语句，不要任何解释、注释或 markdown 代码块
- 参数名称必须与 toolInputSchema 中的 properties key 一致（用 $ 前缀）
- 如果该技能不需要 Cypher（如仅由 LLM 处理），输出：// 不需要 Cypher`

      try {
        const genResp = await callLLMOnce(
          aiConfig,
          [{ role: 'user', content: genPrompt }],
          '你是 Cypher 生成器，只输出纯 Cypher，禁止输出任何其他内容。',
          [],
        )
        const isAnthropic = aiConfig.provider === 'anthropic'
        let cypher = (isAnthropic
          ? (genResp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
          : (genResp.choices?.[0]?.message?.content ?? '')
        ).trim().replace(/^```(?:cypher)?\n?/i, '').replace(/\n?```$/, '').trim()

        // Write back to Neo4j
        await runQuery(
          `MATCH (s:Skill { id: $id }) SET s.cypherExecution = $cypher, s.updatedAt = $now RETURN s.id`,
          { id: skill.id, cypher, now: new Date().toISOString() },
        )
        results.push({ id: skill.id, toolName: skill.toolName, cypher })
      } catch (e) {
        results.push({ id: skill.id, toolName: skill.toolName, cypher: '', error: String(e) })
      }
    }

    res.json({ updated: results.filter((r) => !r.error).length, total: results.length, results })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/* ── POST /api/ai/generate-model-skills ────────────────────────────────────── */

/**
 * Generate model-specific analysis skills bound to the given ontology model.
 * The LLM analyzes the model's entities/relations and generates 6-8 custom
 * skills with validated Cypher. Existing auto-generated skills for this model
 * are replaced. Generic (un-bound) built-in skills are left untouched.
 */
aiRouter.post('/generate-model-skills', async (req: Request, res: ExpressResponse) => {
  const { modelId, twinId, aiConfig } = req.body as {
    modelId:  string
    twinId?:  string
    aiConfig: AiServiceCfg
  }
  if (!modelId || !aiConfig) return res.status(400).json({ error: 'modelId and aiConfig are required' })

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')

  const send = (evt: object) => res.write(`data: ${JSON.stringify(evt)}\n\n`)

  try {
    /* 1. Load entities */
    send({ type: 'progress', step: 1, message: '正在读取本体模型结构…' })
    const entityRows = await runQuery(`
      MATCH (e:EntityDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      RETURN e { .* } AS entity
    `, { modelId })

    if (entityRows.length === 0) {
      send({ type: 'error', message: '该模型下未找到任何实体，请先完善本体模型' })
      res.write('data: [DONE]\n\n'); res.end(); return
    }

    const entities = entityRows.map((r: any) => ({
      id:         r.entity.id,
      name:       r.entity.name,
      label:      r.entity.label ?? r.entity.name,
      properties: (() => { try { return JSON.parse(r.entity.properties ?? '[]') } catch { return [] } })(),
    }))

    /* 2. Load relations */
    const relRows = await runQuery(`
      MATCH (r:RelDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      RETURN r { .* } AS rel
    `, { modelId })
    const relations = relRows.map((r: any) => r.rel)

    /* 3. Load instance counts if twinId provided */
    const countMap: Record<string, number> = {}
    if (twinId) {
      const counts = await runQuery(
        `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
         RETURN n._entityDefId AS id, count(n) AS cnt`,
        { twinId },
      ).catch(() => [])
      for (const r of counts as any[]) countMap[r.id] = Number(r.cnt ?? 0)
    }

    /* 4. Build entity hint string for LLM */
    const entityHints = entities.map((e: any) => {
      const propList = (e.properties as any[])
        .map((p: any) => `${p.name}:${p.type}${p.nameZh ? `(${p.nameZh})` : ''}`)
        .join(', ') || '（无属性）'
      const cnt = countMap[e.id]
      return `• ${e.label}(${e.name})  entityDefId="${e.id}"${cnt ? `  已有${cnt}条数据` : ''}\n  属性: ${propList}`
    }).join('\n')

    const relHints = relations.length > 0
      ? relations.map((r: any) => `• (${r.sourceLabel ?? '?'})-[:${r.name}]->(${r.targetLabel ?? '?'})`).join('\n')
      : '（无关系定义）'

    /* 5. Ask LLM to generate skill definitions */
    send({ type: 'progress', step: 2, message: `分析 ${entities.length} 个实体，让大模型设计专属分析技能…` })

    const systemMsg = '你是 Neo4j Cypher 专家和业务分析技能设计师。只输出合法 JSON，禁止任何解释或 markdown 包裹。'
    const userMsg = `请根据下面的本体模型，设计 6~8 个专属数据分析技能，用于回答业务领域常见的分析问题。

【图数据库节点规则】
- 实例节点统一标签: :EntityInstance
- 用 _entityDefId 属性区分实体类型（值如 "tn-train-station"）
- 实例与孪生体关联: (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
- $twinId 自动注入，禁止在 Cypher 中硬编码任何 twinId 字面量
- 禁止用中文实体名（如 '火车站'）作节点标签，必须用 _entityDefId 过滤
- 查询时参数格式: WHERE n._entityDefId = "<对应的entityDefId值>"

【本体实体】
${entityHints}

【实体关系】
${relHints}

【输出格式】
输出纯 JSON 数组，每个元素包含：
- toolName: 英文蛇形命名，如 count_stations_by_province（不要 "model_" 前缀）
- toolDescription: 中文简短描述，说明该技能回答什么业务问题（30字以内）
- inputParams: 输入参数数组（每个: {name, type, description, required}），若无参数则为 []
- cypherExecution: 完整 Cypher 语句，必须引用 $twinId，用 _entityDefId 过滤实体，RETURN 字段清晰

示例（交通领域）：
[
  {
    "toolName": "count_stations_by_province",
    "toolDescription": "统计各省份的火车站数量分布",
    "inputParams": [],
    "cypherExecution": "MATCH (n:EntityInstance { _entityDefId: 'tn-train-station' })-[:IN_TWIN]->(:BizTwin { id: $twinId }) WITH n.province AS province, count(n) AS cnt WHERE province IS NOT NULL RETURN province, cnt ORDER BY cnt DESC"
  },
  {
    "toolName": "find_airports_by_city",
    "toolDescription": "查询指定城市的所有机场",
    "inputParams": [{"name": "city", "type": "string", "description": "城市名称", "required": true}],
    "cypherExecution": "MATCH (n:EntityInstance { _entityDefId: 'tn-airport' })-[:IN_TWIN]->(:BizTwin { id: $twinId }) WHERE n.city = $city RETURN n.name AS name, n.code AS code"
  }
]`

    const llmResp = await callLLMOnce(
      aiConfig,
      [{ role: 'user', content: userMsg }],
      systemMsg,
      [],
    )

    const isAnthropic = aiConfig.provider === 'anthropic'
    const rawText = (isAnthropic
      ? (llmResp.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      : (llmResp.choices?.[0]?.message?.content ?? '')
    ).trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim()

    let skillDefs: Array<{
      toolName: string
      toolDescription: string
      inputParams: Array<{ name: string; type: string; description: string; required: boolean }>
      cypherExecution: string
    }>

    try {
      skillDefs = JSON.parse(rawText)
      if (!Array.isArray(skillDefs)) throw new Error('not array')
    } catch {
      send({ type: 'error', message: `大模型返回的 JSON 无法解析。原始内容: ${rawText.slice(0, 200)}` })
      res.write('data: [DONE]\n\n'); res.end(); return
    }

    send({ type: 'progress', step: 3, message: `大模型生成了 ${skillDefs.length} 个技能定义，正在验证 Cypher…` })

    /* 6. Validate each Cypher against Neo4j */
    const validated: typeof skillDefs = []
    for (const def of skillDefs) {
      if (!def.toolName || !def.cypherExecution) continue
      const cypher = def.cypherExecution.trim()
      try {
        /* Dry-run with LIMIT 1; use EXPLAIN to avoid data mutation */
        const testTwinId = twinId ?? '__dry_run__'
        await runQuery(`EXPLAIN ${cypher}`, { twinId: testTwinId }).catch(() => {
          /* EXPLAIN may not support all Cypher forms; fall back to real LIMIT 1 */
          return runQuery(`${cypher} LIMIT 1`, { twinId: testTwinId, ...def.inputParams.reduce((acc: any, p) => { acc[p.name] = null; return acc }, {}) })
        })
        validated.push(def)
        send({ type: 'skill_ok', toolName: def.toolName, description: def.toolDescription })
      } catch (err) {
        send({ type: 'skill_warn', toolName: def.toolName, error: String(err).slice(0, 120) })
        validated.push(def) /* keep anyway — Cypher may work with real data */
      }
    }

    /* 7. Delete old auto-generated skills for this model */
    await runWrite(
      `MATCH (s:Skill { modelId: $modelId, isAutoGenerated: true }) DETACH DELETE s`,
      { modelId },
    )

    /* 8. Insert new skills */
    const now = new Date().toISOString()
    let saved = 0
    for (const def of validated) {
      const skillId   = `ms-${modelId}-${def.toolName}`
      const inputSchema = {
        type: 'object',
        properties: Object.fromEntries(
          (def.inputParams ?? []).map((p) => [p.name, { type: p.type, description: p.description }])
        ),
        required: (def.inputParams ?? []).filter((p) => p.required).map((p) => p.name),
      }
      await runWrite(`
        MERGE (s:Skill { id: $id })
        SET s.name            = $name,
            s.toolName        = $toolName,
            s.toolDescription = $toolDescription,
            s.toolInputSchema = $inputSchema,
            s.cypherExecution = $cypher,
            s.skillType       = 'tool',
            s.category        = 'model-specific',
            s.enabled         = true,
            s.modelId         = $modelId,
            s.isAutoGenerated = true,
            s.updatedAt       = $now
      `, {
        id:               skillId,
        name:             def.toolDescription,
        toolName:         def.toolName,
        toolDescription:  def.toolDescription,
        inputSchema:      JSON.stringify(inputSchema),
        cypher:           def.cypherExecution,
        modelId,
        now,
      })
      saved++
    }

    send({ type: 'done', saved, total: skillDefs.length })
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (e) {
    send({ type: 'error', message: String(e) })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})

/* ── POST /api/ai/test-connection ──────────────────────────────────────────── */

aiRouter.post('/test-connection', async (req, res) => {
  const { provider, baseUrl, model, apiKey } = req.body as {
    provider?: string
    baseUrl?:  string
    model?:    string
    apiKey?:   string
  }

  try {
    // Ollama 专属：先查 /api/tags 验证服务运行 + 模型存在
    if (baseUrl && (baseUrl.includes(':11434') || baseUrl.toLowerCase().includes('ollama'))) {
      const base = baseUrl.replace(/\/$/, '')
      let tagsResp: globalThis.Response
      try {
        tagsResp = await fetch(`${base}/api/tags`)
      } catch {
        return res.json({ ok: false, msg: 'Ollama 未运行，请先执行 ollama serve' })
      }
      if (!tagsResp.ok) {
        return res.json({ ok: false, msg: `Ollama 未运行 (HTTP ${tagsResp.status})，请执行 ollama serve` })
      }
      const tags = await tagsResp.json() as { models?: { name: string }[] }
      const modelNames = (tags.models ?? []).map((m) => m.name)
      const list = modelNames.slice(0, 6).join('、') || '（暂无已下载模型）'
      if (model) {
        const exactMatch  = modelNames.find((n) => n === model)
        const prefixMatch = modelNames.find((n) => n.startsWith(model + ':'))
        if (!exactMatch && !prefixMatch) {
          return res.json({
            ok: false,
            msg: `模型 "${model}" 未在 Ollama 中找到。已安装：${list}。请运行 ollama pull <模型名>`,
          })
        }
        if (!exactMatch && prefixMatch) {
          return res.json({
            ok: false,
            msg: `请使用完整模型名 "${prefixMatch}"（Ollama 需要带标签，如 qwen3.5:9b）`,
          })
        }
      }
      return res.json({ ok: true, msg: `Ollama 连接正常，可用模型：${list}` })
    }

    // 通用：发一次 max_tokens=1 的探测请求
    let resp: globalThis.Response
    if (provider === 'anthropic') {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      model || 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages:   [{ role: 'user', content: 'hi' }],
        }),
      })
    } else {
      const base = (baseUrl || '').replace(/\/$/, '') || 'https://api.openai.com'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model:      model || 'gpt-4o',
          max_tokens: 1,
          messages:   [{ role: 'user', content: 'hi' }],
        }),
      })
    }

    if (resp.ok || resp.status === 400) {
      res.json({ ok: true, msg: '连接成功' })
    } else {
      const body = await resp.text().catch(() => '')
      res.json({ ok: false, msg: `HTTP ${resp.status}${body ? '：' + body.slice(0, 200) : ''}` })
    }
  } catch (e) {
    res.json({ ok: false, msg: String(e) })
  }
})

/* ── POST /api/ai/generate-data ─────────────────────────────────────────────
 * LLM-driven synthetic data generation per ontology model.
 * Streams SSE progress events; writes instance records directly to Neo4j.
 * ─────────────────────────────────────────────────────────────────────────── */

aiRouter.post('/generate-data', async (req: Request, res: ExpressResponse) => {
  const { twinId, twinName, modelId, config, aiConfig } = req.body as {
    twinId:    string
    twinName?: string
    modelId:   string
    config: {
      theme:         string
      entityCounts:  { entityNodeId: string; min: number; max: number }[]
      locale?:       string
      mode?:         'overwrite' | 'append'
    }
    aiConfig: AiServiceCfg
  }

  if (!twinId || !modelId || !aiConfig) {
    return res.status(400).json({ error: 'twinId, modelId, aiConfig are required' })
  }

  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')

  const sendEvent = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`)

  /* Reusable tool definition in SkillTool shape so callLLMOnce can consume it */
  const SUBMIT_TOOL: SkillTool = {
    id: '_gen',
    toolName:        'submit_entity_records',
    toolDescription: '提交为指定实体生成的仿真数据记录列表（必须调用此工具，禁止只输出文字）',
    toolInputSchema: {
      type: 'object',
      properties: {
        entity_name: { type: 'string', description: '实体英文名，须与 Schema 中 name 字段完全一致' },
        records: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: '生成的记录列表，每条记录为属性名→值的键值对',
        },
      },
      required: ['entity_name', 'records'],
    },
    cypherExecution: '',
  }

  try {
    /* 0. Ensure BizTwin node exists — avoids race condition where createTwin API
     *    hasn't completed yet by the time the user triggers generation.
     *    Use two separate statements to avoid MERGE accidentally creating a
     *    spurious OntologyModel node if the model doesn't exist yet. */
    await runWrite(
      `MERGE (t:BizTwin { id: $twinId })
       ON CREATE SET t.name = $twinName, t.createdAt = $now`,
      { twinId, twinName: twinName ?? twinId, now: new Date().toISOString() },
    )
    await runWrite(
      `MATCH (t:BizTwin { id: $twinId }), (m:OntologyModel { id: $modelId })
       MERGE (t)-[:USES_MODEL]->(m)`,
      { twinId, modelId },
    ).catch(() => { /* model may not exist yet — non-fatal */ })

    /* 1. Load entities from Neo4j */
    const entityRows = await runQuery(`
      MATCH (e:EntityDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      RETURN e { .* } AS entity
    `, { modelId })

    const allEntities = entityRows.map((r: any) => ({
      ...r.entity,
      properties: JSON.parse(r.entity.properties ?? '[]'),
    }))

    /* Build per-entity range map: { min, max } per entity, in submitted (user-specified) order */
    const entityRangeMap = new Map<string, { min: number; max: number }>(
      (config.entityCounts ?? []).map(({ entityNodeId, min, max }) => [
        entityNodeId,
        { min: Math.max(0, Math.min(500, min ?? 0)), max: Math.max(1, Math.min(500, max ?? 1)) },
      ])
    )

    /* Preserve user-defined ordering: build entity list in the order submitted */
    const entityById = new Map(allEntities.map((e: any) => [e.id, e]))
    const entities: any[] = (config.entityCounts ?? [])
      .map(({ entityNodeId }) => entityById.get(entityNodeId))
      .filter(Boolean)

    if (entities.length === 0) {
      sendEvent({ type: 'error', message: '未找到实体定义，请先在本体设计中创建实体' })
      res.write('data: [DONE]\n\n'); res.end(); return
    }

    const theme              = config.theme?.trim() || '通用企业业务系统'
    const locale             = config.locale ?? 'zh-CN'
    const mode               = config.mode   ?? 'overwrite'
    const total              = entities.length
    const extraInstructions  = ((config as any).extraInstructions as string | undefined)?.trim() || ''
    const DEFAULT_SYS_PROMPT = '你是仿真数据生成专家。优先调用 submit_entity_records 工具提交数据；若工具不可用，直接输出 JSON 数组。'
    const effectiveSysPrompt = ((config as any).systemPrompt as string | undefined)?.trim() || DEFAULT_SYS_PROMPT
    /* childEntityId → parentEntityId, sent from frontend batchParentMap */
    const hierParentIds: Record<string, string> = (config as any).hierParentIds ?? {}

    /* Load FK (foreign-key) relationships so prompts can reference exact values */
    const fkRelRows = await runQuery(`
      MATCH (r:RelDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      MATCH (r)-[:FROM]->(src:EntityDef)
      MATCH (r)-[:TO]->(tgt:EntityDef)
      WHERE r.sourceKey IS NOT NULL AND r.sourceKey <> ''
        AND r.targetKey IS NOT NULL AND r.targetKey <> ''
      RETURN src.id AS srcId, tgt.id AS tgtId, tgt.name AS tgtName, tgt.label AS tgtLabel,
             r.sourceKey AS sourceKey, r.targetKey AS targetKey, r.name AS relName,
             r.relationCategory AS relCategory, r.relationType AS relType
    `, { modelId }).catch(() => [] as any[])


    /*
     * generatedKeyValues[entityId][fieldName] = [...values already written]
     * Populated after each entity is written, used in subsequent entities' FK hints.
     */
    const generatedKeyValues: Record<string, Record<string, unknown[]>> = {}

    /*
     * allGeneratedRecordsMap[entityId] = all raw records written for that entity.
     * Used for batch-mode parent detection: batch mode triggers when parent has ANY
     * records, regardless of whether targetKey is configured on the relation.
     */
    const allGeneratedRecordsMap: Record<string, Record<string, unknown>[]> = {}

    /* Running context: first-property values of already-generated entities (for general hints) */
    const generatedSummary: Record<string, string[]> = {}

    /* 2. Generate each entity in user-specified order */
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const range = entityRangeMap.get(entity.id) ?? { min: 5, max: 10 }
      /* countPerParent will be re-randomised inside each batch (see below) */

      /*
       * Batch mode: frontend sends hierParentIds (childId → parentId).
       * If the parent was already generated, loop one LLM call per parent record.
       * Code controls the count and iteration; LLM only generates content.
       */
      const parentEntityId = hierParentIds[entity.id] ?? null
      const parentRecords: Record<string, unknown>[] =
        parentEntityId ? (allGeneratedRecordsMap[parentEntityId] ?? []) : []

      if (parentEntityId && parentRecords.length === 0) {
        sendEvent({
          type: 'warning',
          message: `⚠ 实体「${entity.label ?? entity.name}」的父级实体尚未生成，建议调整顺序，本次按平铺模式处理`,
        })
      }

      /* Look up FK keys from fkRelRows (for property-level FK enforcement, optional) */
      const fkForParent = parentRecords.length > 0
        ? (fkRelRows as any[]).find((fk: any) =>
            (fk.srcId === entity.id && fk.tgtId === parentEntityId) ||
            (fk.tgtId === entity.id && fk.srcId === parentEntityId)
          ) ?? null
        : null

      const hierParentFk = parentRecords.length > 0
        ? {
            tgtId:     parentEntityId,
            srcId:     entity.id,
            sourceKey: fkForParent?.sourceKey ?? null,
            targetKey: fkForParent?.targetKey ?? null,
          }
        : null

      /* One entry per parent record — parentVals[i] is the identifier used in the LLM prompt */
      const parentVals: unknown[] = (() => {
        if (!hierParentFk) return [null]
        const tk = (hierParentFk as any).targetKey as string | null
        return parentRecords.map((rec, idx) => {
          /* Use configured targetKey if available */
          if (tk && rec[tk] !== undefined && rec[tk] !== null && rec[tk] !== '') return rec[tk]
          /* Auto-detect: first non-internal string property */
          const strEntry = Object.entries(rec).find(([k, v]) =>
            !k.startsWith('_') && typeof v === 'string' && v !== ''
          )
          return strEntry?.[1] ?? Object.entries(rec).find(([k]) => !k.startsWith('_'))?.[1] ?? `record_${idx + 1}`
        })
      })()

      const batchTotal = parentVals.length
      const isBatchMode = hierParentFk !== null

      /* In overwrite mode, purge existing records ONCE before any batch */
      if (mode === 'overwrite') {
        await runWrite(
          `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
           WHERE n._entityDefId = $entityDefId
           DETACH DELETE n`,
          { twinId, entityDefId: entity.id },
        )
      }

      const propSpecs = (entity.properties ?? []).map((p: any) =>
        `- ${p.name}${p.nameZh ? `（${p.nameZh}）` : ''}: ${p.type}${p.required ? ' [必填]' : ''}${p.description ? '，说明：' + p.description : ''}`
      ).join('\n') || '（暂无属性定义）'

      /* Collect all records across batches for FK value harvesting */
      const allBatchRecords: Record<string, unknown>[] = []
      let globalIdx = 0  // global offset for stable _id generation

      for (let bi = 0; bi < parentVals.length; bi++) {
        const parentVal = parentVals[bi]

        if (isBatchMode) {
          sendEvent({
            type: 'entity_batch_progress',
            entity: entity.name,
            label: entity.label ?? entity.name,
            parentVal: String(parentVal),
            batchIndex: bi + 1,
            batchTotal,
          })
        } else {
          sendEvent({ type: 'progress', entity: entity.name, label: entity.label ?? entity.name, index: i + 1, total })
        }

        /* Pick a random count within [min, max] for this batch */
        const countPerParent = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min
        if (countPerParent === 0) continue  // min=0 允许此父节点下不生成该实体

        const prevCtx = Object.entries(generatedSummary)
          .map(([name, vals]) => `${name}: ${vals.join(', ')}`)
          .join('\n') || '（尚无已生成数据）'

        /* Build FK constraint hints */
        const fkHints: string[] = []

        /* When in batch mode and sourceKey is configured, inject hard parent constraint */
        const hierSk = isBatchMode ? ((hierParentFk as any)?.sourceKey as string | null) : null
        if (isBatchMode && !hierSk) {
          /* sourceKey not configured: give the LLM soft context about which parent this batch belongs to */
          const parentEntityLabel = entities.find((e: any) => e.id === (hierParentFk as any)?.tgtId)?.label
            ?? entities.find((e: any) => e.id === (hierParentFk as any)?.tgtId)?.name
            ?? '父级'
          fkHints.push(
            `- ⚠️ 本批次数据属于「${parentEntityLabel}」「${parentVal}」，所有记录必须与该父级保持逻辑一致`
          )
        }

        for (const fk of fkRelRows as any[]) {
          if (fk.srcId !== entity.id) continue

          /* Hierarchical parent FK with a configured sourceKey → hard constraint */
          if (isBatchMode && hierSk && hierSk === fk.sourceKey) {
            fkHints.push(
              `- ⚠️ 字段「${fk.sourceKey}」必须固定填写 "${parentVal}"，严禁更改，不得选择其他值`
            )
            continue
          }

          const tgtLabel = fk.tgtLabel ?? fk.tgtName
          const availableValues = generatedKeyValues[fk.tgtId]?.[fk.targetKey] ?? []
          if (availableValues.length > 0) {
            fkHints.push(
              `- 字段「${fk.sourceKey}」必须从以下已生成的「${tgtLabel}」的 ${fk.targetKey} 值中随机选取（实现"${fk.relName}"关联）：\n  ${availableValues.slice(0, 20).join('、')}`
            )
          } else {
            fkHints.push(
              `- 字段「${fk.sourceKey}」对应关系「${fk.relName}」，目标实体「${tgtLabel}」尚未生成，请自行生成合理的值并保持格式一致`
            )
          }
        }
        const fkSection = fkHints.length > 0
          ? `\n\n外键字段要求（⚠️ 必须严格遵守，否则实体间无法建立图谱关联）：\n${fkHints.join('\n')}`
          : ''

        const userMsg =
`请为实体「${entity.label ?? entity.name}（${entity.name}）」生成 ${countPerParent} 条仿真数据。

业务主题：${theme}
数据语言：${locale === 'zh-CN' ? '中文（姓名、机构、地名等均使用中文）' : '英文'}
实体描述：${entity.description || '无'}

属性规格（必须严格遵守类型和枚举范围）：
${propSpecs}

已生成实体数据摘要（外键引用请使用其中的值）：
${prevCtx}${fkSection}

要求：
1. 生成恰好 ${countPerParent} 条记录，每条必须包含全部必填属性
2. 枚举类型字段只取属性描述中列举的合法值
3. number 字段填数字，date 字段填 ISO 格式日期（如 2024-03-15），boolean 字段填 true/false
4. 优先通过 submit_entity_records 工具一次性提交所有记录；若无法调用工具，则直接输出纯 JSON 数组（不要任何额外说明）${extraInstructions ? `\n\n额外要求：\n${extraInstructions}` : ''}`

        let batchRecords: Record<string, unknown>[] = []
        let rawResult: unknown
        try {
          rawResult = await callLLMOnce(
            aiConfig,
            [{ role: 'user', content: userMsg }],
            effectiveSysPrompt,
            [SUBMIT_TOOL],
            'submit_entity_records',
          )
          const result = rawResult as any

          /* ── Path 1: tool call extraction ── */
          if (aiConfig.provider === 'anthropic') {
            for (const block of (result.content ?? [])) {
              if (block.type === 'tool_use' && block.name === 'submit_entity_records') {
                batchRecords = Array.isArray(block.input?.records) ? block.input.records : []
                break
              }
            }
          } else {
            const toolCalls = result.choices?.[0]?.message?.tool_calls ?? []
            for (const tc of toolCalls) {
              if (tc.function?.name === 'submit_entity_records') {
                try { batchRecords = JSON.parse(tc.function.arguments ?? '{}').records ?? [] } catch {}
                break
              }
            }
          }

          /* ── Path 2: JSON text fallback ── */
          if (batchRecords.length === 0) {
            const textContent: string = aiConfig.provider === 'anthropic'
              ? (result.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
              : (result.choices?.[0]?.message?.content ?? '')

            if (textContent) {
              /* Try ```json ... ``` code block first, then bare JSON */
              const codeMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/)
              const jsonStr = codeMatch ? codeMatch[1].trim() : (() => {
                const start = textContent.indexOf('[')
                return start !== -1 ? textContent.slice(start) : ''
              })()

              if (jsonStr) {
                try {
                  const parsed = JSON.parse(jsonStr)
                  if (Array.isArray(parsed) && parsed.length > 0)
                    batchRecords = parsed
                  else if (parsed?.records && Array.isArray(parsed.records) && parsed.records.length > 0)
                    batchRecords = parsed.records
                } catch { /* ignore parse failure */ }
              }
            }
          }
        } catch (e) {
          sendEvent({ type: 'entity_error', entity: entity.name, label: entity.label ?? entity.name, message: String(e) })
          continue
        }

        if (batchRecords.length === 0) {
          const rawSnippet = JSON.stringify(rawResult ?? '').slice(0, 400)
          sendEvent({ type: 'entity_error', entity: entity.name, label: entity.label ?? entity.name,
            message: `LLM 未返回有效记录。响应片段：${rawSnippet}` })
          continue
        }

        /* Write this batch — overwrite already deleted above, so always CREATE here */
        const ts = new Date().toISOString()
        const propsList = batchRecords.map((rec: Record<string, unknown>, idx: number) => {
          const props: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(rec)) {
            if (v !== null && v !== undefined && k !== 'entity_name') props[k] = v
          }
          /* Force-inject fixed parent value when sourceKey is configured */
          if (isBatchMode && hierParentFk && (hierParentFk as any).sourceKey) {
            props[(hierParentFk as any).sourceKey] = parentVal
          }
          props._id          = `gen-${entity.id.slice(-6)}-${globalIdx + idx}-${Math.random().toString(36).slice(2, 7)}`
          props._twinId      = twinId
          props._entityDefId = entity.id
          props._datasetId   = `${twinId}:${entity.id}`
          props._modelId     = modelId
          props._sourceLabel = `AI生成·${new Date().toLocaleDateString('zh-CN')}`
          props._importedAt  = ts
          return props
        })

        if (isBatchMode || mode === 'overwrite') {
          /* Batch mode always CREATEs (overwrite delete happened above) */
          await runWrite(`
            MATCH (t:BizTwin { id: $twinId })
            OPTIONAL MATCH (e:EntityDef { id: $entityDefId })
            WITH t, e
            UNWIND $propsList AS props
            CREATE (n:EntityInstance)
            SET n = props
            CREATE (n)-[:IN_TWIN]->(t)
            WITH n, e WHERE e IS NOT NULL
            CREATE (n)-[:INSTANCE_OF]->(e)
          `, { twinId, entityDefId: entity.id, propsList })
        } else {
          /* Flat append mode — MERGE on unique-key props to deduplicate */
          const uniqueProps: string[] = (entity.properties ?? [])
            .filter((p: any) => p.unique === true)
            .map((p: any) => String(p.name))

          if (uniqueProps.length > 0) {
            const mergeKeyExpr = uniqueProps.map((k) => `\`${k}\`: props.\`${k}\``).join(', ')
            await runWrite(`
              MATCH (t:BizTwin { id: $twinId })
              OPTIONAL MATCH (e:EntityDef { id: $entityDefId })
              WITH t, e
              UNWIND $propsList AS props
              MERGE (n:EntityInstance { _twinId: $twinId, _entityDefId: $entityDefId, ${mergeKeyExpr} })
                ON CREATE SET n = props
                ON MATCH  SET n += props
              MERGE (n)-[:IN_TWIN]->(t)
              WITH n, e WHERE e IS NOT NULL
              MERGE (n)-[:INSTANCE_OF]->(e)
            `, { twinId, entityDefId: entity.id, propsList })
          } else {
            await runWrite(`
              MATCH (t:BizTwin { id: $twinId })
              OPTIONAL MATCH (e:EntityDef { id: $entityDefId })
              WITH t, e
              UNWIND $propsList AS props
              CREATE (n:EntityInstance)
              SET n = props
              CREATE (n)-[:IN_TWIN]->(t)
              WITH n, e WHERE e IS NOT NULL
              CREATE (n)-[:INSTANCE_OF]->(e)
            `, { twinId, entityDefId: entity.id, propsList })
          }
        }

        allBatchRecords.push(...batchRecords)
        globalIdx += batchRecords.length
      }  // end per-parent batch loop

      if (allBatchRecords.length === 0) continue

      /* Collect generated field values for subsequent entities' FK hints */
      const keyProp = (entity.properties ?? [])[0]?.name
      if (keyProp) {
        generatedSummary[entity.name] = allBatchRecords
          .slice(0, 8)
          .map((r: Record<string, unknown>) => String(r[keyProp] ?? ''))
          .filter(Boolean)
      }

      /* Accumulate ALL fields that other entities may reference as FK targetKey */
      const entityKeyMap: Record<string, unknown[]> = {}
      for (const fk of fkRelRows as any[]) {
        if (fk.tgtId !== entity.id) continue
        const field = fk.targetKey as string
        if (!entityKeyMap[field]) {
          entityKeyMap[field] = allBatchRecords
            .map((r: Record<string, unknown>) => r[field])
            .filter((v) => v !== null && v !== undefined && v !== '')
        }
      }
      if (Object.keys(entityKeyMap).length > 0) {
        generatedKeyValues[entity.id] = entityKeyMap
      }

      /* Store all raw records so child entities can batch over them */
      allGeneratedRecordsMap[entity.id] = allBatchRecords

      sendEvent({ type: 'entity_done', entity: entity.name, label: entity.label ?? entity.name, count: allBatchRecords.length })
    }  // end entity loop

    /* 3. Deduplication: remove instances with identical business-field values */
    try {
      let dedupRemoved = 0
      let dedupKept = 0

      for (const entity of entities) {
        const rows = await runQuery(
          `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
           WHERE n._entityDefId = $entityDefId
           RETURN n { .* } AS inst`,
          { twinId, entityDefId: entity.id },
        )

        /* Build fingerprint from all non-internal (non-underscore) fields */
        const fingerprint = (inst: Record<string, unknown>) =>
          JSON.stringify(
            Object.entries(inst)
              .filter(([k]) => !k.startsWith('_'))
              .sort(([a], [b]) => a.localeCompare(b)),
          )

        const seen = new Map<string, string>()  // fingerprint → _id to keep
        const toDelete: string[] = []

        for (const row of rows as any[]) {
          const inst = row.inst as Record<string, unknown>
          const key  = fingerprint(inst)
          const id   = inst._id as string
          if (seen.has(key)) {
            toDelete.push(id)
          } else {
            seen.set(key, id)
            dedupKept++
          }
        }

        if (toDelete.length > 0) {
          await runWrite(
            `MATCH (n:EntityInstance) WHERE n._id IN $ids DETACH DELETE n`,
            { ids: toDelete },
          )
          dedupRemoved += toDelete.length
          dedupKept    -= toDelete.length  // kept count already incremented above
        }
      }

      /* Correct kept count (was over-counted before deletes) */
      dedupKept += dedupRemoved  // restore: kept = total - removed

      if (dedupRemoved > 0) {
        sendEvent({ type: 'dedup_done', removed: dedupRemoved, kept: dedupKept - dedupRemoved })
      }
    } catch { /* deduplication is best-effort */ }

    /* 4. Best-effort relink (FK-based instance relations) */
    try {
      const relRows = await runQuery(`
        MATCH (r:RelDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
        WHERE r.sourceKey IS NOT NULL AND r.targetKey IS NOT NULL
          AND r.sourceKey <> '' AND r.targetKey <> ''
        MATCH (r)-[:FROM]->(src:EntityDef)
        MATCH (r)-[:TO]->(tgt:EntityDef)
        RETURN r.name AS relName, src.id AS srcId, tgt.id AS tgtId,
               r.sourceKey AS sourceKey, r.targetKey AS targetKey
      `, { modelId })

      for (const row of relRows as any[]) {
        const relType = String(row.relName).replace(/\s+/g, '_').toUpperCase()
        await runWrite(
          `MATCH (a:EntityInstance { _entityDefId: $srcId })-[:IN_TWIN]->(t:BizTwin { id: $twinId })
           MATCH (b:EntityInstance { _entityDefId: $tgtId })-[:IN_TWIN]->(t)
           WHERE a[$sourceKey] IS NOT NULL AND a[$sourceKey] = b[$targetKey]
           MERGE (a)-[:${relType} { _relDefBased: true }]->(b)`,
          { twinId, srcId: row.srcId, tgtId: row.tgtId, sourceKey: row.sourceKey, targetKey: row.targetKey },
        )
      }

      if (relRows.length > 0) {
        sendEvent({ type: 'relink_done', relationsLinked: relRows.length })
      }
    } catch { /* relink is best-effort, do not fail the whole request */ }

    /* Verify actual records written to Neo4j (avoids reporting ghost counts) */
    const verifyRows = await runQuery(
      `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
       WHERE n._entityDefId IN $entityIds
       RETURN count(n) AS cnt`,
      { twinId, entityIds: entities.map((e: any) => e.id) },
    ).catch(() => [])
    const actualCount = Number((verifyRows[0] as any)?.cnt ?? 0)
    sendEvent({ type: 'done', totalEntities: entities.length, totalRecords: actualCount })
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (e) {
    sendEvent({ type: 'error', message: String(e) })
    res.write('data: [DONE]\n\n')
    res.end()
  }
})
