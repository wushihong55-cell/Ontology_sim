import { MarkerType } from '@xyflow/react'
import type { EntityNode, RelationEdge, EntityProperty, EntityData, RelationData, EntityType, RelationCategoryId, PropertyType, Cardinality } from '../types'
import { makeId } from '../store'

// ── Intermediate types ───────────────────────────────────────────────────────

export interface ParsedProperty {
  ownerLabel: string
  nameZh: string
  name: string
  type: PropertyType
  required: boolean
  description: string
}

export interface ParsedEntity {
  label: string
  name: string
  entityType: EntityType
  color: string
  description: string
  properties: EntityProperty[]
}

export interface ParsedRelation {
  label: string
  name: string
  category: RelationCategoryId | undefined
  sourceLabel: string
  targetLabel: string
  description: string
  cardinality: Cardinality
}

export interface ImportResult {
  entities: ParsedEntity[]
  relations: ParsedRelation[]
  errors: string[]
  meta?: {
    domain?: string
    description?: string
    schemaVersion?: string
    source?: 'external-schema'
  }
}

// ── Mapping tables ───────────────────────────────────────────────────────────

// Excel 实体分类（8 种新版 + 6 种旧版兼容） → EntityType
const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  // 新版 8 种（与系统定义对齐）
  '有形实体':     'physical',
  '无形/概念实体': 'abstract',
  '业务事件':     'event',
  '流程/活动':    'activity',
  '主体':        'agent',
  '角色':        'role',
  '时间/周期':    'temporal',
  '空间/位置':    'spatial',
  // 旧版 6 种（兼容降级）
  '核心业务实体': 'abstract',
  '组织实体':    'agent',
  '事件实体':    'event',
  '资源实体':    'physical',
  '时间空间实体': 'temporal',
  '抽象概念实体': 'abstract',
}

// 每种 EntityType 对应的默认颜色
const DEFAULT_COLORS: Record<EntityType, string> = {
  physical:  '#2f7d6d',
  abstract:  '#5b6ee1',
  event:     '#c06a3d',
  activity:  '#d4984a',
  agent:     '#7a5aa6',
  role:      '#4a8fa6',
  temporal:  '#4a7ca6',
  spatial:   '#6aa64a',
}

// Excel 属性数据类型 → PropertyType
const PROP_TYPE_MAP: Record<string, PropertyType> = {
  '文本': 'string', 'string': 'string', 'text': 'string',
  '数字': 'number', 'number': 'number', 'integer': 'number', 'float': 'number',
  '日期': 'date',   'date': 'date',    'datetime': 'date',
  '布尔': 'boolean', 'boolean': 'boolean',
  '枚举': 'enum',   'enum': 'enum',
  '图片': 'string', '表格': 'string', '文件': 'string', '富文本': 'string',
  'reference': 'reference',
}

