import type {
  EntityProperty, EntityType, Cardinality, EdgeStyle, RelationCategoryId,
} from '../types'
import { MarkerType } from '@xyflow/react'
import type { EntityNode, RelationEdge, OntologyModel, BizTwin } from '../types'

/* ─── Base fetch ──────────────────────────────────────────────────────────── */

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (res.status === 204) return undefined as T
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as T
}

/* ─── DTO types (server response shapes) ─────────────────────────────────── */

export interface ModelDto {
  id: string; name: string; description: string; createdAt: string
}

export interface EntityDefDto {
  id: string; name: string; label: string; description: string
  color: string; entityType: EntityType
  properties: EntityProperty[]
  posX: number; posY: number
}

export interface RelDefDto {
  id: string; name: string; label?: string
  cardinality: Cardinality; description: string
  edgeStyle?: EdgeStyle; relationCategory?: RelationCategoryId
  relationType?: string
  source: string; target: string
  midpoint?: { x: number; y: number }
  sourceKey?: string
  targetKey?: string
}

export interface BizTwinDto {
  id: string; name: string; description: string; color: string
  createdAt: string; modelIds: string[]
}

/* ─── Mapper: DTO → frontend types ───────────────────────────────────────── */

export function entityDtoToNode(e: EntityDefDto): EntityNode {
  return {
    id: e.id, type: 'entity',
    position: { x: e.posX ?? 0, y: e.posY ?? 0 },
    data: {
      name: e.name, label: e.label, description: e.description,
      color: e.color, entityType: e.entityType, properties: e.properties ?? [],
    },
  }
}

export function relDtoToEdge(r: RelDefDto): RelationEdge {
  return {
    id: r.id, type: 'relation',
    source: r.source, target: r.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: {
      name: r.name, label: r.label, cardinality: r.cardinality,
      description: r.description, edgeStyle: r.edgeStyle,
      relationCategory: r.relationCategory,
      relationType: r.relationType,
      midpoint: r.midpoint,
      sourceKey: r.sourceKey,
      targetKey: r.targetKey,
    },
  }
}

export function bizTwinDtoToLocal(t: BizTwinDto): BizTwin {
  return { id: t.id, name: t.name, description: t.description, color: t.color, createdAt: t.createdAt, modelIds: t.modelIds }
}

/* ─── API client ──────────────────────────────────────────────────────────── */

