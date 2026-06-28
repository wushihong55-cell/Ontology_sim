export interface SkillDef {
  id: string
  name: string
  description: string
  category: 'ontology' | 'graph-query' | 'data-import' | 'cypher-gen' | 'reasoning' | 'monitoring'
  skillType: 'workflow' | 'tool'
  systemPrompt: string
  cypherRead: string
  cypherWrite: string
  outputSchema: string
  toolName: string
  toolDescription: string
  toolInputSchema: Record<string, unknown>
  cypherExecution: string
  enabled: boolean
  version: string
}

export const BUILT_IN_SKILLS: SkillDef[] = [

  /* ════════════════════════════════════════════════════════════════
     本体设计（ontology）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-ontology-suggest',
    name:            '本体建议',
    description:     '根据用户描述建议新的实体或关系，并可写入本体模型',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'ontology_suggest',
    toolDescription: '当用户希望扩展本体、添加新实体或关系时调用。根据用户意图建议实体名称、属性和关系，并以 JSON 返回建议列表',
    toolInputSchema: {
      type: 'object',
      properties: {
        context:     { type: 'string', description: '当前本体的背景描述' },
        userRequest: { type: 'string', description: '用户的具体需求' },
      },
      required: ['userRequest'],
    },
    cypherExecution: `MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)
RETURN e.name AS name, e.label AS label, e.description AS desc
ORDER BY e.name
LIMIT 50`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-consistency-check',
    name:            '一致性检查',
    description:     '检查本体中的孤立实体、缺少属性的节点、重复命名等问题',
    category:        'ontology',
    skillType:       'workflow',
    systemPrompt:    `你是本体质量检查专家。以下是查询出的本体问题数据，请用中文给出结构化的问题报告和改进建议。`,
    cypherRead:      `MATCH (e:EntityDef)
WHERE NOT (e)-[:FROM|TO]-()
RETURN '孤立实体' AS issueType, e.label AS name, '' AS detail
UNION
MATCH (e:EntityDef)
WHERE NOT apoc.text.contains(e.properties, '"required":true')
RETURN '无必填属性' AS issueType, e.label AS name, '' AS detail`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-property-generator',
    name:            '属性生成',
    description:     '根据实体名称和描述，由大模型自动建议属性列表',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'property_generator',
    toolDescription: '当用户需要为某个实体快速生成属性建议时调用。传入实体名称和描述，返回推荐属性列表（含名称、类型、是否必填）',
    toolInputSchema: {
      type: 'object',
      properties: {
        entityName:        { type: 'string', description: '实体名称（英文）' },
        entityLabel:       { type: 'string', description: '实体显示名（中文）' },
        entityDescription: { type: 'string', description: '实体描述' },
      },
      required: ['entityName'],
    },
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-ontology-doc-export',
    name:            '本体文档导出',
    description:     '将本体模型自动转成中文规范说明文档，含实体列表、属性表和关系表',
    category:        'ontology',
    skillType:       'workflow',
    systemPrompt:    `你是技术文档专家。根据以下本体模型数据，用中文生成一份结构清晰的规范说明文档，包含：
1. 模型概述
2. 实体定义表（名称、标签、描述、属性列表）
3. 关系定义表（关系名、起点实体、终点实体、基数、描述）
4. 注意事项

输出格式为 Markdown。`,
    cypherRead:      `MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)
OPTIONAL MATCH (r:RelDef)-[:FROM]->(e)
OPTIONAL MATCH (r2:RelDef)-[:TO]->(e)
RETURN m.name AS modelName, m.description AS modelDesc,
       e.label AS entityLabel, e.name AS entityName,
       e.description AS entityDesc, e.entityType AS entityType,
       e.properties AS propertiesJson,
       collect(DISTINCT { name: r.name, label: r.label, target: r.name }) AS outRels,
       collect(DISTINCT { name: r2.name, label: r2.label, source: r2.name }) AS inRels
ORDER BY m.name, e.name`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-entity-similarity',
    name:            '实体相似度检测',
    description:     '扫描所有实体，找出名称或描述语义相近的节点，防止重复建模',
    category:        'ontology',
    skillType:       'workflow',
    systemPrompt:    `你是本体质量专家。以下是图谱中所有实体的定义列表，请识别出语义高度相似或可能重复的实体对，给出相似度说明和合并建议。输出格式：相似实体对列表，每对包含两个实体名、相似原因、建议处理方式（合并/保留/重命名）。`,
    cypherRead:      `MATCH (e:EntityDef)
RETURN e.id AS id, e.name AS name, e.label AS label,
       e.description AS description, e.entityType AS entityType
ORDER BY e.name`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-relation-completion',
    name:            '关系补全建议',
    description:     '根据选定实体集合，由大模型推断可能遗漏的语义关系',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'relation_completion',
    toolDescription: '当用户选定若干实体并希望发现遗漏关系时调用。分析实体语义，推断可能存在但尚未定义的关系，返回建议关系列表',
    toolInputSchema: {
      type: 'object',
      properties: {
        entityIds:   { type: 'array', items: { type: 'string' }, description: '目标实体 ID 列表' },
        domainHint:  { type: 'string', description: '业务领域提示，如"供应链"、"医疗"，可留空' },
      },
      required: ['entityIds'],
    },
    cypherExecution: `MATCH (e:EntityDef) WHERE e.id IN $entityIds
OPTIONAL MATCH (r:RelDef)-[:FROM]->(e)-[:BELONGS_TO]->(m:OntologyModel)
OPTIONAL MATCH (r2:RelDef)-[:TO]->(e)
RETURN e.id AS id, e.name AS name, e.label AS label, e.description AS description,
       collect(DISTINCT { rel: r.name, direction: 'out' }) +
       collect(DISTINCT { rel: r2.name, direction: 'in' }) AS existingRelations`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-constraint-generator',
    name:            '约束规则生成',
    description:     '为实体生成 Cypher 唯一性约束和必填属性约束语句，可直接执行到 Neo4j',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'constraint_generator',
    toolDescription: '当用户需要为某实体生成数据库约束规则时调用。根据属性定义生成 CREATE CONSTRAINT Cypher 语句',
    toolInputSchema: {
      type: 'object',
      properties: {
        entityId:        { type: 'string', description: '目标实体 ID' },
        constraintTypes: {
          type: 'array',
          items: { type: 'string', enum: ['unique', 'notNull', 'range', 'enum'] },
          description: '需要生成的约束类型',
        },
      },
      required: ['entityId'],
    },
    cypherExecution: `MATCH (e:EntityDef { id: $entityId })
RETURN e.name AS name, e.label AS label, e.properties AS propertiesJson`,
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     图谱查询（graph-query）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-graph-summary',
    name:            '图谱摘要',
    description:     '统计图谱中节点数量、关系类型分布，生成中文摘要',
    category:        'graph-query',
    skillType:       'workflow',
    systemPrompt:    `你是图谱数据分析专家。以下是图谱统计数据，请用中文输出一份简洁的摘要报告，包括规模、主要实体类型和关系分布。`,
    cypherRead:      `MATCH (n:EntityInstance) RETURN labels(n) AS labels, count(*) AS cnt
ORDER BY cnt DESC`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-path-finder',
    name:            '路径查询',
    description:     '查找图谱中两个节点之间的最短路径',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'path_finder',
    toolDescription: '当用户询问两个实体之间的关系路径、连接方式时调用。传入两个节点的标识属性，返回最短路径信息',
    toolInputSchema: {
      type: 'object',
      properties: {
        fromLabel: { type: 'string', description: '起始节点的实体类型标签' },
        fromProp:  { type: 'string', description: '起始节点的标识属性名' },
        fromValue: { type: 'string', description: '起始节点的标识属性值' },
        toLabel:   { type: 'string', description: '目标节点的实体类型标签' },
        toProp:    { type: 'string', description: '目标节点的标识属性名' },
        toValue:   { type: 'string', description: '目标节点的标识属性值' },
        maxDepth:  { type: 'number', description: '最大路径深度，默认 6' },
      },
      required: ['fromLabel', 'fromProp', 'fromValue', 'toLabel', 'toProp', 'toValue'],
    },
    cypherExecution: `MATCH p = shortestPath(
  (a:\`$fromLabel\` { $fromProp: $fromValue })-[*..6]-(b:\`$toLabel\` { $toProp: $toValue })
)
RETURN [n IN nodes(p) | { labels: labels(n), props: properties(n) }] AS path,
       length(p) AS pathLength`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-neighbor-lookup',
    name:            '邻居查询',
    description:     '获取指定节点的 N 阶邻居',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'neighbor_lookup',
    toolDescription: '当用户想了解某个实体的关联实体、上下游关系时调用。传入节点标识，返回指定深度内的邻居节点列表',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeLabel: { type: 'string', description: '节点的实体类型标签' },
        propName:  { type: 'string', description: '标识属性名' },
        propValue: { type: 'string', description: '标识属性值' },
        depth:     { type: 'number', description: '查询深度，默认 2' },
      },
      required: ['nodeLabel', 'propName', 'propValue'],
    },
    cypherExecution: `MATCH (n:\`$nodeLabel\` { $propName: $propValue })-[r*1..2]-(neighbor)
RETURN DISTINCT labels(neighbor) AS labels, properties(neighbor) AS props
LIMIT 50`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-impact-analysis',
    name:            '影响分析',
    description:     '分析某节点变更后哪些下游节点会受到影响，适用于供应链、流程依赖等场景',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'impact_analysis',
    toolDescription: '当用户问"如果某个节点发生变化，哪些环节会受影响"时调用。沿有向关系向下遍历，返回各层级的影响节点',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeId:   { type: 'string', description: '起始节点的 _id 属性值' },
        maxDepth: { type: 'number', description: '最大传播深度，默认 5' },
      },
      required: ['nodeId'],
    },
    cypherExecution: `MATCH path = (start { _id: $nodeId })-[*1..5]->(affected)
RETURN DISTINCT labels(affected) AS labels,
       properties(affected) AS props,
       length(path) AS depth
ORDER BY depth
LIMIT 100`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-centrality-analysis',
    name:            '中心性分析',
    description:     '统计节点连接度排名，找出图谱中连接最多的"枢纽节点"',
    category:        'graph-query',
    skillType:       'workflow',
    systemPrompt:    `你是图谱分析专家。以下是图谱中连接度最高的节点列表，请用中文分析这些枢纽节点的业务含义，说明它们为什么重要，以及高连接度可能带来的风险或机遇。`,
    cypherRead:      `MATCH (n:EntityInstance)
WITH n, size((n)--()) AS degree
ORDER BY degree DESC
LIMIT 20
RETURN labels(n) AS labels, properties(n) AS props, degree`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-cycle-detection',
    name:            '环路检测',
    description:     '检测图谱中是否存在循环依赖，适用于流程建模和依赖管理场景',
    category:        'graph-query',
    skillType:       'workflow',
    systemPrompt:    `你是图谱质量专家。以下是图谱中检测到的环路数据，请用中文说明每个环路的含义，分析是否是正常的业务循环还是错误的循环依赖，并给出处理建议。`,
    cypherRead:      `MATCH path = (n)-[*2..8]->(n)
RETURN [node IN nodes(path) | { labels: labels(node), id: node._id, name: coalesce(node.name, node._id) }] AS cycle,
       length(path) AS cycleLength
LIMIT 10`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-graph-compare',
    name:            '图谱对比',
    description:     '对比两个业务孪生的实例数据差异，输出新增、删除、变更记录',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'graph_compare',
    toolDescription: '当用户需要对比两个业务孪生数据集之间差异时调用。返回两个孪生在同类实体上的数量差异和属性差异',
    toolInputSchema: {
      type: 'object',
      properties: {
        twinId1:     { type: 'string', description: '第一个业务孪生 ID（基准）' },
        twinId2:     { type: 'string', description: '第二个业务孪生 ID（对比目标）' },
        entityLabel: { type: 'string', description: '限定对比的实体类型标签，留空则全部对比' },
      },
      required: ['twinId1', 'twinId2'],
    },
    cypherExecution: `MATCH (a:EntityInstance)-[:IN_TWIN]->(t1:BizTwin { id: $twinId1 })
WITH collect({ labels: labels(a), id: a._id, props: properties(a) }) AS twin1Data
MATCH (b:EntityInstance)-[:IN_TWIN]->(t2:BizTwin { id: $twinId2 })
RETURN twin1Data, collect({ labels: labels(b), id: b._id, props: properties(b) }) AS twin2Data`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-list-instances',
    name:            '实例列表查询',
    description:     '查询指定实体类型的实例数据列表，支持条件过滤和属性筛选',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'list_instances',
    toolDescription: '当用户需要查看某类实体的具体实例数据（如"列出所有员工"、"查看本月的出差申请"）时调用。传入自然语言描述的查询需求，系统自动生成并执行 Cypher 返回真实数据',
    toolInputSchema: {
      type: 'object',
      properties: {
        naturalLanguage: { type: 'string', description: '查询需求的自然语言描述，如"列出所有员工姓名和部门"、"查询金额大于5000的报销申请"' },
        twinId:          { type: 'string', description: '限定业务孪生 ID，留空则全图查询' },
      },
      required: ['naturalLanguage'],
    },
    cypherExecution: `// 此技能通过 nl_to_cypher 路径动态生成 Cypher，此字段仅作标记
// 实际执行由后端 NL_CYPHER_TOOLS 集合拦截并调用 executeNlToCypher()`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-aggregate-stats',
    name:            '聚合统计',
    description:     '自然语言描述聚合需求，生成并执行 COUNT/SUM/AVG 类查询',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'aggregate_stats',
    toolDescription: '当用户需要统计数量、求和、平均值等聚合分析时调用，如"统计各部门员工数量"、"计算平均报销金额"、"按月统计出差次数"',
    toolInputSchema: {
      type: 'object',
      properties: {
        naturalLanguage: { type: 'string', description: '聚合分析需求的自然语言描述' },
        twinId:          { type: 'string', description: '限定在哪个业务孪生内统计，留空则全图统计' },
      },
      required: ['naturalLanguage'],
    },
    cypherExecution: `// 此技能通过 nl_to_cypher 路径动态生成 Cypher，此字段仅作标记
// 实际执行由后端 NL_CYPHER_TOOLS 集合拦截并调用 executeNlToCypher()`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-subgraph-extract',
    name:            '子图提取',
    description:     '以指定节点为中心提取 N 阶子图，用于局部可视化或导出分析',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'subgraph_extract',
    toolDescription: '当用户需要围绕某个核心节点查看其完整局部图谱时调用。返回中心节点及其 N 阶范围内的所有节点和关系',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeId:      { type: 'string', description: '中心节点的 _id 属性值' },
        depth:       { type: 'number', description: '提取深度，默认 2' },
        maxNodes:    { type: 'number', description: '最大节点数量，默认 50' },
      },
      required: ['nodeId'],
    },
    cypherExecution: `MATCH (center { _id: $nodeId })
OPTIONAL MATCH (center)-[r*1..2]-(neighbor)
WITH center, collect(DISTINCT neighbor) AS neighbors,
     collect(DISTINCT r) AS rels
RETURN { labels: labels(center), props: properties(center) } AS center,
       [n IN neighbors | { labels: labels(n), props: properties(n) }] AS neighbors,
       size(neighbors) AS neighborCount
LIMIT 1`,
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     数据导入（data-import）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-field-mapper',
    name:            '字段映射',
    description:     '读取 CSV 表头，由大模型自动映射到 EntityDef 属性',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据映射专家。根据提供的 CSV 表头列表和目标实体的属性定义，输出一个 JSON 映射表：{ "csvHeader": "entityPropName" | null }。无法映射的字段设为 null。只输出 JSON，不要解释。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '{"type":"object","additionalProperties":{"type":["string","null"]}}',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-import-validator',
    name:            '导入验证',
    description:     '校验导入数据的必填字段完整性，返回问题记录',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据质量检查专家。以下是验证结果数据，请用中文汇总问题，说明哪些记录缺少哪些必填字段，给出修复建议。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-duplicate-detection',
    name:            '重复记录检测',
    description:     '导入前扫描新数据与已有实例的重复情况，按相似度给出合并建议',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据质量专家。以下是当前图谱中已有的实例记录。用户将要导入新数据，请根据提供的已有记录，识别出可能重复的记录对，给出相似度评分和合并建议（覆盖/跳过/手动确认）。`,
    cypherRead:      `MATCH (n:EntityInstance)-[:INSTANCE_OF]->(e:EntityDef { id: $entityDefId })
RETURN n._id AS id, properties(n) AS props
LIMIT 500`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-data-cleaning',
    name:            '数据清洗建议',
    description:     '分析导入数据的格式问题、空值比例和异常值，给出逐列清洗方案',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据清洗专家。以下是待导入数据的样本和统计信息，请用中文逐列分析数据质量问题，包括：
1. 空值/缺失值情况
2. 格式不一致（如日期、电话、编号格式）
3. 异常值和离群点
4. 推荐的清洗转换规则

输出格式：每列一个分析条目。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-relation-inference',
    name:            '关联关系推断',
    description:     '导入实例时，LLM 根据共享属性值自动推断实例间的语义关系并创建边',
    category:        'data-import',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'relation_inference',
    toolDescription: '当用户导入实例数据并希望自动建立实例间关系时调用。根据指定的共享属性（如项目编号、组织ID）找出应该关联的实例对，创建关系边',
    toolInputSchema: {
      type: 'object',
      properties: {
        twinId:           { type: 'string', description: '业务孪生 ID' },
        sourceEntityDefId:{ type: 'string', description: '源实体类型 ID' },
        targetEntityDefId:{ type: 'string', description: '目标实体类型 ID' },
        sharedPropName:   { type: 'string', description: '用于推断关联的共享属性名，如 projectId、orgCode' },
        relationName:     { type: 'string', description: '创建关系的类型名称，如 BELONGS_TO' },
      },
      required: ['twinId', 'sourceEntityDefId', 'targetEntityDefId', 'sharedPropName', 'relationName'],
    },
    cypherExecution: `MATCH (a:EntityInstance)-[:INSTANCE_OF]->(e1:EntityDef { id: $sourceEntityDefId }),
      (b:EntityInstance)-[:INSTANCE_OF]->(e2:EntityDef { id: $targetEntityDefId })
WHERE a[$sharedPropName] = b[$sharedPropName]
  AND a[$sharedPropName] IS NOT NULL
MERGE (a)-[r:\`$relationName\`]->(b)
RETURN count(r) AS createdRelations`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-incremental-update',
    name:            '增量更新',
    description:     '对比已有实例和新数据，仅写入差异部分，避免全量重导',
    category:        'data-import',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'incremental_update',
    toolDescription: '当用户需要更新已有实例数据而不是全量覆盖时调用。根据唯一标识属性进行 MERGE，只更新发生变化的字段',
    toolInputSchema: {
      type: 'object',
      properties: {
        twinId:       { type: 'string', description: '业务孪生 ID' },
        entityDefId:  { type: 'string', description: '实体类型 ID' },
        uniqueKey:    { type: 'string', description: '用于唯一标识记录的属性名，如 id、code、serialNo' },
        records:      { type: 'array', items: { type: 'object' }, description: '新数据记录列表' },
      },
      required: ['twinId', 'entityDefId', 'uniqueKey', 'records'],
    },
    cypherExecution: `UNWIND $records AS row
MATCH (n:EntityInstance { _entityDefId: $entityDefId })-[:IN_TWIN]->(t:BizTwin { id: $twinId })
WHERE n[$uniqueKey] = row[$uniqueKey]
SET n += row
RETURN count(n) AS updatedCount`,
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     Cypher 生成（cypher-gen）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-nl-to-cypher',
    name:            '自然语言转 Cypher',
    description:     '将用户自然语言查询需求转换为 Cypher 语句',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'nl_to_cypher',
    toolDescription: '当用户用自然语言描述想查询图谱数据的需求时调用。将需求转换为可执行的 Cypher 语句，并说明查询逻辑',
    toolInputSchema: {
      type: 'object',
      properties: {
        naturalLanguage: { type: 'string', description: '用户的查询需求描述' },
        schemaContext:   { type: 'string', description: '当前图谱的 Schema 摘要（可选）' },
        executeResult:   { type: 'boolean', description: '是否直接执行生成的 Cypher，默认 false' },
      },
      required: ['naturalLanguage'],
    },
    cypherExecution: `// 此 skill 的 Cypher 由 LLM 动态生成，不使用固定模板`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-cypher-explain',
    name:            'Cypher 解释',
    description:     '解释现有 Cypher 查询的含义和执行逻辑',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'cypher_explain',
    toolDescription: '当用户粘贴了一段 Cypher 语句并希望理解其含义时调用。逐步解释 Cypher 的查询逻辑、匹配条件和返回结果',
    toolInputSchema: {
      type: 'object',
      properties: {
        cypher: { type: 'string', description: '需要解释的 Cypher 语句' },
      },
      required: ['cypher'],
    },
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-query-optimizer',
    name:            '查询优化建议',
    description:     '分析 Cypher 查询瓶颈，给出索引建议和重写方案',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'query_optimizer',
    toolDescription: '当用户遇到 Cypher 查询慢、需要性能优化时调用。分析查询结构，建议添加索引、重写 MATCH 顺序或拆分子查询',
    toolInputSchema: {
      type: 'object',
      properties: {
        cypher:       { type: 'string', description: '需要优化的 Cypher 语句' },
        problemDesc:  { type: 'string', description: '性能问题描述，如"查询超时"、"结果数量过大"' },
      },
      required: ['cypher'],
    },
    cypherExecution: `EXPLAIN $cypher`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-update-statement-gen',
    name:            '更新语句生成',
    description:     '自然语言描述写操作，生成带预览的 MERGE/SET/DELETE Cypher',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'update_statement_gen',
    toolDescription: '当用户需要修改、新增或删除图谱数据时调用。根据自然语言描述生成写操作 Cypher 并展示预览，用户确认后再执行',
    toolInputSchema: {
      type: 'object',
      properties: {
        naturalLanguage:  { type: 'string', description: '写操作的自然语言描述' },
        operationType:    { type: 'string', enum: ['create', 'update', 'delete', 'merge'], description: '操作类型' },
        targetEntityLabel:{ type: 'string', description: '目标实体标签（可选）' },
        dryRun:           { type: 'boolean', description: '是否只生成 Cypher 不执行，默认 true' },
      },
      required: ['naturalLanguage'],
    },
    cypherExecution: `// 此 skill 的写操作 Cypher 由 LLM 根据 naturalLanguage 动态生成
// dryRun=true 时仅返回生成的 Cypher 字符串`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-cypher-unit-test',
    name:            'Cypher 单元测试生成',
    description:     '为一段 Cypher 自动生成可验证其正确性的测试数据和断言语句',
    category:        'cypher-gen',
    skillType:       'workflow',
    systemPrompt:    `你是 Neo4j 测试专家。根据提供的 Cypher 查询语句，生成：
1. 最小可复现的测试数据（CREATE 语句）
2. 期望的查询结果
3. 验证断言（用注释说明应匹配的条件）
4. 清理测试数据的 DELETE 语句

输出格式为带注释的 Cypher 代码块。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     知识推理（reasoning）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-implicit-relation-reasoning',
    name:            '隐含关系推理',
    description:     '基于已有三元组推断未显式存在的隐含关系，如传递性、对称性推导',
    category:        'reasoning',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'implicit_relation_reasoning',
    toolDescription: '当用户需要发现图谱中的隐含关联（如 A 影响 B、B 影响 C，则 A 间接影响 C）时调用。返回推断的隐含关系列表及推理链路',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeId:        { type: 'string', description: '起始节点的 _id' },
        relationChain: { type: 'string', description: '推理链路的关系类型序列，如 SUPPLIES,USES 表示 A供应B、B使用C→A间接支撑C' },
        maxDepth:      { type: 'number', description: '推理深度，默认 3' },
      },
      required: ['nodeId'],
    },
    cypherExecution: `MATCH chain = (start { _id: $nodeId })-[*2..3]->(end)
WHERE start <> end
  AND NOT (start)-[]->(end)
WITH start, end, chain,
     [r IN relationships(chain) | type(r)] AS relChain
RETURN labels(end) AS targetLabels, properties(end) AS targetProps,
       relChain AS inferredVia,
       length(chain) AS hops
ORDER BY hops
LIMIT 30`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-entity-disambiguation',
    name:            '实体消歧',
    description:     '用户输入模糊名称时，从图谱中找出最可能匹配的实体，含相似度分数',
    category:        'reasoning',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'entity_disambiguation',
    toolDescription: '当用户提到的实体名称模糊或存在多个候选时调用。从图谱中检索语义最相近的实体并排名，帮助用户明确所指',
    toolInputSchema: {
      type: 'object',
      properties: {
        query:  { type: 'string', description: '用户输入的模糊实体名称或描述' },
        twinId: { type: 'string', description: '限定搜索范围的业务孪生 ID，留空则全图搜索' },
        topK:   { type: 'number', description: '返回候选实体数量，默认 5' },
      },
      required: ['query'],
    },
    cypherExecution: `MATCH (n:EntityInstance)
WHERE any(prop IN keys(n) WHERE
  toLower(toString(n[prop])) CONTAINS toLower($query)
)
RETURN DISTINCT labels(n) AS labels, properties(n) AS props
LIMIT 10`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-knowledge-qa',
    name:            '知识问答',
    description:     '用户提自然语言问题，先转 Cypher 查图谱，再由 LLM 基于结果精确回答（Graph RAG）',
    category:        'reasoning',
    skillType:       'workflow',
    systemPrompt:    `你是基于知识图谱的问答专家（Graph RAG）。工作流程：
1. 理解用户问题的语义意图
2. 将问题转化为 Cypher 查询（已由系统执行并提供结果）
3. 基于查询结果用中文给出精确、完整的回答
4. 如果查询结果为空，说明图谱中暂无相关数据并给出建议

回答要直接针对用户问题，引用图谱中的具体数据，不要泛泛而谈。`,
    cypherRead:      `// 此 workflow 的 cypherRead 由 LLM 在运行时根据用户问题动态生成
// 系统会先调用 nl_to_cypher 获取查询语句，再执行并将结果注入本 workflow`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     本体设计 — 扩展（ontology）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-ontology-from-doc',
    name:            '文档提取本体',
    description:     '从自然语言文档或业务需求描述中自动提取实体概念和关系，生成本体草案',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'ontology_from_doc',
    toolDescription: '当用户粘贴一段业务文档、需求说明或领域描述，希望快速建立本体草案时调用。提取其中的核心概念（实体）和概念间关系，返回结构化的实体和关系建议列表',
    toolInputSchema: {
      type: 'object',
      properties: {
        documentText: { type: 'string', description: '待分析的文档文本内容' },
        domainHint:   { type: 'string', description: '业务领域提示，如"智能制造"、"医院管理"，帮助消歧' },
        existingContext: { type: 'string', description: '已有本体的摘要，避免重复提取' },
      },
      required: ['documentText'],
    },
    cypherExecution: `MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)
RETURN e.name AS name, e.label AS label
ORDER BY e.name
LIMIT 50`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-hierarchy-suggestion',
    name:            '实体层级建议',
    description:     '分析现有实体集合，建议 is-a / subtype 层级关系，辅助构建分类体系',
    category:        'ontology',
    skillType:       'workflow',
    systemPrompt:    `你是本体建模专家，擅长构建分类体系（Taxonomy）。以下是图谱中所有实体的定义，请：
1. 识别可以形成上下位关系（is-a / subClassOf）的实体对
2. 构建建议的层级树（使用缩进表示层级）
3. 对层级划分给出理由，并标注信心等级（高/中/低）
4. 提示哪些实体可能还需要拆分为多个子类型`,
    cypherRead:      `MATCH (e:EntityDef)
RETURN e.id AS id, e.name AS name, e.label AS label,
       e.description AS description, e.entityType AS entityType
ORDER BY e.entityType, e.name`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-label-convention-check',
    name:            '命名规范检查',
    description:     '检查实体和关系的命名是否符合约定（英文名、中文标签、描述完整性），输出问题清单',
    category:        'ontology',
    skillType:       'workflow',
    systemPrompt:    `你是本体规范审查专家。请检查以下实体和关系的命名是否符合以下规范：
- 实体 name 字段：英文 PascalCase 或 camelCase，不含空格和特殊字符
- 实体 label 字段：中文显示名，不为空
- 实体 description：字符数 > 10，描述有实质内容
- 关系 name 字段：英文 UPPER_SNAKE_CASE
- 关系 description：不为空

以表格形式输出不符合规范的条目，给出修改建议。`,
    cypherRead:      `MATCH (e:EntityDef)
RETURN 'entity' AS kind, e.name AS name, e.label AS label, e.description AS description, '' AS extra
UNION ALL
MATCH (r:RelDef)
RETURN 'relation' AS kind, r.name AS name, r.label AS label, r.description AS description, '' AS extra
ORDER BY kind, name`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-ontology-model-compare',
    name:            '模型对比',
    description:     '对比两个本体模型之间的差异，列出新增、删除、变更的实体和关系',
    category:        'ontology',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'ontology_model_compare',
    toolDescription: '当用户需要了解两个本体模型版本之间有哪些变化时调用。返回差异报告：新增/删除的实体和关系，以及属性变更',
    toolInputSchema: {
      type: 'object',
      properties: {
        modelId1: { type: 'string', description: '基准模型 ID' },
        modelId2: { type: 'string', description: '对比目标模型 ID' },
      },
      required: ['modelId1', 'modelId2'],
    },
    cypherExecution: `MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)
WHERE m.id IN [$modelId1, $modelId2]
RETURN m.id AS modelId, m.name AS modelName,
       collect({ id: e.id, name: e.name, label: e.label, props: e.properties }) AS entities`,
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     图谱查询 — 扩展（graph-query）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-fulltext-search',
    name:            '全文搜索',
    description:     '跨所有实例属性进行关键词搜索，快速定位图谱中的节点',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'fulltext_search',
    toolDescription: '当用户输入关键词并需要在整个图谱中查找包含该词的节点时调用。返回匹配节点列表，按相关度排序',
    toolInputSchema: {
      type: 'object',
      properties: {
        keyword:     { type: 'string', description: '搜索关键词' },
        twinId:      { type: 'string', description: '限定业务孪生 ID，留空则全图搜索' },
        entityLabel: { type: 'string', description: '限定实体类型标签，留空则搜索所有类型' },
        limit:       { type: 'number', description: '返回数量上限，默认 20' },
      },
      required: ['keyword'],
    },
    cypherExecution: `MATCH (n:EntityInstance)
WHERE any(prop IN keys(n)
  WHERE prop <> '_id' AND prop <> '_twinId' AND prop <> '_entityDefId'
    AND toLower(toString(n[prop])) CONTAINS toLower($keyword)
)
RETURN DISTINCT labels(n) AS labels, properties(n) AS props
ORDER BY n._id
LIMIT 20`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-similar-node-finder',
    name:            '相似节点查找',
    description:     '以指定节点为参照，在图谱中找出属性值相似的同类节点',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'similar_node_finder',
    toolDescription: '当用户需要找出与某个节点属性特征相似的其他节点时调用，常用于重复数据排查、案例推荐、模式匹配',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeId:       { type: 'string', description: '参照节点的 _id' },
        matchProps:   { type: 'array', items: { type: 'string' }, description: '用于相似度比较的属性名列表，如 ["city","category"]' },
        limit:        { type: 'number', description: '返回候选数量，默认 10' },
      },
      required: ['nodeId', 'matchProps'],
    },
    cypherExecution: `MATCH (ref { _id: $nodeId })
MATCH (n:EntityInstance)
WHERE n._id <> $nodeId
  AND labels(n) = labels(ref)
  AND any(prop IN $matchProps WHERE ref[prop] IS NOT NULL AND n[prop] = ref[prop])
WITH n,
     size([prop IN $matchProps WHERE ref[prop] IS NOT NULL AND n[prop] = ref[prop]]) AS matchScore
ORDER BY matchScore DESC
LIMIT 10
RETURN labels(n) AS labels, properties(n) AS props, matchScore`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-time-window-query',
    name:            '时间窗口查询',
    description:     '查询指定时间范围内创建或更新的实例，支持趋势分析',
    category:        'graph-query',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'time_window_query',
    toolDescription: '当用户需要按时间范围筛选实例数据时调用，如"查看本月新增的设备"、"上周发生的所有事件"',
    toolInputSchema: {
      type: 'object',
      properties: {
        startDate:   { type: 'string', description: '起始日期，ISO 8601 格式，如 2024-01-01' },
        endDate:     { type: 'string', description: '结束日期，ISO 8601 格式' },
        datePropName:{ type: 'string', description: '用于过滤的日期属性名，如 createdAt、eventDate、updatedAt' },
        entityLabel: { type: 'string', description: '目标实体类型标签，留空则查全部' },
        twinId:      { type: 'string', description: '业务孪生 ID，留空则全图查询' },
      },
      required: ['startDate', 'endDate', 'datePropName'],
    },
    cypherExecution: `MATCH (n:EntityInstance)
WHERE n[$datePropName] >= $startDate
  AND n[$datePropName] <= $endDate
RETURN labels(n) AS labels, properties(n) AS props,
       n[$datePropName] AS dateValue
ORDER BY dateValue DESC
LIMIT 200`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-graph-health-check',
    name:            '图谱健康检查',
    description:     '全面检查实例数据质量：缺失必填属性、悬空节点、孤立实例、重复 ID 等',
    category:        'graph-query',
    skillType:       'workflow',
    systemPrompt:    `你是图谱数据质量专家。以下是图谱的健康检查结果，请用中文生成结构化的质量报告，包含：
1. 问题汇总（按严重程度：严重/警告/提示）
2. 各类问题的详细列表和影响范围
3. 建议修复优先级和修复方案
4. 整体数据质量评分（0-100）`,
    cypherRead:      `// 缺失 _entityDefId 的实例
MATCH (n:EntityInstance) WHERE n._entityDefId IS NULL
RETURN '缺失实体定义引用' AS issueType, count(n) AS count, '' AS sample
UNION ALL
// 缺失孪生归属的实例
MATCH (n:EntityInstance) WHERE NOT (n)-[:IN_TWIN]->()
RETURN '未归属孪生' AS issueType, count(n) AS count, '' AS sample
UNION ALL
// 各类型实例数量
MATCH (n:EntityInstance)
RETURN '实例统计-' + head(labels(n)) AS issueType, count(n) AS count, '' AS sample`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-relation-frequency',
    name:            '关系频率分析',
    description:     '统计各类关系的使用频次，识别最活跃和最稀疏的连接模式',
    category:        'graph-query',
    skillType:       'workflow',
    systemPrompt:    `你是图谱分析专家。以下是图谱中各类关系的使用频率统计，请用中文分析：
1. 最活跃的关系类型及其业务含义
2. 使用过少的关系是否存在数据缺失
3. 关系密度的分布是否合理
4. 优化建议（哪些关系需要补充数据，哪些可能是多余的）`,
    cypherRead:      `MATCH ()-[r]->()
RETURN type(r) AS relType, count(r) AS frequency
ORDER BY frequency DESC`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     数据导入 — 扩展（data-import）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-json-structure-parser',
    name:            'JSON 结构解析',
    description:     '分析嵌套 JSON 的层级结构，建议展平策略和 Neo4j 节点映射方案',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据结构分析专家。用户提供了一段 JSON 数据，请分析其结构并给出：
1. 顶层字段列表及推断的数据类型
2. 嵌套对象/数组的处理方案（展平为属性、拆分为子节点、还是序列化为 JSON 字符串）
3. 建议映射到哪个实体类型
4. 导入 Neo4j 的 Cypher 模板（使用 UNWIND + MERGE 结构）

只针对用户提供的具体 JSON 结构给出建议，不要泛泛而谈。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-enum-normalization',
    name:            '枚举值标准化',
    description:     '识别并统一导入数据中的枚举值变体，如 Y/N/Yes/No/1/0 → true/false',
    category:        'data-import',
    skillType:       'workflow',
    systemPrompt:    `你是数据标准化专家。以下是某字段的全部枚举值样本，请：
1. 识别出所有语义等价的变体（大小写差异、中英文混用、缩写全称等）
2. 推荐标准化后的目标值集合
3. 给出明确的转换映射表（原始值 → 标准值）
4. 指出无法确定的歧义值，提示人工核实

只输出映射表和说明，不要冗余分析。`,
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-batch-relation-import',
    name:            '批量关系导入',
    description:     '从边列表数据（source_id, target_id, rel_type）批量创建实例间的关系',
    category:        'data-import',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'batch_relation_import',
    toolDescription: '当用户有一份包含源节点ID、目标节点ID和关系类型的边列表数据，需要批量创建图谱关系时调用',
    toolInputSchema: {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceId:    { type: 'string' },
              targetId:    { type: 'string' },
              relationType:{ type: 'string' },
              properties:  { type: 'object' },
            },
          },
          description: '边列表，每条边包含 sourceId、targetId、relationType 和可选的属性',
        },
        twinId: { type: 'string', description: '所属业务孪生 ID' },
      },
      required: ['edges'],
    },
    cypherExecution: `UNWIND $edges AS edge
MATCH (a:EntityInstance { _id: edge.sourceId })
MATCH (b:EntityInstance { _id: edge.targetId })
CALL apoc.create.relationship(a, edge.relationType, coalesce(edge.properties, {}), b)
YIELD rel
RETURN count(rel) AS createdRelations`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-data-lineage',
    name:            '数据血缘追踪',
    description:     '追踪指定实例节点来源于哪个数据集、哪次导入操作，呈现完整的数据血缘链',
    category:        'data-import',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'data_lineage',
    toolDescription: '当用户需要了解某条记录从哪里来、何时导入、属于哪个数据集时调用。返回该节点的完整数据血缘信息',
    toolInputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '目标实例节点的 _id' },
      },
      required: ['nodeId'],
    },
    cypherExecution: `MATCH (n:EntityInstance { _id: $nodeId })
RETURN n._id AS nodeId,
       n._datasetId AS datasetId,
       n._modelId AS modelId,
       n._sourceLabel AS sourceLabel,
       n._importedAt AS importedAt,
       n._twinId AS twinId,
       n._entityDefId AS entityDefId,
       properties(n) AS allProps`,
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     Cypher 生成 — 扩展（cypher-gen）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-batch-import-gen',
    name:            '批量导入语句生成',
    description:     '根据实体 Schema 生成 UNWIND + MERGE 的高性能批量导入 Cypher 模板',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'batch_import_gen',
    toolDescription: '当用户需要为某个实体类型生成批量数据导入脚本时调用。根据属性定义生成带参数的 UNWIND MERGE Cypher，适合大批量数据写入',
    toolInputSchema: {
      type: 'object',
      properties: {
        entityDefId:  { type: 'string', description: '目标实体定义 ID' },
        uniqueKey:    { type: 'string', description: '去重/合并键属性名，如 id、code' },
        batchSize:    { type: 'number', description: '每批次数据量，默认 1000' },
        twinId:       { type: 'string', description: '目标业务孪生 ID' },
      },
      required: ['entityDefId', 'uniqueKey'],
    },
    cypherExecution: `MATCH (e:EntityDef { id: $entityDefId })
RETURN e.name AS name, e.label AS label, e.properties AS propertiesJson`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-index-management',
    name:            '索引管理',
    description:     '分析查询模式，生成 CREATE INDEX 语句；列出已有索引，建议清理冗余索引',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'index_management',
    toolDescription: '当用户需要优化图谱查询性能、创建或管理 Neo4j 索引时调用。根据常用查询模式生成索引语句，或列出现有索引供审查',
    toolInputSchema: {
      type: 'object',
      properties: {
        action:      { type: 'string', enum: ['suggest', 'list', 'create', 'drop'], description: '操作类型：suggest=基于Schema建议索引，list=列出现有索引，create/drop=生成语句' },
        entityLabel: { type: 'string', description: '目标实体标签，suggest 时使用' },
        propName:    { type: 'string', description: '目标属性名，create/drop 时使用' },
      },
      required: ['action'],
    },
    cypherExecution: `SHOW INDEXES YIELD name, type, labelsOrTypes, properties, state
RETURN name, type, labelsOrTypes, properties, state
ORDER BY labelsOrTypes, properties`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-cypher-formatter',
    name:            'Cypher 格式化',
    description:     '将压缩或格式混乱的 Cypher 语句格式化为统一的标准风格',
    category:        'cypher-gen',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'cypher_formatter',
    toolDescription: '当用户粘贴了格式杂乱、难以阅读的 Cypher 语句需要整理时调用。格式化为标准风格：关键字大写、每子句换行、合理缩进',
    toolInputSchema: {
      type: 'object',
      properties: {
        cypher:  { type: 'string', description: '需要格式化的 Cypher 语句' },
        addComments: { type: 'boolean', description: '是否为每个子句添加中文注释，默认 false' },
      },
      required: ['cypher'],
    },
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     知识推理 — 扩展（reasoning）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-root-cause-analysis',
    name:            '根因分析',
    description:     '给定一个问题节点，逆向追踪关系链找出最可能的根本原因',
    category:        'reasoning',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'root_cause_analysis',
    toolDescription: '当用户发现某个节点出现异常，需要找出根本原因时调用。沿反向关系链追溯，返回候选根因节点列表及推理路径',
    toolInputSchema: {
      type: 'object',
      properties: {
        problemNodeId: { type: 'string', description: '出现问题的节点 _id' },
        maxDepth:      { type: 'number', description: '追溯深度，默认 4' },
        issueDesc:     { type: 'string', description: '问题描述，帮助 LLM 筛选最相关的根因' },
      },
      required: ['problemNodeId'],
    },
    cypherExecution: `MATCH path = (root)-[*1..4]->(problem { _id: $problemNodeId })
WHERE NOT ()-[]->(root)
WITH root, path,
     length(path) AS depth
ORDER BY depth
LIMIT 20
RETURN DISTINCT labels(root) AS rootLabels, properties(root) AS rootProps,
       [n IN nodes(path) | { labels: labels(n), id: n._id }] AS causalChain,
       depth`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-risk-propagation',
    name:            '风险传播分析',
    description:     '模拟风险从源节点沿关系链向下传播的范围和路径，量化影响面',
    category:        'reasoning',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'risk_propagation',
    toolDescription: '当用户需要评估某个风险点（故障/延误/缺货等）的传播范围时调用。计算风险传播路径、影响节点数和传播深度',
    toolInputSchema: {
      type: 'object',
      properties: {
        riskNodeId:    { type: 'string', description: '风险源节点的 _id' },
        riskType:      { type: 'string', description: '风险类型描述，如"供应中断"、"设备故障"' },
        maxDepth:      { type: 'number', description: '传播深度，默认 3' },
        filterRelType: { type: 'string', description: '只沿特定类型关系传播，留空则所有关系' },
      },
      required: ['riskNodeId'],
    },
    cypherExecution: `MATCH path = (risk { _id: $riskNodeId })-[*1..3]->(affected)
WITH affected, path,
     length(path) AS propagationDepth,
     [r IN relationships(path) | type(r)] AS relChain
RETURN DISTINCT labels(affected) AS labels, properties(affected) AS props,
       propagationDepth, relChain
ORDER BY propagationDepth, affected._id
LIMIT 100`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-anomaly-detection',
    name:            '异常节点检测',
    description:     '统计各属性的分布特征，识别属性值偏离正常范围的异常实例',
    category:        'reasoning',
    skillType:       'workflow',
    systemPrompt:    `你是数据异常检测专家。以下是图谱实例数据的属性统计信息，请识别：
1. 数值型属性中的离群点（超过均值±3倍标准差）
2. 字符串属性中格式异常的值
3. 时间属性中不合理的日期（未来日期、远古日期）
4. 与同类节点属性模式明显不同的节点

按严重程度排列，给出每个异常的具体值和异常原因。`,
    cypherRead:      `MATCH (n:EntityInstance)
WITH head(labels(n)) AS entityType, keys(n) AS propKeys
UNWIND propKeys AS prop
WITH entityType, prop
WHERE prop NOT STARTS WITH '_'
MATCH (m:EntityInstance) WHERE head(labels(m)) = entityType
RETURN entityType, prop,
       count(m[prop]) AS nonNullCount,
       min(toString(m[prop])) AS minVal,
       max(toString(m[prop])) AS maxVal
ORDER BY entityType, prop
LIMIT 200`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  /* ════════════════════════════════════════════════════════════════
     监控告警（monitoring）
  ════════════════════════════════════════════════════════════════ */

  {
    id:              'builtin-data-freshness',
    name:            '数据新鲜度检查',
    description:     '检查哪些实体的数据长期未更新，识别"僵尸数据"和数据维护盲区',
    category:        'monitoring',
    skillType:       'workflow',
    systemPrompt:    `你是数据运营专家。以下是各类实例数据的最后更新时间统计，请用中文分析：
1. 哪些实体类型的数据更新频率异常低（可能是数据维护遗漏）
2. 哪些具体节点已超过合理更新周期（如设备状态超过 30 天未更新）
3. 数据新鲜度对业务决策的潜在风险
4. 建议的数据维护计划`,
    cypherRead:      `MATCH (n:EntityInstance)
WHERE n._importedAt IS NOT NULL
WITH head(labels(n)) AS entityType,
     max(n._importedAt) AS latestImport,
     min(n._importedAt) AS earliestImport,
     count(n) AS total
RETURN entityType, latestImport, earliestImport, total
ORDER BY latestImport ASC`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-threshold-alert',
    name:            '阈值告警',
    description:     '检查实例属性值是否超出用户定义的阈值范围，返回告警列表',
    category:        'monitoring',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'threshold_alert',
    toolDescription: '当用户需要监控某类实例的属性值是否超出正常范围时调用，如"温度超过 80℃"、"库存低于 100"',
    toolInputSchema: {
      type: 'object',
      properties: {
        entityLabel:  { type: 'string', description: '监控的实体类型标签' },
        propName:     { type: 'string', description: '监控的属性名' },
        operator:     { type: 'string', enum: ['>', '<', '>=', '<=', '=', '<>'], description: '比较运算符' },
        threshold:    { type: 'number', description: '阈值' },
        twinId:       { type: 'string', description: '限定业务孪生 ID，留空则全图监控' },
      },
      required: ['entityLabel', 'propName', 'operator', 'threshold'],
    },
    cypherExecution: `MATCH (n:EntityInstance)
WHERE head(labels(n)) = $entityLabel
  AND n[$propName] IS NOT NULL
  AND n[$propName] $operator $threshold
RETURN labels(n) AS labels, properties(n) AS props,
       n[$propName] AS alertValue
ORDER BY n[$propName] DESC
LIMIT 100`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-change-log',
    name:            '变更日志查询',
    description:     '查询图谱在指定时间段内发生的新增、删除变化，生成变更摘要报告',
    category:        'monitoring',
    skillType:       'tool',
    systemPrompt:    '',
    cypherRead:      '',
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        'change_log',
    toolDescription: '当用户需要了解"最近一段时间图谱发生了什么变化"时调用。查询指定时间窗口内新增的实例，统计各类型变化数量',
    toolInputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: '查询起始时间，ISO 8601 格式' },
        endDate:   { type: 'string', description: '查询结束时间，ISO 8601 格式，留空则为当前时间' },
        twinId:    { type: 'string', description: '限定业务孪生 ID，留空则全图' },
      },
      required: ['startDate'],
    },
    cypherExecution: `MATCH (n:EntityInstance)
WHERE n._importedAt >= $startDate
  AND ($endDate IS NULL OR n._importedAt <= $endDate)
WITH head(labels(n)) AS entityType, count(n) AS addedCount,
     min(n._importedAt) AS firstAdded, max(n._importedAt) AS lastAdded
RETURN entityType, addedCount, firstAdded, lastAdded
ORDER BY addedCount DESC`,
    enabled: true,
    version: '1.0.0',
  },

  {
    id:              'builtin-periodic-report',
    name:            '定期报告生成',
    description:     '自动生成图谱的周期性状态报告，含规模变化、数据质量、活跃度等维度',
    category:        'monitoring',
    skillType:       'workflow',
    systemPrompt:    `你是图谱运营报告专家。以下是图谱当前的统计数据，请生成一份专业的周期性运营报告，包含：
1. 执行摘要（3 句话说明图谱整体状态）
2. 规模指标（节点总数、关系总数、各类型分布）
3. 数据质量评估（完整性、新鲜度、一致性）
4. 近期变化亮点
5. 待关注风险点
6. 下一步行动建议

输出格式为结构化 Markdown 报告。`,
    cypherRead:      `MATCH (n:EntityInstance)
WITH count(n) AS totalNodes, collect(DISTINCT head(labels(n))) AS entityTypes
MATCH ()-[r]->()
WITH totalNodes, entityTypes, count(r) AS totalRels
MATCH (t:BizTwin)
RETURN totalNodes, entityTypes, totalRels, count(t) AS twinCount`,
    cypherWrite:     '',
    outputSchema:    '',
    toolName:        '',
    toolDescription: '',
    toolInputSchema: {},
    cypherExecution: '',
    enabled: true,
    version: '1.0.0',
  },
]