// Excel 关系分类 → RelationCategoryId
const REL_CATEGORY_MAP: Record<string, RelationCategoryId> = {
  '继承关系':    'structural',
  '组成关系':    'structural',
  '拥有关系':    'associative',
  '关联关系':    'associative',
  '依赖关系':    'temporal-causal',
  '流转关系':    'participatory',
  '计算关系':    'mapping',
  '引用关系':    'mapping',
  // English aliases (from schema.json export)
  'structural':     'structural',
  'associative':    'associative',
  'participatory':  'participatory',
  'temporal-causal':'temporal-causal',
  'mapping':        'mapping',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

function mapEntityType(raw: string): EntityType {
  return ENTITY_TYPE_MAP[raw] ?? 'abstract'
}

function mapPropType(raw: string): PropertyType {
  return PROP_TYPE_MAP[raw.toLowerCase()] ?? 'string'
}

function mapRelCategory(raw: string): RelationCategoryId | undefined {
  return REL_CATEGORY_MAP[raw] ?? undefined
}

// ── Excel parser ─────────────────────────────────────────────────────────────

export async function parseExcelSchema(file: File): Promise<ImportResult> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'buffer' })

  const entitySheet   = wb.Sheets['实体']
  const propSheet     = wb.Sheets['属性']
  const relationSheet = wb.Sheets['关系']

  const errors: string[] = []

  if (!entitySheet) {
    return { entities: [], relations: [], errors: ['Excel 中未找到「实体」Sheet，请使用标准模板'] }
  }

  // ── Parse 实体 ───────────────────────────────────────────────────────────
  const entityRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(entitySheet, { defval: '' })
  const entities: ParsedEntity[] = []

  for (const row of entityRows) {
    const label = str(row['实体名称*'] ?? row['实体名称'])
    if (!label) continue

    const rawType  = str(row['分类'])
    const rawColor = str(row['颜色'])
    const entityType = mapEntityType(rawType)
    const color = rawColor.startsWith('#') ? rawColor : DEFAULT_COLORS[entityType]

    entities.push({
      label,
      name:        str(row['英文别名']) || label,
      entityType,
      color,
      description: str(row['描述']),
      properties:  [],
    })
  }

  // ── Parse 属性 ───────────────────────────────────────────────────────────
  if (propSheet) {
    const propRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(propSheet, { defval: '' })
    for (const row of propRows) {
      const ownerLabel = str(row['所属实体*'] ?? row['所属实体'])
      const nameZh     = str(row['属性名称*'] ?? row['属性名称'])
      if (!ownerLabel || !nameZh) continue

      const entity = entities.find((e) => e.label === ownerLabel)
      if (!entity) {
        errors.push(`属性「${nameZh}」的所属实体「${ownerLabel}」未在实体 Sheet 中定义`)
        continue
      }

      const rawType  = str(row['数据类型*'] ?? row['数据类型'])
      const required = str(row['是否必填']).toLowerCase() === '是'

      entity.properties.push({
        id:          makeId('prop'),
        name:        str(row['英文别名']) || nameZh,
        nameZh,
        type:        mapPropType(rawType || 'string'),
        required,
        description: str(row['描述']),
      })
    }
  }

  // 确保每个实体至少有 id 属性
  for (const e of entities) {
    if (!e.properties.some((p) => p.name === 'id' || p.nameZh === 'ID')) {
      e.properties.unshift({
        id: makeId('prop'), name: 'id', nameZh: 'ID',
        type: 'string', required: true, description: '唯一标识',
      })
    }
  }

  // ── Parse 关系 ───────────────────────────────────────────────────────────
  const relations: ParsedRelation[] = []

  if (relationSheet) {
    const relRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(relationSheet, { defval: '' })
    for (const row of relRows) {
      const label  = str(row['关系名称*'] ?? row['关系名称'])
      const source = str(row['源实体*'] ?? row['源实体'])
      const target = str(row['目标实体*'] ?? row['目标实体'])
      if (!label || !source || !target) continue

      if (!entities.find((e) => e.label === source)) {
        errors.push(`关系「${label}」的源实体「${source}」未在实体 Sheet 中定义`)
      }
      if (!entities.find((e) => e.label === target)) {
        errors.push(`关系「${label}」的目标实体「${target}」未在实体 Sheet 中定义`)
      }

      relations.push({
        label,
        name:        str(row['英文别名']) || label,
        category:    mapRelCategory(str(row['分类'])),
        sourceLabel: source,
        targetLabel: target,
        description: str(row['描述']),
        cardinality: (str(row['基数']) as Cardinality) || '1:N',
      })
    }
  }

  return { entities, relations, errors }
}

// ── External Schema JSON parser (schema_version + nodes + relationships) ─────
// This is the canonical format for domain-level schema definitions.
// Detection: root has `nodes[]` + `relationships[]` (vs internal `entities[]` + `relations[]`).

function inferEntityType(labelCn: string, desc: string): EntityType {
  const t = labelCn + ' ' + desc
  if (/员工|人员|旅客|乘车人|住宿人|报销人|收款人|部门|公司|主体|组织/.test(t)) return 'agent'
  if (/申请|审批单/.test(t)) return 'activity'
  if (/报销单|单据|明细|记录|日志/.test(t)) return 'event'
  if (/行程|交通|住宿|支付|分摊|发票|凭证/.test(t)) return 'event'
  if (/日期|时间|周期|季度/.test(t)) return 'temporal'
  if (/地址|位置|城市|地点|区域/.test(t)) return 'spatial'
  return 'abstract'
}

