import type { Node, Edge } from '@xyflow/react'

export type Cardinality = '1:1' | '1:N' | 'N:M' | '0..1'

export type EntityType =
  | 'physical' | 'abstract'
  | 'event' | 'activity'
  | 'agent' | 'role'
  | 'temporal' | 'spatial'

export type RelationCategoryId =
  | 'structural' | 'associative' | 'participatory' | 'temporal-causal' | 'mapping'
export type PropertyType = 'string' | 'number' | 'date' | 'boolean' | 'enum' | 'reference'

export type PropertyConstraints = {
  enumValues?: string[]  // for type: 'enum'
  min?: number           // for type: 'number'
  max?: number           // for type: 'number'
  minLength?: number     // for type: 'string'
  maxLength?: number     // for type: 'string'
  pattern?: string       // for type: 'string'
  minDate?: string       // for type: 'date' (ISO string)
  maxDate?: string       // for type: 'date' (ISO string)
}

export type EntityProperty = {
  id: string
  name: string       // 英文别名 / 技术标识
  nameZh?: string    // 中文显示名称
  type: PropertyType
  required: boolean
  description: string
  unique?: boolean   // maps to Neo4j UNIQUE constraint
  indexed?: boolean  // maps to Neo4j INDEX (only when unique is false)
  constraints?: PropertyConstraints
}

export type EntityData = {
  name: string
  label: string
  description: string
  properties: EntityProperty[]
  color: string
  entityType?: EntityType
}

export type EdgeStyle = 'straight' | 'bezier' | 'step'

export type RelationData = {
  name: string
  label?: string
  cardinality: Cardinality
  description: string
  edgeStyle?: EdgeStyle
  relationCategory?: RelationCategoryId
  relationType?: string   // second-level preset name, e.g. 'partOf', 'isA', 'owns'
  sourceKey?: string
  targetKey?: string
  midpoint?: { x: number; y: number }  // user-dragged bend point for the edge path
}

export type EntityNode = Node<EntityData, 'entity'>
export type RelationEdge = Edge<RelationData, 'relation'>

export type Selection =
  | { kind: 'entity'; id: string }
  | { kind: 'relation'; id: string }
  | { kind: 'workspace' }

export type AiChatMsg = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ContextMenuState = {
  entityId: string
  x: number
  y: number
} | null

export type AiProvider = 'anthropic' | 'openai-compat'

export type AiConfig = {
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
}

export type AiServiceConfig = {
  id: string
  name: string
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
}

/* ─── Skill Layer Types ─────────────────────────────────────────────────────── */

export type SkillId = 'free-chat' | 'ontology-design' | 'consistency-check' | 'doc-extract' | 'odl-edit'

export type OntologyPatch =
  | { kind: 'add_entity';   data: Partial<EntityData> & { name: string; label: string } }
  | { kind: 'add_relation'; sourceLabel: string; targetLabel: string; data: Partial<RelationData> & { name: string } }
  | { kind: 'add_property'; entityName: string; property: Omit<EntityProperty, 'id'> }
  | { kind: 'cypher_note';  cypher: string; description: string }

export type PatchItem = {
  id: string
  patch: OntologyPatch
  status: 'pending' | 'applied' | 'dismissed'
  msgId: string
}

export type OdlSection = 'concepts' | 'metrics' | 'disambiguation_rules' | 'query_templates' | 'data_quality_rules'

/* ─── Synthetic Data Generation Types ──────────────────────────────────────── */

export type GenProgressEvent =
  | { type: 'progress';             entity: string; label: string; index: number; total: number }
  | { type: 'entity_batch_progress'; entity: string; label: string; parentVal: string; batchIndex: number; batchTotal: number }
  | { type: 'entity_done';          entity: string; label: string; count: number }
  | { type: 'entity_error';         entity: string; label: string; message: string }
  | { type: 'dedup_done';           removed: number; kept: number }
  | { type: 'relink_done';          relationsLinked: number }
  | { type: 'done';                 totalEntities: number; totalRecords: number }
  | { type: 'warning';              message: string }
  | { type: 'error';                message: string }

export type GenDataConfig = {
  twinId:              string
  modelId:             string
  theme:               string
  entityCounts:        { entityNodeId: string; min: number; max: number }[]
  hierParentIds?:      Record<string, string>  // childEntityId → parentEntityId
  locale?:             string
  aiServiceId:         string
  mode:                'overwrite' | 'append'
  systemPrompt?:       string   // overrides default system prompt when set
  extraInstructions?:  string   // appended to each entity's user message
}

export type OdlPatch = {
  description: string
  section: OdlSection
  content: string
}

export type OdlPatchItem = {
  id: string
  patch: OdlPatch
  status: 'pending' | 'applied' | 'dismissed'
  msgId: string
}

export type CanvasView = 'detail' | 'globe'
export type FactoryTab = 'llm' | 'skills' | 'expert'

export type Skill = {
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
  toolInputSchema: Record<string, unknown> | null
  cypherExecution: string
  enabled: boolean
  isBuiltIn: boolean
  version: string
  createdAt?: string
  updatedAt?: string
}

export type OntologyModel = {
  id: string
  name: string
  description: string
  nodes: EntityNode[]
  edges: RelationEdge[]
  createdAt: string
  odl?: string
}

export type PendingEntityPlacement = {
  kind: 'entity'
  entityType: EntityType
  label: string
  color: string
  definition: string
}

export type PendingRelationPlacement = {
  kind: 'relation'
  presetName: string
  presetLabel: string
  categoryId: RelationCategoryId
  sourceId: string | null
}

export type PendingPlacement = PendingEntityPlacement | PendingRelationPlacement | null

/* ─── Instance Data Types ──────────────────────────────────────────────────── */

export type AppMode = 'schema' | 'instance' | 'model-factory' | 'smart-app'
export type InstanceViewTab = 'table' | 'import' | 'query'
export type ImportStep = 'mapping' | 'validate'

export type InstanceFieldValue = string | number | boolean | null

export type InstanceRecord = {
  id: string
  data: Record<string, InstanceFieldValue>
  validationErrors: Record<string, string>   // propertyName → error message
}

export type InstanceDataset = {
  id: string
  twinId: string        // which BizTwin this dataset belongs to
  modelId: string
  entityNodeId: string
  records: InstanceRecord[]
  importedAt: string
  sourceLabel: string
}

export type BizTwin = {
  id: string
  name: string
  description: string
  modelIds: string[]    // bound ontology model IDs
  color: string
  createdAt: string
}

export type ColumnMapping = {
  csvHeader: string
  mappedTo: string | null   // EntityProperty.name, null = skip
}

/* ─── Neo4j Integration Types ──────────────────────────────────────────────── */

export type Neo4jConfig = {
  url: string
  username: string
  password: string
  defaultQuery: string
}

export type Neo4jNodeRecord = {
  elementId: string
  labels: string[]
  properties: Record<string, string | number | boolean | null>
}

export type Neo4jRelRecord = {
  elementId: string
  type: string
  startNodeElementId: string
  endNodeElementId: string
  properties?: Record<string, string | number | boolean | null>
}

export type Neo4jGraphData = {
  nodes: Neo4jNodeRecord[]
  relationships: Neo4jRelRecord[]
}

export type ActiveImport = {
  entityNodeId: string
  step: ImportStep
  parsedHeaders: string[]
  parsedRows: Array<Record<string, string>>
  columnMappings: ColumnMapping[]
  previewRecords: InstanceRecord[]
  fileName: string
}