export const api = {
  /* health */
  health: () => apiFetch<{ status: string }>('/health'),

  /* models */
  getModels: () => apiFetch<ModelDto[]>('/ontology/models'),
  createModel: (body: { id: string; name: string; description?: string }) =>
    apiFetch<ModelDto>('/ontology/models', { method: 'POST', body: JSON.stringify(body) }),
  updateModel: (id: string, body: { name?: string; description?: string }) =>
    apiFetch<ModelDto>(`/ontology/models/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteModel: (id: string) =>
    apiFetch<void>(`/ontology/models/${id}`, { method: 'DELETE' }),

  /* entities */
  getEntities: (modelId: string) => apiFetch<EntityDefDto[]>(`/ontology/models/${modelId}/entities`),
  createEntity: (modelId: string, body: {
    id: string; name: string; label: string; description: string
    color: string; entityType?: EntityType; properties: EntityProperty[]
    posX: number; posY: number
  }) => apiFetch<EntityDefDto>(`/ontology/models/${modelId}/entities`, { method: 'POST', body: JSON.stringify(body) }),
  updateEntity: (id: string, body: Partial<{
    name: string; label: string; description: string; color: string
    entityType: EntityType; properties: EntityProperty[]; posX: number; posY: number
  }>) => apiFetch<EntityDefDto>(`/ontology/entities/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEntity: (id: string) =>
    apiFetch<void>(`/ontology/entities/${id}`, { method: 'DELETE' }),

  /* relations */
  getRelations: (modelId: string) => apiFetch<RelDefDto[]>(`/ontology/models/${modelId}/relations`),
  createRelation: (modelId: string, body: {
    id: string; name: string; label?: string; cardinality: Cardinality
    description: string; edgeStyle?: EdgeStyle; relationCategory?: RelationCategoryId
    sourceId: string; targetId: string
  }) => apiFetch<RelDefDto>(`/ontology/models/${modelId}/relations`, { method: 'POST', body: JSON.stringify(body) }),
  updateRelation: (id: string, body: Partial<{
    name: string; label: string; cardinality: Cardinality
    description: string; edgeStyle: EdgeStyle; relationCategory: RelationCategoryId
    relationType: string; sourceKey: string; targetKey: string
    midpointX: number | null; midpointY: number | null
  }>) => apiFetch<RelDefDto>(`/ontology/relations/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  rerouteRelation: (id: string, sourceId: string, targetId: string) =>
    apiFetch<void>(`/ontology/relations/${id}/reroute`, { method: 'PUT', body: JSON.stringify({ sourceId, targetId }) }),
  deleteRelation: (id: string) =>
    apiFetch<void>(`/ontology/relations/${id}`, { method: 'DELETE' }),

  /* twins */
  getTwins: () => apiFetch<BizTwinDto[]>('/twins'),
  createTwin: (body: { id: string; name: string; description?: string; color?: string; modelIds?: string[] }) =>
    apiFetch<BizTwinDto>('/twins', { method: 'POST', body: JSON.stringify(body) }),
  updateTwin: (id: string, body: Partial<{ name: string; description: string; color: string; modelIds: string[] }>) =>
    apiFetch<BizTwinDto>(`/twins/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTwin: (id: string) =>
    apiFetch<void>(`/twins/${id}`, { method: 'DELETE' }),

  /* graph browser */
  browseGraph: (cypher?: string, params?: Record<string, unknown>) =>
    apiFetch<{ nodes: unknown[]; relationships: unknown[] }>('/graph/browse', {
      method: 'POST', body: JSON.stringify({ cypher, params }),
    }),

  /* cypher query */
  runCypherQuery: (cypher: string, params?: Record<string, unknown>) =>
    apiFetch<{ rows: unknown[] }>('/graph/query', {
      method: 'POST', body: JSON.stringify({ cypher, params }),
    }),
  runCypherWrite: (cypher: string, params?: Record<string, unknown>) =>
    apiFetch<{ rows: unknown[] }>('/graph/write', {
      method: 'POST', body: JSON.stringify({ cypher, params }),
    }),

  /* instances */
  getInstances: (twinId: string, entityDefId?: string) => {
    const q = new URLSearchParams({ twinId })
    if (entityDefId) q.set('entityDefId', entityDefId)
    return apiFetch<Record<string, unknown>[]>(`/instances?${q}`)
  },
  createInstances: (body: {
    twinId: string; entityDefId: string; entityLabel?: string
    records: { id: string; data: Record<string, unknown> }[]
    datasetId?: string; modelId?: string; sourceLabel?: string; importedAt?: string
  }) => apiFetch<{ created: number }>('/instances', { method: 'POST', body: JSON.stringify(body) }),
  deleteDatasetInstances: (twinId: string, entityDefId: string) =>
    apiFetch<void>(`/instances/dataset?twinId=${encodeURIComponent(twinId)}&entityDefId=${encodeURIComponent(entityDefId)}`, { method: 'DELETE' }),
  deleteTwinInstances: (twinId: string) =>
    apiFetch<void>(`/instances/twin?twinId=${encodeURIComponent(twinId)}`, { method: 'DELETE' }),
  updateInstance: (id: string, data: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/instances/${id}`, { method: 'PUT', body: JSON.stringify({ data }) }),
  deleteInstance: (id: string) =>
    apiFetch<void>(`/instances/${id}`, { method: 'DELETE' }),

  deleteInstances: (ids: string[]) =>
    apiFetch<void>('/instances/batch', { method: 'DELETE', body: JSON.stringify({ ids }) }),

  dedupInstances: (twinId: string) =>
    apiFetch<{ removed: number; kept: number }>('/instances/dedup', { method: 'POST', body: JSON.stringify({ twinId }) }),

  /* ODL */
  getOdl: (modelId: string) =>
    apiFetch<{ odl: string }>(`/ontology/models/${modelId}/odl`),
  saveOdl: (modelId: string, odl: string) =>
    apiFetch<void>(`/ontology/models/${modelId}/odl`, { method: 'PUT', body: JSON.stringify({ odl }) }),

  /* skills */
  getSkills: (filters?: { category?: string; skillType?: string; enabled?: boolean }) => {
    const q = new URLSearchParams()
    if (filters?.category)              q.set('category', filters.category)
    if (filters?.skillType)             q.set('skillType', filters.skillType)
    if (filters?.enabled !== undefined) q.set('enabled', String(filters.enabled))
    return apiFetch<unknown[]>(`/skills${q.toString() ? `?${q}` : ''}`)
  },
  createSkill:  (body: unknown) => apiFetch<unknown>('/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill:  (id: string, body: unknown) => apiFetch<unknown>(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSkill:  (id: string) => apiFetch<void>(`/skills/${id}`, { method: 'DELETE' }),
  exportSkill:  (id: string) => apiFetch<unknown>(`/skills/${id}/export`),
  exportSkillBundle: (category?: string) =>
    apiFetch<unknown>(`/skills/bundle${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  importSkillBundle: (skills: unknown[]) =>
    apiFetch<{ imported: number; updated: number; skipped: number; errors: string[]; total: number }>(
      '/skills/bundle', { method: 'POST', body: JSON.stringify({ skills }) }),
}

/* ─── Load a full model (entities + relations) from API ──────────────────── */

export async function loadFullModel(modelDto: ModelDto): Promise<OntologyModel> {
  const [entities, relations, odlResult] = await Promise.all([
    api.getEntities(modelDto.id),
    api.getRelations(modelDto.id),
    api.getOdl(modelDto.id).catch(() => ({ odl: '' })),
  ])
  return {
    id: modelDto.id,
    name: modelDto.name,
    description: modelDto.description,
    createdAt: modelDto.createdAt,
    nodes: entities.map(entityDtoToNode),
    edges: relations.map(relDtoToEdge),
    odl: odlResult.odl,
  }
}

/* ─── Seed an OntologyModel to Neo4j (used for initial data bootstrap) ───── */

export async function seedModelToApi(model: OntologyModel): Promise<void> {
  await api.createModel({ id: model.id, name: model.name, description: model.description })
  await Promise.all(
    model.nodes.map((n) =>
      api.createEntity(model.id, {
        id: n.id,
        name: n.data.name,
        label: n.data.label,
        description: n.data.description,
        color: n.data.color,
        entityType: n.data.entityType,
        properties: n.data.properties,
        posX: n.position.x,
        posY: n.position.y,
      }),
    ),
  )
  await Promise.all(
    model.edges.map((e) =>
      api.createRelation(model.id, {
        id: e.id,
        name: e.data?.name ?? 'relatedTo',
        label: e.data?.label,
        cardinality: e.data?.cardinality ?? '1:N',
        description: e.data?.description ?? '',
        edgeStyle: e.data?.edgeStyle,
        relationCategory: e.data?.relationCategory,
        sourceId: e.source,
        targetId: e.target,
      }),
    ),
  )
}