function normalizeCardinality(raw: string): Cardinality {
  const MAP: Record<string, Cardinality> = {
    '1:1': '1:1', '1:N': '1:N', 'N:M': 'N:M', '0..1': '0..1',
    'N:1': '1:N',   // flip — direction already encoded by from/to
    'N:N': 'N:M',
  }
  return MAP[raw.trim()] ?? '1:N'
}

function parseExternalJsonSchema(raw: Record<string, unknown>): ImportResult {
  const errors: string[] = []

  const domain        = str(raw.domain        ?? '')
  const schemaDesc    = str(raw.description   ?? '')
  const schemaVersion = str(raw.schema_version ?? '')

  type ExtProp = {
    name?: string; type?: string; required?: boolean
    source_field?: string; note?: string; description?: string
    constraint?: string; indexed?: boolean; unique?: boolean
  }
  type ExtNode = {
    label?: string; label_cn?: string; description?: string
    properties?: ExtProp[]
    specialized_properties?: Record<string, string[]>
  }
  type ExtRel = {
    type?: string; type_cn?: string
    from?: string; to?: string
    cardinality?: string; description?: string
  }
  // Root-level constraints — two formats:
  //   JSON object: { "label": "City", "property": "name", "type": "UNIQUE" }
  //   DDL string:  "CREATE CONSTRAINT ... FOR (n:City) REQUIRE n.name IS UNIQUE"
  type ExtConstraintObj = { label?: string; property?: string; type?: string }

  const rawNodes       = (Array.isArray(raw.nodes)         ? raw.nodes         : []) as ExtNode[]
  const rawRels        = (Array.isArray(raw.relationships)  ? raw.relationships  : []) as ExtRel[]
  const rawConstraints = (Array.isArray(raw.constraints)    ? raw.constraints    : []) as (string | ExtConstraintObj)[]
  const rawIndexes     = (Array.isArray(raw.indexes)        ? raw.indexes        : []) as string[]

  // Pre-build sets for constraint/index lookups: "EnglishLabel.propName"
  const uniqueKeys  = new Set<string>()
  const indexedKeys = new Set<string>()

  for (const c of rawConstraints) {
    if (typeof c === 'string') {
      // DDL: "... FOR (n:Label) REQUIRE n.prop IS UNIQUE"
      const m = c.match(/FOR\s+\(n:(\w+)\)\s+REQUIRE\s+n\.(\w+)\s+IS\s+UNIQUE/i)
      if (m) uniqueKeys.add(`${m[1]}.${m[2]}`)
    } else if (c && typeof c === 'object') {
      // JSON object
      if (str(c.type).toUpperCase() === 'UNIQUE' && c.label && c.property) {
        uniqueKeys.add(`${c.label}.${c.property}`)
      }
    }
  }
  for (const idx of rawIndexes) {
    if (typeof idx === 'string') {
      // DDL: "CREATE INDEX ... FOR (n:Label) ON (n.prop)"
      const m = idx.match(/FOR\s+\(n:(\w+)\)\s+ON\s+\(n\.(\w+)\)/i)
      if (m) indexedKeys.add(`${m[1]}.${m[2]}`)
    }
  }

  // English label → display label mapping, for resolving relationship endpoints
  const enToDisplay = new Map<string, string>()

  const entities: ParsedEntity[] = rawNodes.map((node) => {
    const labelEn  = str(node.label    ?? '')
    const labelCn  = str(node.label_cn ?? '')
    const display  = labelCn || labelEn
    const desc     = str(node.description ?? '')

    enToDisplay.set(labelEn, display)

    const properties: EntityProperty[] = (node.properties ?? []).map((p): EntityProperty => {
      const srcField = str(p.source_field ?? '')
      const note     = str(p.note ?? p.description ?? '')
      const descParts: string[] = []
      if (srcField) descParts.push(`来源字段: ${srcField}`)
      if (note)     descParts.push(note)

      // unique: property-level annotation OR root constraints[] match
      const isUnique  = p.constraint === 'unique' || Boolean(p.unique)
        || uniqueKeys.has(`${labelEn}.${str(p.name ?? '')}`)
      // indexed: property-level annotation OR root indexes[] match (skip if already unique)
      const isIndexed = Boolean(p.indexed)
        || indexedKeys.has(`${labelEn}.${str(p.name ?? '')}`)

      return {
        id:          makeId('prop'),
        name:        str(p.name ?? ''),
        nameZh:      str(p.name ?? ''),
        type:        mapPropType(str(p.type ?? 'string')),
        required:    Boolean(p.required),
        description: descParts.join(' · '),
        unique:      isUnique  || undefined,
        indexed:     (!isUnique && isIndexed) || undefined,
      }
    })

    // Flatten specialized_properties — each entry is a mode → string[] of extra field names
    if (node.specialized_properties) {
      const seen = new Set(properties.map((p) => p.nameZh))
      for (const [mode, names] of Object.entries(node.specialized_properties)) {
        if (!Array.isArray(names)) continue
        for (const pName of names) {
          if (seen.has(pName)) continue
          seen.add(pName)
          properties.push({
            id:          makeId('prop'),
            name:        pName,
            nameZh:      pName,
            type:        'string',
            required:    false,
            description: `专属属性 (${mode})`,
          })
        }
      }
    }

    const entityType = inferEntityType(display, desc)
    return { label: display, name: labelEn, entityType, color: DEFAULT_COLORS[entityType], description: desc, properties }
  })

  const relations: ParsedRelation[] = rawRels.map((rel): ParsedRelation => {
    const typeEn = str(rel.type    ?? '')
    const typeCn = str(rel.type_cn ?? '')
    const fromEn = str(rel.from    ?? '')
    const toEn   = str(rel.to      ?? '')

    const fromDisplay = enToDisplay.get(fromEn)
    const toDisplay   = enToDisplay.get(toEn)

    if (!fromDisplay) errors.push(`关系「${typeEn}」的源节点「${fromEn}」未在 nodes 中定义`)
    if (!toDisplay)   errors.push(`关系「${typeEn}」的目标节点「${toEn}」未在 nodes 中定义`)

    return {
      label:       typeCn || typeEn,
      name:        typeEn,
      category:    undefined,
      sourceLabel: fromDisplay ?? fromEn,
      targetLabel: toDisplay   ?? toEn,
      description: str(rel.description ?? ''),
      cardinality: normalizeCardinality(str(rel.cardinality ?? '1:N')),
    }
  })

  return {
    entities, relations, errors,
    meta: {
      domain:        domain        || undefined,
      description:   schemaDesc    || undefined,
      schemaVersion: schemaVersion || undefined,
      source:        'external-schema',
    },
  }
}

// ── JSON parser (buildSchemaContext format or external schema format) ─────────

export function parseJsonSchema(text: string): ImportResult {
  const errors: string[] = []
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return { entities: [], relations: [], errors: ['JSON 解析失败，请检查文件格式'] }
  }

  const raw = parsed as Record<string, unknown>

  // Some schemas wrap everything under a single key (e.g. { "graph_schema": { nodes, relationships, ... } }).
  // Unwrap to the first object-valued key that contains nodes/relationships/entities.
  const effective: Record<string, unknown> = (() => {
    if (Array.isArray(raw.nodes) || Array.isArray(raw.entities)) return raw
    for (const v of Object.values(raw)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const sub = v as Record<string, unknown>
        if (Array.isArray(sub.nodes) || Array.isArray(sub.entities)) return sub
      }
    }
    return raw
  })()

  // External schema format: nodes[] + relationships[]
  if (Array.isArray(effective.nodes) && Array.isArray(effective.relationships)) {
    return parseExternalJsonSchema(effective)
  }

  const internalRaw = effective as { entities?: unknown[]; relations?: unknown[] }

  if (!internalRaw.entities || !Array.isArray(internalRaw.entities)) {
    return { entities: [], relations: [], errors: ['JSON 格式无法识别：需要包含 nodes+relationships（外部格式）或 entities（内部格式）字段'] }
  }

  const entities: ParsedEntity[] = internalRaw.entities!.map((e: any) => ({
    label:       str(e.label ?? e.name),
    name:        str(e.name ?? e.label),
    entityType:  (e.entityType as EntityType) ?? 'abstract',
    color:       str(e.color) || DEFAULT_COLORS[(e.entityType as EntityType) ?? 'abstract'],
    description: str(e.description),
    properties:  (Array.isArray(e.properties) ? e.properties : []).map((p: any): EntityProperty => ({
      id:          makeId('prop'),
      name:        str(p.name),
      nameZh:      str(p.nameZh ?? p.name),
      type:        mapPropType(str(p.type ?? 'string')),
      required:    Boolean(p.required),
      description: str(p.description),
      unique:      (p.constraint === 'unique' || Boolean(p.unique)) || undefined,
      indexed:     (!p.constraint && !p.unique && Boolean(p.indexed)) || undefined,
    })),
  }))

  const relations: ParsedRelation[] = (Array.isArray(internalRaw.relations) ? internalRaw.relations : []).map((r: any): ParsedRelation => ({
    label:       str(r.label ?? r.name),
    name:        str(r.name ?? r.label),
    category:    mapRelCategory(str(r.relationCategory)),
    sourceLabel: str(r.source),
    targetLabel: str(r.target),
    description: str(r.description),
    cardinality: (str(r.cardinality) as Cardinality) || '1:N',
  }))

  // Validate cross-references
  const labelSet = new Set(entities.map((e) => e.label))
  for (const rel of relations) {
    if (!labelSet.has(rel.sourceLabel)) errors.push(`关系「${rel.label}」的源实体「${rel.sourceLabel}」未找到`)
    if (!labelSet.has(rel.targetLabel)) errors.push(`关系「${rel.label}」的目标实体「${rel.targetLabel}」未找到`)
  }

  return { entities, relations, errors }
}

// ── Build ReactFlow nodes + edges from parsed data ────────────────────────────

const COLS      = 3
const COL_GAP   = 380
const ROW_GAP   = 260
const START_X   = 80
const START_Y   = 80

export function buildNodesEdges(result: ImportResult): { nodes: EntityNode[]; edges: RelationEdge[] } {
  const labelToId = new Map<string, string>()

  const nodes: EntityNode[] = result.entities.map((e, i): EntityNode => {
    const id  = makeId('entity')
    labelToId.set(e.label, id)

    const col = i % COLS
    const row = Math.floor(i / COLS)

    return {
      id,
      type: 'entity',
      position: { x: START_X + col * COL_GAP, y: START_Y + row * ROW_GAP },
      data: {
        name:        e.name,
        label:       e.label,
        description: e.description,
        color:       e.color,
        entityType:  e.entityType,
        properties:  e.properties,
      } satisfies EntityData,
    }
  })

  const edges: RelationEdge[] = result.relations
    .filter((r) => labelToId.has(r.sourceLabel) && labelToId.has(r.targetLabel))
    .map((r): RelationEdge => ({
      id:        makeId('rel'),
      type:      'relation',
      source:    labelToId.get(r.sourceLabel)!,
      target:    labelToId.get(r.targetLabel)!,
      markerEnd: { type: MarkerType.ArrowClosed },
      data: {
        name:             r.name,
        label:            r.label,
        cardinality:      r.cardinality,
        description:      r.description,
        relationCategory: r.category,
      } satisfies RelationData,
    }))

  return { nodes, edges }
}

// ── Merge: add imported nodes/edges on top of existing ones ──────────────────
// Conflicting labels are auto-renamed (城市 → 城市_2) so nothing is overwritten.
// Relations that reference existing entities are wired correctly.

export function mergeNodesEdges(
  result: ImportResult,
  existingNodes: EntityNode[],
): {
  nodes: EntityNode[]
  edges: RelationEdge[]
  renamedLabels: Map<string, string>   // original label → renamed label
} {
  // All labels currently on canvas (mutable — updated as we assign new labels)
  const occupiedLabels = new Set(existingNodes.map((n) => n.data.label))

  function uniqueLabel(label: string): string {
    if (!occupiedLabels.has(label)) return label
    let suffix = 2
    while (occupiedLabels.has(`${label}_${suffix}`)) suffix++
    return `${label}_${suffix}`
  }

  // Place new nodes below existing ones to avoid visual overlap
  const maxY    = existingNodes.reduce((m, n) => Math.max(m, n.position.y), -ROW_GAP)
  const startY  = maxY + ROW_GAP * 2

  const renamedLabels = new Map<string, string>()
  const newLabelToId  = new Map<string, string>()   // renamed label → new node id

  const nodes: EntityNode[] = result.entities.map((e, i): EntityNode => {
    const id       = makeId('entity')
    const newLabel = uniqueLabel(e.label)

    if (newLabel !== e.label) renamedLabels.set(e.label, newLabel)
    occupiedLabels.add(newLabel)   // prevent intra-batch duplicates
    newLabelToId.set(newLabel, id)

    const col = i % COLS
    const row = Math.floor(i / COLS)

    return {
      id,
      type: 'entity',
      position: { x: START_X + col * COL_GAP, y: startY + row * ROW_GAP },
      data: {
        name:        e.name,
        label:       newLabel,
        description: e.description,
        color:       e.color,
        entityType:  e.entityType,
        properties:  e.properties,
      } satisfies EntityData,
    }
  })

  // Existing label → existing node id (for cross-references to old entities)
  const existingLabelToId = new Map(existingNodes.map((n) => [n.data.label, n.id]))

  const edges: RelationEdge[] = result.relations
    .map((r): RelationEdge | null => {
      const srcLabel = renamedLabels.get(r.sourceLabel) ?? r.sourceLabel
      const tgtLabel = renamedLabels.get(r.targetLabel) ?? r.targetLabel

      const srcId = newLabelToId.get(srcLabel) ?? existingLabelToId.get(srcLabel)
      const tgtId = newLabelToId.get(tgtLabel) ?? existingLabelToId.get(tgtLabel)

      if (!srcId || !tgtId) return null

      return {
        id:        makeId('rel'),
        type:      'relation',
        source:    srcId,
        target:    tgtId,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          name:             r.name,
          label:            r.label,
          cardinality:      r.cardinality,
          description:      r.description,
          relationCategory: r.category,
        } satisfies RelationData,
      }
    })
    .filter((e): e is RelationEdge => e !== null)

  return { nodes, edges, renamedLabels }
}

// ── Reverse mapping tables (for schema export) ───────────────────────────────

const ENTITY_TYPE_ZH: Record<EntityType, string> = {
  physical:  '有形实体',
  abstract:  '无形/概念实体',
  event:     '业务事件',
  activity:  '流程/活动',
  agent:     '主体',
  role:      '角色',
  temporal:  '时间/周期',
  spatial:   '空间/位置',
}

const PROP_TYPE_ZH: Record<PropertyType, string> = {
  string:    '文本',
  number:    '数字',
  date:      '日期',
  boolean:   '布尔',
  enum:      '枚举',
  reference: '文本',
}

const REL_CAT_ZH: Record<string, string> = {
  structural:        '组成关系',
  associative:       '关联关系',
  participatory:     '流转关系',
  'temporal-causal': '依赖关系',
  mapping:           '计算关系',
}

// ── Export current schema as filled Excel (same format as template) ───────────

export async function exportSchemaAsXlsx(nodes: EntityNode[], edges: RelationEdge[]): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // 说明 Sheet
  const helpData = [
    ['GraphFino 本体模型 · Excel 导入说明'],
    [''],
    ['📋  工作表说明'],
    ['  实体：定义图谱中的节点类型（Node Label）'],
    ['  属性：定义各实体的字段，每行一个属性'],
    ['  关系：定义实体之间的边类型（Relationship Type）'],
    [''],
    ['📌  实体分类（8种，与系统对齐）'],
    ['  有形实体、无形/概念实体、业务事件、流程/活动、主体、角色、时间/周期、空间/位置'],
    [''],
    ['📌  关系分类（8种）'],
    ['  继承关系、组成关系、拥有关系、关联关系、依赖关系、流转关系、计算关系、引用关系'],
    [''],
    ['📌  字段规范'],
    ['  实体名称：中文名称，同一模型中必须唯一，标 * 为必填'],
    ['  英文别名：用于系统内部标识，留空将自动使用实体名称'],
    ['  颜色：十六进制颜色代码，如 #1677FF（留空将按分类自动填充）'],
    ['  数据类型：文本 / 数字 / 日期 / 布尔 / 枚举'],
    [''],
    ['⚠️  注意事项'],
    ['  1. 属性表「所属实体」必须与实体表「实体名称」完全一致'],
    ['  2. 关系表「源实体」「目标实体」必须在实体表中已定义'],
    ['  3. 导入操作将覆盖当前本体，建议先导出备份'],
    ['  4. 请勿删除或修改表头行（第1行）'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(helpData), '说明')

  // 实体 Sheet
  const entityNodes = nodes.filter((n): n is EntityNode => n.type === 'entity')
  const entityRows: unknown[][] = [['实体名称*', '英文别名', '分类', '颜色', '描述']]
  for (const node of entityNodes) {
    const d = node.data
    entityRows.push([
      d.label || d.name,
      d.name,
      ENTITY_TYPE_ZH[d.entityType ?? 'abstract'] ?? '',
      d.color ?? '',
      d.description ?? '',
    ])
  }
  const wsEntity = XLSX.utils.aoa_to_sheet(entityRows)
  wsEntity['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsEntity, '实体')

  // 属性 Sheet
  const propRows: unknown[][] = [['所属实体*', '属性名称*', '英文别名', '数据类型*', '是否必填', '是否唯一', '描述']]
  for (const node of entityNodes) {
    const ownerLabel = node.data.label || node.data.name
    for (const prop of node.data.properties) {
      propRows.push([
        ownerLabel,
        prop.nameZh || prop.name,
        prop.name,
        PROP_TYPE_ZH[prop.type] ?? '文本',
        prop.required ? '是' : '否',
        '',
        prop.description ?? '',
      ])
    }
  }
  const wsProp = XLSX.utils.aoa_to_sheet(propRows)
  wsProp['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsProp, '属性')

  // 关系 Sheet
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const relRows: unknown[][] = [['关系名称*', '英文别名', '分类', '源实体*', '目标实体*', '基数', '描述']]
  for (const edge of edges) {
    const d = edge.data as RelationData | undefined
    if (!d) continue
    const srcNode = nodeMap.get(edge.source) as EntityNode | undefined
    const tgtNode = nodeMap.get(edge.target) as EntityNode | undefined
    if (!srcNode || !tgtNode) continue
    relRows.push([
      d.label || d.name || '',
      d.name || '',
      REL_CAT_ZH[d.relationCategory ?? ''] ?? '',
      srcNode.data.label || srcNode.data.name,
      tgtNode.data.label || tgtNode.data.name,
      d.cardinality ?? '1:N',
      d.description ?? '',
    ])
  }
  const wsRel = XLSX.utils.aoa_to_sheet(relRows)
  wsRel['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsRel, '关系')

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ontology_${date}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// Old entity type names (6-type system) → new entity type names (8-type system)
const OLD_ENTITY_TYPE_TO_NEW: Record<string, string> = {
  '核心业务实体': '无形/概念实体',
  '组织实体':    '主体',
  '事件实体':    '业务事件',
  '资源实体':    '有形实体',
  '时间空间实体': '时间/周期',
  '抽象概念实体': '无形/概念实体',
}

// ── Generate downloadable template xlsx (based on ontology_v1.0 with updated categories) ──

export async function generateTemplateXlsx(): Promise<void> {
  const XLSX = await import('xlsx')

  // Load the ontology_v1.0 base template
  const resp = await fetch('/ontology_v1.0.xlsx')
  const buf  = await resp.arrayBuffer()
  const src  = XLSX.read(buf, { type: 'buffer' })

  const wb = XLSX.utils.book_new()

  // 说明 Sheet — updated to reflect new 8-type entity classification
  const helpData = [
    ['GraphFino 本体模型 · Excel 导入说明'],
    [''],
    ['📋  工作表说明'],
    ['  实体：定义图谱中的节点类型（Node Label）'],
    ['  属性：定义各实体的字段，每行一个属性'],
    ['  关系：定义实体之间的边类型（Relationship Type）'],
    [''],
    ['📌  实体分类（8种，与系统对齐）'],
    ['  有形实体、无形/概念实体、业务事件、流程/活动、主体、角色、时间/周期、空间/位置'],
    ['  留空时系统将默认为「无形/概念实体」'],
    [''],
    ['📌  关系分类'],
    ['  继承关系、组成关系（→ 结构关系）'],
    ['  拥有关系、关联关系（→ 关联关系）'],
    ['  流转关系（→ 参与关系）'],
    ['  依赖关系（→ 时序/因果关系）'],
    ['  计算关系、引用关系（→ 映射关系）'],
    ['  留空时系统将根据语义自动分类'],
    [''],
    ['📌  字段规范'],
    ['  实体名称：中文名称，同一模型中必须唯一，标 * 为必填'],
    ['  英文别名：用于系统内部标识，留空将自动使用实体名称'],
    ['  颜色：十六进制颜色代码，如 #1677FF（留空将按分类自动填充）'],
    ['  数据类型：文本 / 数字 / 日期 / 布尔 / 枚举'],
    [''],
    ['⚠️  注意事项'],
    ['  1. 属性表「所属实体」必须与实体表「实体名称」完全一致'],
    ['  2. 关系表「源实体」「目标实体」必须在实体表中已定义'],
    ['  3. 导入操作将覆盖当前本体，建议先导出备份'],
    ['  4. 请勿删除或修改表头行（第1行）'],
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(helpData), '说明')

  // 实体 Sheet — from ontology_v1.0, entity types updated to new 8-type system
  const srcEntityRows = XLSX.utils.sheet_to_json<Record<string, string>>(src.Sheets['实体'] ?? {}, { defval: '' })
  const entityData: string[][] = [['实体名称*', '英文别名', '分类', '颜色', '描述']]
  for (const row of srcEntityRows) {
    const oldType = row['分类'] ?? ''
    entityData.push([
      row['实体名称*'] ?? '',
      row['英文别名'] ?? '',
      OLD_ENTITY_TYPE_TO_NEW[oldType] ?? oldType,
      row['颜色'] ?? '',
      row['描述'] ?? '',
    ])
  }
  const wsEntity = XLSX.utils.aoa_to_sheet(entityData)
  wsEntity['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsEntity, '实体')

  // 属性 Sheet — from ontology_v1.0 (adds 英文别名 column which was absent in v1.0)
  const srcPropRows = XLSX.utils.sheet_to_json<Record<string, string>>(src.Sheets['属性'] ?? {}, { defval: '' })
  const propData: string[][] = [['所属实体*', '属性名称*', '英文别名', '数据类型*', '是否必填', '是否唯一', '描述']]
  for (const row of srcPropRows) {
    propData.push([
      row['所属实体*'] ?? '',
      row['属性名称*'] ?? '',
      row['英文别名'] ?? '',
      row['数据类型*'] ?? '文本',
      row['是否必填'] ?? '',
      row['是否唯一'] ?? '',
      row['描述'] ?? '',
    ])
  }
  const wsProp = XLSX.utils.aoa_to_sheet(propData)
  wsProp['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsProp, '属性')

  // 关系 Sheet — from ontology_v1.0 (分类 was empty in v1.0; users can fill in)
  const srcRelRows = XLSX.utils.sheet_to_json<Record<string, string>>(src.Sheets['关系'] ?? {}, { defval: '' })
  const relData: string[][] = [['关系名称*', '英文别名', '分类', '源实体*', '目标实体*', '基数', '描述']]
  for (const row of srcRelRows) {
    relData.push([
      row['关系名称*'] ?? '',
      row['英文别名'] ?? '',
      row['分类'] ?? '',
      row['源实体*'] ?? '',
      row['目标实体*'] ?? '',
      row['基数'] ?? '',
      row['描述'] ?? '',
    ])
  }
  const wsRel = XLSX.utils.aoa_to_sheet(relData)
  wsRel['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 6 }, { wch: 32 }]
  XLSX.utils.book_append_sheet(wb, wsRel, '关系')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ontology_template.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
