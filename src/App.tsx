import { useCallback, useEffect, useMemo, useRef, useState, Component } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import type { ReactNode, ErrorInfo } from 'react'
import {
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type Connection,
  type EdgeProps,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type MiniMapNodeProps,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CirclePlus,
  Copy,
  Database,
  FolderOpen,
  GitBranchPlus,
  LayoutDashboard,
  LayoutGrid,
  List,
  Link,
  Link2,
  ListPlus,
  Map as MapIcon,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Table,
  X,
  Zap,
  FlaskConical,
  Download,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Loader2,
  RefreshCw,
  HelpCircle,
  FileDown,
  Play,
  TerminalSquare,
  BookOpen,
  CheckCircle,
  AlertTriangle,
  Wand2,
  Filter,
  Package,
} from 'lucide-react'
import { useSchemaStore, makeId, buildSchemaContext, validateSchema } from './store'
import { parseExcelSchema, parseJsonSchema, buildNodesEdges, mergeNodesEdges, generateTemplateXlsx, exportSchemaAsXlsx, type ImportResult } from './lib/schemaImporter'
import type { EntityNode, RelationEdge, EntityProperty, PropertyType, PropertyConstraints, AiProvider, AiServiceConfig, EdgeStyle, EntityType, RelationCategoryId, OntologyModel, InstanceDataset, InstanceRecord, InstanceFieldValue, ColumnMapping, SkillId, PatchItem, OdlPatchItem, BizTwin, Neo4jNodeRecord, Neo4jRelRecord, Skill, FactoryTab, GenProgressEvent } from './types'
import { useSkills, useToggleSkill, useSaveSkill, useDeleteSkill, useImportSkill } from './hooks/useSkills'
import { api } from './lib/api'
import { parseCSV, parseJSON, flattenJsonDocument, extractArrayRows, smartMapFieldsMultiEntity, type FolderFieldMapping } from './lib/csvParser'
import { buildInstanceRecords } from './lib/instanceValidator'
import { generateCypher, downloadCypher, exportTwinAsExcel, exportTwinAsCSV, exportTwinAsJSON, type TwinBundle } from './lib/cypherExporter'
import { SKILL_DEFINITIONS, SKILL_ORDER } from './lib/skills'
import './App.css'

/* ─── Schema Import Help Text ────────────────────────────────────────────── */

const SCHEMA_HELP_TEXT = `GraphFino 本体模型 · Excel 导入说明

📋  工作表说明
  实体：定义图谱中的节点类型（Node Label）
  属性：定义各实体的字段，每行一个属性
  关系：定义实体之间的边类型（Relationship Type）

📌  实体分类（8种，与系统对齐）
  有形实体、无形/概念实体、业务事件、流程/活动、
  主体、角色、时间/周期、空间/位置
  留空时系统将默认为「无形/概念实体」

📌  关系分类（8种）
  继承关系、组成关系、拥有关系、关联关系、
  依赖关系、流转关系、计算关系、引用关系

📌  字段规范
  实体名称：中文名称，同一模型中必须唯一，标 * 为必填
  英文别名：系统内部标识，留空将自动使用实体名称
  颜色：十六进制颜色代码，如 #1677FF（留空将按分类自动填充）
  数据类型：文本 / 数字 / 日期 / 布尔 / 枚举
  是否必填：是 / 否

⚠️  注意事项
  1. 属性表「所属实体」必须与实体表「实体名称」完全一致
  2. 关系表「源实体」「目标实体」必须在实体表中已定义
  3. 导入操作将覆盖当前本体，建议先导出备份
  4. 请勿删除或修改表头行（第1行）
  5. 同时支持导入 JSON 格式（即「导出 Schema」生成的文件）`

/* ─── Ontology Category Definitions ─────────────────────────────────────── */

type EntitySubtypeDef = {
  id: string; label: string; name: string; definition: string; color: string
}
type EntityCategoryDef = { id: string; label: string; name: string; subtypes: EntitySubtypeDef[] }

const ENTITY_CATEGORIES: EntityCategoryDef[] = [
  {
    id: 'concept', label: '概念与对象', name: 'Concept & Object',
    subtypes: [
      { id: 'physical', label: '有形实体', name: 'Physical Object', color: '#2f7d6d',
        definition: '真实存在的物理实体。如 设备、服务器、商品。' },
      { id: 'abstract', label: '无形/概念实体', name: 'Abstract Concept', color: '#5b6ee1',
        definition: '逻辑或法律层面定义的概念。如 组织机构、公司部门、会计科目、行业分类、知识产权。' },
    ],
  },
  {
    id: 'event', label: '事件与活动', name: 'Event & Activity',
    subtypes: [
      { id: 'event', label: '业务事件', name: 'Event', color: '#c06a3d',
        definition: '具有时间戳和不可逆性的动态实体。如 交易流水、审计事件、故障报修、任免事件。' },
      { id: 'activity', label: '流程/活动', name: 'Activity', color: '#d4984a',
        definition: '正在进行或计划中的任务。如 研发项目、审批流程。' },
    ],
  },
  {
    id: 'agent-role', label: '主体与角色', name: 'Agent & Role',
    subtypes: [
      { id: 'agent', label: '主体', name: 'Agent', color: '#7a5aa6',
        definition: '具备自主行为能力的实体。如 自然人、法人（公司）、软件系统（AI Agent/机器人）。' },
      { id: 'role', label: '角色', name: 'Role', color: '#4a8fa6',
        definition: '主体在特定场景下的身份（建议独立或作为标签）。如 供应商、客户、项目经理、核心研发人员。' },
    ],
  },
  {
    id: 'temporal-spatial', label: '时空与环境', name: 'Temporal & Spatial',
    subtypes: [
      { id: 'temporal', label: '时间/周期', name: 'Temporal', color: '#4a7ca6',
        definition: '用于提供时间上下文的基准维度。如 财年、季度、里程碑阶段。' },
      { id: 'spatial', label: '空间/位置', name: 'Spatial', color: '#6aa64a',
        definition: '用于提供空间上下文的基准维度。如 国家、城市、机房位置、虚拟网络区域。' },
    ],
  },
]

type RelationPresetItem = { name: string; label: string; color: string }
type RelationCategoryDef = {
  id: string; label: string; name: string; definition: string
  color: string   // category base color
  presets: RelationPresetItem[]
}

const RELATION_CATEGORIES: RelationCategoryDef[] = [
  {
    id: 'structural', label: '结构与层级', name: 'Structural & Hierarchical',
    color: '#3b7dd8',
    definition: '用于构建知识图谱的骨架，通常具有传递性（Transitive）。',
    presets: [
      { name: 'isA',    label: '上下位关系（isA / SubClassOf）',      color: '#2558b0' },
      { name: 'partOf', label: '组成/部分关系（partOf / hasPart）',   color: '#74aaf0' },
    ],
  },
  {
    id: 'associative', label: '关联与业务', name: 'Associative & Business',
    color: '#2a9d6e',
    definition: '反映业务逻辑横向连接的关系。',
    presets: [
      { name: 'owns',           label: '拥有/所属（Owns / Belongs to）',          color: '#1a7050' },
      { name: 'cooperatesWith', label: '合作/交互（Interacts / Cooperates）',      color: '#55c898' },
    ],
  },
  {
    id: 'participatory', label: '动态参与', name: 'Participatory',
    color: '#d97706',
    definition: '连接"动态事件"与"静态主体/客体"的关系。',
    presets: [
      { name: 'initiatedBy', label: '发起/执行（InitiatedBy / ExecutedBy）', color: '#b25c04' },
      { name: 'appliedTo',   label: '作用对象（Target / ObjectOf）',          color: '#f5b445' },
    ],
  },
  {
    id: 'temporal-causal', label: '时间与因果', name: 'Temporal & Causal',
    color: '#7c3aed',
    definition: '用于流程推理、时序分析和根因分析。',
    presets: [
      { name: 'before', label: '时序关系（Before / After）',    color: '#5b21b6' },
      { name: 'causes', label: '因果/触发（Causes / Triggers）', color: '#a87ef5' },
    ],
  },
  {
    id: 'mapping', label: '同义与映射', name: 'Mapping / Identity',
    color: '#0891b2',
    definition: '用于数据集成和实体对齐（Entity Resolution）。',
    presets: [
      { name: 'sameAs', label: '等价关系（sameAs）', color: '#0891b2' },
    ],
  },
]

function getRelationColor(categoryId?: string, presetName?: string): string {
  const cat = RELATION_CATEGORIES.find((c) => c.id === categoryId)
  if (!cat) return '#94a3b8'
  if (!presetName) return cat.color
  return cat.presets.find((p) => p.name === presetName)?.color ?? cat.color
}

function findEntitySubtype(entityType?: string): EntitySubtypeDef | null {
  if (!entityType) return null
  for (const cat of ENTITY_CATEGORIES)
    for (const sub of cat.subtypes)
      if (sub.id === entityType) return sub
  return null
}

function findRelationCategory(id?: string): RelationCategoryDef | null {
  return RELATION_CATEGORIES.find((c) => c.id === id) ?? null
}

/* ─── Entity Card (detail view) ──────────────────────────────────────────── */

function EntityCard({ id, data, selected }: NodeProps<EntityNode>) {
  const setSelected       = useSchemaStore((s) => s.setSelected)
  const addConnected      = useSchemaStore((s) => s.addConnectedEntity)
  const addProperty       = useSchemaStore((s) => s.addProperty)
  const setContextMenu    = useSchemaStore((s) => s.setContextMenu)
  const isRelationSource  = useSchemaStore(
    (s) => s.pendingPlacement?.kind === 'relation' && s.pendingPlacement.sourceId === id,
  )

  const [tooltipVisible, setTooltipVisible] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => setTooltipVisible(true), 1000)
  }, [])
  const onMouseLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setTooltipVisible(false)
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setSelected({ kind: 'entity', id })
    setContextMenu({ entityId: id, x: e.clientX, y: e.clientY })
  }, [id, setSelected, setContextMenu])

  // id property + first 2 non-id properties
  const idProp = data.properties.find((p) => p.name === 'id' || p.name === 'ID')
  const otherProps = data.properties.filter((p) => p !== idProp).slice(0, 2)
  const displayProps = idProp ? [idProp, ...otherProps] : data.properties.slice(0, 2)
  const hiddenCount = data.properties.length - displayProps.length

  return (
    <div
      className={`entity-card ${selected ? 'is-selected' : ''} ${isRelationSource ? 'is-relation-source' : ''}`}
      onDoubleClick={(e) => { e.stopPropagation(); addProperty(id) }}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Handle type="target" position={Position.Left} className="entity-handle" />
      <div className="entity-accent" style={{ background: data.color }} />
      <div className="entity-header" onClick={() => setSelected({ kind: 'entity', id })}>
        <Database size={13} />
        <div>
          <strong>{data.label || data.name}</strong>
          <span>{data.name}</span>
        </div>
      </div>
      <div className="property-list">
        {displayProps.map((p) => (
          <button key={p.id} type="button" className="property-row"
            onClick={() => setSelected({ kind: 'entity', id })}>
            <span>{p.nameZh || p.name}</span>
            <small>{p.type}{p.required ? '*' : ''}</small>
          </button>
        ))}
        {hiddenCount > 0 && (
          <span className="property-more">+{hiddenCount}</span>
        )}
      </div>
      <div className="node-actions">
        <button type="button" title="添加属性（双击卡片）" onClick={() => addProperty(id)}>
          <ListPlus size={13} />
        </button>
        <button type="button" title="添加关联实体" onClick={() => addConnected(id)}>
          <GitBranchPlus size={13} />
        </button>
      </div>
      {tooltipVisible && data.description && (
        <div className="entity-tooltip">
          <strong>{data.label || data.name}</strong>
          <p>{data.description}</p>
        </div>
      )}
      <Handle type="source" position={Position.Right} className="entity-handle" />
    </div>
  )
}

/* ─── Globe Node (simple/overview view) ─────────────────────────────────── */

function GlobeNode({ id, data, selected }: NodeProps<EntityNode>) {
  const setSelected      = useSchemaStore((s) => s.setSelected)
  const setContextMenu   = useSchemaStore((s) => s.setContextMenu)
  const globeSize        = useSchemaStore((s) => s.globeNodeSize)
  const isRelationSource = useSchemaStore(
    (s) => s.pendingPlacement?.kind === 'relation' && s.pendingPlacement.sourceId === id,
  )

  const fontSize = Math.max(8, Math.round(globeSize * 0.158))

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setSelected({ kind: 'entity', id })
    setContextMenu({ entityId: id, x: e.clientX, y: e.clientY })
  }, [id, setSelected, setContextMenu])

  return (
    <div
      className={`globe-node ${selected ? 'globe-selected' : ''} ${isRelationSource ? 'globe-relation-source' : ''}`}
      style={{ background: data.color, width: globeSize, height: globeSize }}
      onClick={() => setSelected({ kind: 'entity', id })}
      onContextMenu={onContextMenu}
    >
      <Handle type="target" position={Position.Left} className="globe-handle" />
      <span className="globe-label" style={{ fontSize }}>{data.label || data.name}</span>
      <Handle type="source" position={Position.Right} className="globe-handle" />
    </div>
  )
}

/* ─── MiniMap node shapes ────────────────────────────────────────────────── */

function MiniMapGlobeNode({ x, y, width, height, color, selected }: MiniMapNodeProps) {
  const r = Math.min(width, height) / 2
  return (
    <circle
      cx={x + width / 2}
      cy={y + height / 2}
      r={r}
      fill={color ?? '#e2e2e2'}
      stroke={selected ? '#fff' : 'rgba(0,0,0,0.15)'}
      strokeWidth={selected ? 2.5 : 1}
    />
  )
}

/* ─── Relation Edge ──────────────────────────────────────────────────────── */

function RelationEdgeView(props: EdgeProps<RelationEdge>) {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, selected } = props
  const edgeStyle = props.data?.edgeStyle ?? 'bezier'
  const setSelected  = useSchemaStore((s) => s.setSelected)
  const updateRelation = useSchemaStore((s) => s.updateRelation)
  const { screenToFlowPosition } = useReactFlow()
  const [localMid, setLocalMid] = useState<{ x: number; y: number } | null>(null)

  const color    = getRelationColor(props.data?.relationCategory, props.data?.name)
  const markerId = `rel-arrow-${props.id}`

  // localMid is set during live drag; data.midpoint is the persisted value
  const midpoint = localMid ?? props.data?.midpoint ?? null

  let edgePath: string
  let labelX: number
  let labelY: number

  if (midpoint) {
    // quadratic bezier that passes through the user-chosen midpoint at t=0.5
    const cx = 2 * midpoint.x - sourceX * 0.5 - targetX * 0.5
    const cy = 2 * midpoint.y - sourceY * 0.5 - targetY * 0.5
    edgePath = `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`
    labelX = midpoint.x
    labelY = midpoint.y
  } else {
    const pathArgs = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
    const [d, lx, ly] =
      edgeStyle === 'straight' ? getStraightPath({ sourceX, sourceY, targetX, targetY }) :
      edgeStyle === 'step'     ? getSmoothStepPath(pathArgs) :
                                 getBezierPath(pathArgs)
    edgePath = d
    labelX = lx
    labelY = ly
  }

  const handleLabelPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    setSelected({ kind: 'relation', id: props.id })
    setLocalMid({ x: labelX, y: labelY })

    const onMove = (ev: PointerEvent) => {
      setLocalMid(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }))
    }
    const onUp = (ev: PointerEvent) => {
      const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      updateRelation(props.id, { midpoint: pos })
      setLocalMid(null)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const hasBend = Boolean(midpoint && !localMid)  // persisted bend exists

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="12" markerHeight="9"
          refX="10" refY="4.5"
          orient="auto"
        >
          <path d="M 0 0 L 12 4.5 L 0 9 z" fill={color} />
        </marker>
      </defs>
      <path
        id={props.id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{ stroke: color, strokeWidth: 1.8, fill: 'none' }}
        markerEnd={`url(#${markerId})`}
      />
      <EdgeLabelRenderer>
        <div
          className={`relation-label nodrag nopan${hasBend ? ' relation-label--bent' : ''}`}
          style={{
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            borderColor: color,
            cursor: localMid ? 'grabbing' : 'grab',
            pointerEvents: 'all',
          }}
          onPointerDown={handleLabelPointerDown}
          onClick={() => setSelected({ kind: 'relation', id: props.id })}
        >
          <span className="relation-label-dot" style={{ background: color }} />
          {props.data?.label ?? props.data?.name ?? 'relation'}
          <span className="relation-label-card">{props.data?.cardinality ?? '1:N'}</span>
          {(selected || hasBend) && (
            <span className="edge-drag-handle" title="拖动调整线条弯曲">⠿</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/* ─── Context Menu ───────────────────────────────────────────────────────── */

function ContextMenuPortal() {
  const contextMenu    = useSchemaStore((s) => s.contextMenu)
  const setContextMenu = useSchemaStore((s) => s.setContextMenu)
  const addProperty    = useSchemaStore((s) => s.addProperty)
  const addConnected   = useSchemaStore((s) => s.addConnectedEntity)
  const deleteEntity   = useSchemaStore((s) => s.deleteEntity)
  const duplicateEntity = useSchemaStore((s) => s.duplicateEntity)
  const updateEntity   = useSchemaStore((s) => s.updateEntity)
  const nodes          = useSchemaStore((s) => s.nodes)

  const close = useCallback(() => setContextMenu(null), [setContextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onPtr = (e: PointerEvent) => {
      const el = document.getElementById('ctx-menu')
      if (el && !el.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPtr)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPtr)
    }
  }, [contextMenu, close])

  if (!contextMenu) return null
  const entity = nodes.find((n) => n.id === contextMenu.entityId)
  const act = (fn: () => void) => { fn(); close() }

  return (
    <div id="ctx-menu" className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
      <div className="ctx-entity-name">
        <span className="ctx-dot" style={{ background: entity?.data.color ?? '#2f7d6d' }} />
        {entity?.data.label || entity?.data.name || '实体'}
      </div>
      <hr />
      <button type="button" onClick={() => act(() => addProperty(contextMenu.entityId))}>
        <ListPlus size={14} /> 添加属性
      </button>
      <button type="button" onClick={() => act(() => addConnected(contextMenu.entityId))}>
        <GitBranchPlus size={14} /> 添加关联实体
      </button>
      <button type="button" onClick={() => act(() => duplicateEntity(contextMenu.entityId))}>
        <Copy size={14} /> 复制实体
      </button>
      <hr />
      <label className="ctx-color-row">
        <span>更改颜色</span>
        <input
          type="color"
          value={entity?.data.color ?? '#2f7d6d'}
          onChange={(e) => updateEntity(contextMenu.entityId, { color: e.target.value })}
        />
      </label>
      <hr />
      <button type="button" className="ctx-danger" onClick={() => act(() => deleteEntity(contextMenu.entityId))}>
        <Trash2 size={14} /> 删除实体
      </button>
    </div>
  )
}

/* ─── NewTwinModal ───────────────────────────────────────────────────────── */

const TWIN_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

function NewTwinModal({
  models,
  onClose,
  onCreate,
}: {
  models: OntologyModel[]
  onClose: () => void
  onCreate: (twin: BizTwin) => void
}) {
  const [name, setName]           = useState('')
  const [desc, setDesc]           = useState('')
  const [selectedColor, setColor] = useState(TWIN_COLORS[0])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(models.length > 0 ? [models[0].id] : []),
  )

  function toggleModel(id: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (selectedModels.size === 0) { alert('请至少选择一个本体模型'); return }
    onCreate({
      id: makeId('twin'),
      name: trimmed,
      description: desc.trim(),
      modelIds: Array.from(selectedModels),
      color: selectedColor,
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="new-twin-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="new-twin-modal">
        <div className="new-twin-header">
          <strong>新建业务孪生</strong>
          <button type="button" className="btn-close-modal" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="new-twin-body">
          <label className="new-twin-field">
            <span>孪生名称 <em>*</em></span>
            <input
              autoFocus
              placeholder="例如：云枢科技差旅管理"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
          </label>
          <label className="new-twin-field">
            <span>描述（选填）</span>
            <input
              placeholder="简要描述该孪生的应用场景"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
          <div className="new-twin-field">
            <span>绑定本体模型</span>
            <div className="twin-model-picks">
              {models.map((m) => (
                <label key={m.id} className="twin-model-pick">
                  <input
                    type="checkbox"
                    checked={selectedModels.has(m.id)}
                    onChange={() => toggleModel(m.id)}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </div>
          <div className="new-twin-field">
            <span>头像颜色</span>
            <div className="twin-color-picks">
              {TWIN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`twin-color-dot${selectedColor === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <div className="twin-avatar-preview" style={{ background: selectedColor }}>
                {name[0] || '孪'}
              </div>
            </div>
          </div>
        </div>
        <div className="new-twin-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" onClick={handleCreate} disabled={!name.trim()}>
            <Plus size={14} /> 创建孪生
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Sidebar ────────────────────────────────────────────────────────────── */

const FACTORY_TABS: { key: FactoryTab; label: string; icon: React.ElementType }[] = [
  { key: 'llm',    label: '大模型服务', icon: Sparkles },
  { key: 'skills', label: '技能仓库',   icon: Zap },
  { key: 'expert', label: '专家模型',   icon: FlaskConical },
]

function Sidebar() {
  const nodes               = useSchemaStore((s) => s.nodes)
  const edges               = useSchemaStore((s) => s.edges)
  const models              = useSchemaStore((s) => s.models)
  const activeModelId       = useSchemaStore((s) => s.activeModelId)
  const switchModel         = useSchemaStore((s) => s.switchModel)
  const addModel            = useSchemaStore((s) => s.addModel)
  const deleteModel         = useSchemaStore((s) => s.deleteModel)
  const renameModel         = useSchemaStore((s) => s.renameModel)
  const duplicateModel      = useSchemaStore((s) => s.duplicateModel)
  const searchQuery         = useSchemaStore((s) => s.searchQuery)
  const setSearchQuery      = useSchemaStore((s) => s.setSearchQuery)
  const setSelected         = useSchemaStore((s) => s.setSelected)
  const setPendingPlacement = useSchemaStore((s) => s.setPendingPlacement)
  const exportSchema          = useSchemaStore((s) => s.exportSchema)
  const importSchemaFromData  = useSchemaStore((s) => s.importSchemaFromData)
  const mergeSchemaFromData   = useSchemaStore((s) => s.mergeSchemaFromData)
  const sidebarOpen           = useSchemaStore((s) => s.sidebarOpen)
  const setSidebarOpen      = useSchemaStore((s) => s.setSidebarOpen)
  const appMode             = useSchemaStore((s) => s.appMode)
  const setAppMode          = useSchemaStore((s) => s.setAppMode)
  const factoryTab          = useSchemaStore((s) => s.factoryTab)
  const setFactoryTab       = useSchemaStore((s) => s.setFactoryTab)
  const instanceDatasets    = useSchemaStore((s) => s.instanceDatasets)
  const bizTwins            = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId     = useSchemaStore((s) => s.activeBizTwinId)
  const addBizTwin          = useSchemaStore((s) => s.addBizTwin)
  const deleteBizTwin       = useSchemaStore((s) => s.deleteBizTwin)
  const setActiveBizTwinId  = useSchemaStore((s) => s.setActiveBizTwinId)

  // Schema import/help state
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<{
    result:         ImportResult
    overwriteNodes: ReturnType<typeof buildNodesEdges>['nodes']
    overwriteEdges: ReturnType<typeof buildNodesEdges>['edges']
    mergeNodes:     ReturnType<typeof buildNodesEdges>['nodes']
    mergeEdges:     ReturnType<typeof buildNodesEdges>['edges']
    renamedLabels:  Map<string, string>
  } | null>(null)
  const [importMode, setImportMode]       = useState<'overwrite' | 'merge'>('merge')
  const [isImporting, setIsImporting]     = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)

  async function handleSchemaFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    let result: ImportResult
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      result = await parseExcelSchema(file)
    } else {
      result = parseJsonSchema(await file.text())
    }
    const { nodes: overwriteNodes, edges: overwriteEdges } = buildNodesEdges(result)
    const { nodes: mergeNodes,     edges: mergeEdges, renamedLabels } = mergeNodesEdges(result, nodes)
    setImportPreview({ result, overwriteNodes, overwriteEdges, mergeNodes, mergeEdges, renamedLabels })
  }

  async function confirmSchemaImport() {
    if (!importPreview) return
    setIsImporting(true)
    if (importMode === 'merge') {
      await mergeSchemaFromData(importPreview.mergeNodes, importPreview.mergeEdges)
    } else {
      await importSchemaFromData(importPreview.overwriteNodes, importPreview.overwriteEdges)
    }
    setIsImporting(false)
    setImportPreview(null)
  }

  // Model management local state
  const [isAdding, setIsAdding]         = useState(false)
  const [addingName, setAddingName]     = useState('')
  const [renamingId, setRenamingId]     = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState('')
  const [showNewTwin, setShowNewTwin]   = useState(false)

  const [expandedEntityCats, setExpandedEntityCats] = useState<Set<string>>(new Set())
  const [expandedRelCats, setExpandedRelCats]       = useState<Set<string>>(new Set())

  const toggleEntityCat = useCallback((id: string) => {
    setExpandedEntityCats((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])
  const toggleRelCat = useCallback((id: string) => {
    setExpandedRelCats((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  const confirmAdd = useCallback(() => {
    const name = addingName.trim()
    if (name) addModel(name)
    setIsAdding(false)
    setAddingName('')
  }, [addingName, addModel])

  const confirmRename = useCallback(() => {
    const name = renamingName.trim()
    if (name && renamingId) renameModel(renamingId, name)
    setRenamingId(null)
  }, [renamingName, renamingId, renameModel])

  const handleDeleteModel = useCallback((id: string) => {
    if (window.confirm('确认删除该本体模型？此操作不可撤销。')) deleteModel(id)
  }, [deleteModel])

  const startRename = useCallback((model: OntologyModel) => {
    setRenamingId(model.id)
    setRenamingName(model.name)
  }, [])

  const filtered = useMemo(
    () => nodes.filter((n) =>
      n.data.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.data.label.includes(searchQuery),
    ),
    [nodes, searchQuery],
  )

  if (!sidebarOpen) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button
          type="button"
          className="panel-toggle-btn"
          title="展开侧边栏"
          onClick={() => setSidebarOpen(true)}
        >
          <ChevronRight size={18} />
        </button>
        <div className="sidebar-collapsed-icons">
          <button
            type="button"
            className={`collapsed-nav-btn${appMode === 'schema' ? ' collapsed-nav-active' : ''}`}
            title="本体设计"
            onClick={() => { setSidebarOpen(true); setAppMode('schema') }}
          >
            <Network size={20} />
          </button>
          <button
            type="button"
            className={`collapsed-nav-btn${appMode === 'instance' ? ' collapsed-nav-active' : ''}`}
            title="业务孪生"
            onClick={() => { setSidebarOpen(true); setAppMode('instance') }}
          >
            <Database size={18} />
          </button>
          <button
            type="button"
            className={`collapsed-nav-btn${appMode === 'model-factory' ? ' collapsed-nav-active' : ''}`}
            title="模型工场"
            onClick={() => { setSidebarOpen(true); setAppMode('model-factory') }}
          >
            <Sparkles size={18} />
          </button>
          <button
            type="button"
            className={`collapsed-nav-btn${appMode === 'smart-app' ? ' collapsed-nav-active' : ''}`}
            title="智能应用"
            onClick={() => { setSidebarOpen(true); setAppMode('smart-app') }}
          >
            <Bot size={18} />
          </button>
        </div>
      </aside>
    )
  }

  const showSearch = searchQuery.trim().length > 0

  return (
    <aside className="sidebar">
      <div className="brand">
        <Boxes size={22} />
        <div>
          <strong>Ontology Studio</strong>
        </div>
        <button
          type="button"
          className="panel-toggle-inline"
          title="折叠侧边栏"
          onClick={() => setSidebarOpen(false)}
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* ══ 本体设计 区段 ══ */}
      <div className={`nav-section${appMode === 'schema' ? ' nav-section-active' : ''}`}>
        <button
          type="button"
          className="nav-section-header"
          onClick={() => setAppMode('schema')}
        >
          <Network size={14} />
          <span>本体设计</span>
          <ChevronRight size={12} className={`nav-section-chevron${appMode === 'schema' ? ' open' : ''}`} />
        </button>

        {appMode === 'schema' && (
          <div className="nav-section-body">
            {/* ── Model Navigator ── */}
            <div className="model-nav">
              <div className="model-nav-header">
                <span>本体模型</span>
                <button
                  type="button"
                  title="新建本体模型"
                  onClick={() => { setIsAdding(true); setAddingName('') }}
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="model-list">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className={`model-item${model.id === activeModelId ? ' model-active' : ''}`}
                  >
                    {renamingId === model.id ? (
                      <input
                        className="model-inline-input"
                        autoFocus
                        value={renamingName}
                        onChange={(e) => setRenamingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={confirmRename}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="model-name-btn"
                          onClick={() => switchModel(model.id)}
                        >
                          <span className={`model-dot${model.id === activeModelId ? ' model-dot-active' : ''}`} />
                          <span className="model-name-text">{model.name}</span>
                          <small className="model-entity-count">{
                            model.id === activeModelId
                              ? nodes.length
                              : model.nodes.length
                          } 实体</small>
                        </button>
                        <div className="model-item-actions">
                          <button type="button" title="复制" onClick={() => duplicateModel(model.id)}>
                            <Copy size={11} />
                          </button>
                          <button type="button" title="重命名" onClick={() => startRename(model)}>
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            title="删除"
                            className="model-delete-btn"
                            disabled={models.length <= 1}
                            onClick={() => handleDeleteModel(model.id)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {isAdding && (
                  <div className="model-item">
                    <input
                      className="model-inline-input model-inline-input-add"
                      autoFocus
                      placeholder="本体名称…"
                      value={addingName}
                      onChange={(e) => setAddingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmAdd()
                        if (e.key === 'Escape') setIsAdding(false)
                      }}
                      onBlur={confirmAdd}
                    />
                  </div>
                )}
              </div>
            </div>

            <label className="search-box">
              <Search size={15} />
              <input
                placeholder="搜索实体或属性"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button type="button" className="search-clear" onClick={() => setSearchQuery('')}>
                  <X size={13} />
                </button>
              )}
            </label>

            <div className="sidebar-scroll-area">
            {showSearch ? (
              <section>
                <div className="panel-title"><span>搜索结果（{filtered.length}）</span></div>
                <div className="template-list">
                  {filtered.map((n) => (
                    <button key={n.id} type="button" className="template-button"
                      onClick={() => setSelected({ kind: 'entity', id: n.id })}>
                      <span style={{ background: n.data.color }} />
                      <div>
                        <strong>{n.data.label || n.data.name}</strong>
                        <small>{n.data.name} · {n.data.properties.length} 属性</small>
                      </div>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="sidebar-empty">未找到匹配实体</p>}
                </div>
              </section>
            ) : (
              <>
                <section>
                  <div className="panel-title">
                    <span>实体模板</span>
                  </div>
                  <div className="tree-list">
                    {ENTITY_CATEGORIES.map((cat) => {
                      const catColor = cat.subtypes[0]?.color ?? '#667085'
                      const isOpen = expandedEntityCats.has(cat.id)
                      return (
                        <div key={cat.id} className="tree-category">
                          <button
                            type="button"
                            className={`tree-cat-header${isOpen ? ' tree-cat-open' : ''}`}
                            onClick={() => toggleEntityCat(cat.id)}
                          >
                            <ChevronRight size={12} className={`tree-chevron${isOpen ? ' tree-chevron-open' : ''}`} />
                            <span className="tree-cat-dot" style={{ background: catColor }} />
                            <span className="tree-cat-label">{cat.label}</span>
                            <small className="tree-cat-name">{cat.name}</small>
                          </button>
                          {isOpen && (
                            <div className="tree-cat-body">
                              {cat.subtypes.map((sub) => (
                                <button
                                  key={sub.id}
                                  type="button"
                                  className="tree-item tree-preset-applicable"
                                  title={`点击后在画布上放置「${sub.label}」实体`}
                                  onClick={() => setPendingPlacement({
                                    kind: 'entity',
                                    entityType: sub.id as EntityType,
                                    label: sub.label,
                                    color: sub.color,
                                    definition: sub.definition,
                                  })}
                                >
                                  <span className="tree-item-dot" style={{ background: sub.color }} />
                                  <div>
                                    <strong>{sub.label}</strong>
                                    <small>{sub.name}</small>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
                <section>
                  <div className="panel-title"><span>预设关系</span><Link2 size={15} /></div>
                  <div className="tree-list">
                    {RELATION_CATEGORIES.map((cat) => {
                      const isOpen = expandedRelCats.has(cat.id)
                      return (
                        <div key={cat.id} className="tree-category">
                          <button
                            type="button"
                            className={`tree-cat-header${isOpen ? ' tree-cat-open' : ''}`}
                            onClick={() => toggleRelCat(cat.id)}
                          >
                            <ChevronRight size={12} className={`tree-chevron${isOpen ? ' tree-chevron-open' : ''}`} />
                            <span className="tree-cat-dot" style={{ background: cat.color }} />
                            <span className="tree-cat-label">{cat.label}</span>
                            <small className="tree-cat-name">{cat.name}</small>
                          </button>
                          {isOpen && (
                            <div className="tree-cat-body">
                              {cat.presets.map((preset) => (
                                <button
                                  key={preset.name}
                                  type="button"
                                  className="tree-item tree-preset-applicable"
                                  title={`点击后依次选择起始/目标实体建立「${preset.label}」关系`}
                                  onClick={() => setPendingPlacement({
                                    kind: 'relation',
                                    presetName: preset.name,
                                    presetLabel: preset.label,
                                    categoryId: cat.id as RelationCategoryId,
                                    sourceId: null,
                                  })}
                                >
                                  <span className="tree-item-dot" style={{ background: preset.color }} />
                                  <div>
                                    <strong>{preset.label}</strong>
                                    <small>{preset.name}</small>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              </>
            )}
            </div>

            <div className="sidebar-footer">
              <div className="sidebar-summary">
                <div><strong>{nodes.length}</strong><span>实体</span></div>
                <div><strong>{edges.length}</strong><span>关系</span></div>
              </div>
              <div className="sidebar-footer-actions">
                <div className="sidebar-footer-row">
                  <button type="button" className="btn-ghost sidebar-footer-icon-btn" title="帮助 / 导入说明" onClick={() => setShowHelpModal(true)}>
                    <HelpCircle size={14} />
                  </button>
                  <button type="button" className="btn-ghost sidebar-footer-icon-btn" title="下载 Excel 模板（可填写后导入）" onClick={generateTemplateXlsx}>
                    <Download size={14} />
                    <span>模板</span>
                  </button>
                  <button type="button" className="btn-ghost sidebar-footer-icon-btn" title="导入 Excel 或 JSON Schema" onClick={() => importFileRef.current?.click()}>
                    <Upload size={14} />
                    <span>导入</span>
                  </button>
                </div>
                <div className="sidebar-footer-exports">
                  <button type="button" className="export-btn" onClick={exportSchema} title="导出当前本体为 JSON">
                    <Save size={14} /> 导出 JSON
                  </button>
                  <button type="button" className="export-btn" onClick={() => exportSchemaAsXlsx(nodes as EntityNode[], edges as RelationEdge[])} title="导出当前本体为 Excel">
                    <FileDown size={14} /> 导出 Excel
                  </button>
                </div>
              </div>
              <input ref={importFileRef} type="file" accept=".xlsx,.xls,.json" style={{ display: 'none' }} onChange={handleSchemaFileChange} />
            </div>
          </div>
        )}
      </div>

      {/* ══ 业务孪生 区段 ══ */}
      <div className={`nav-section${appMode === 'instance' ? ' nav-section-active' : ''}`}>
        <button
          type="button"
          className="nav-section-header"
          onClick={() => setAppMode('instance')}
        >
          <Database size={14} />
          <span>业务孪生</span>
          <ChevronRight size={12} className={`nav-section-chevron${appMode === 'instance' ? ' open' : ''}`} />
        </button>

        {appMode === 'instance' && (
          <div className="nav-section-body">
            <div className="biz-twin-toolbar">
              <button
                type="button"
                className="btn-new-twin"
                onClick={() => setShowNewTwin(true)}
              >
                <Plus size={13} /> 新建孪生
              </button>
            </div>
            {bizTwins.length === 0 ? (
              <div className="biz-empty">
                <p>点击上方「新建孪生」创建第一个业务孪生场景</p>
              </div>
            ) : (
              <div className="sidebar-scroll-area">
                <div className="biz-twin-list">
                  {bizTwins.map((twin) => {
                    const twinDatasets = instanceDatasets[twin.id] ?? []
                    const totalRecords = twinDatasets.reduce((s, d) => s + d.records.length, 0)
                    const twinModelNames = twin.modelIds
                      .map((mid) => models.find((m) => m.id === mid)?.name ?? mid)
                      .join(', ')
                    const isActive = twin.id === activeBizTwinId
                    return (
                      <div key={twin.id} className={`biz-twin-item${isActive ? ' biz-twin-active' : ''}`}>
                        <button
                          type="button"
                          className="biz-twin-main"
                          onClick={() => { setActiveBizTwinId(twin.id); setAppMode('instance') }}
                        >
                          <div className="twin-avatar" style={{ background: twin.color }}>
                            {twin.name[0]}
                          </div>
                          <div className="twin-info">
                            <strong>{twin.name}</strong>
                            <small className="twin-meta">{twinModelNames} · {totalRecords} 条</small>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="btn-twin-del"
                          title="删除此孪生"
                          onClick={() => {
                            if (window.confirm(`确认删除「${twin.name}」？此操作将同时删除其所有实例数据。`))
                              deleteBizTwin(twin.id)
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ 新建孪生对话框 ══ */}
      {showNewTwin && (
        <NewTwinModal
          models={models}
          onClose={() => setShowNewTwin(false)}
          onCreate={(twin) => {
            addBizTwin(twin)
            setActiveBizTwinId(twin.id)
            setAppMode('instance')
            setShowNewTwin(false)
          }}
        />
      )}

      {/* ══ 模型工场 区段 ══ */}
      <div className={`nav-section${appMode === 'model-factory' ? ' nav-section-active' : ''}`}>
        <button
          type="button"
          className="nav-section-header"
          onClick={() => setAppMode('model-factory')}
        >
          <Sparkles size={14} />
          <span>模型工场</span>
          <ChevronRight size={12} className={`nav-section-chevron${appMode === 'model-factory' ? ' open' : ''}`} />
        </button>
        {appMode === 'model-factory' && (
          <div className="nav-section-body">
            {FACTORY_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={`factory-nav-item${factoryTab === key ? ' factory-nav-active' : ''}`}
                onClick={() => setFactoryTab(key)}
              >
                <Icon size={13} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ══ 智能应用 区段 ══ */}
      <div className={`nav-section${appMode === 'smart-app' ? ' nav-section-active' : ''}`}>
        <button
          type="button"
          className="nav-section-header"
          onClick={() => setAppMode('smart-app')}
        >
          <Bot size={14} />
          <span>智能应用</span>
          <ChevronRight size={12} className={`nav-section-chevron${appMode === 'smart-app' ? ' open' : ''}`} />
        </button>

        {appMode === 'smart-app' && (
          <div className="nav-section-body">
            {bizTwins.length === 0 ? (
              <div className="biz-empty">
                <p>请先在「业务孪生」中创建并导入数据</p>
              </div>
            ) : (
              <div className="sidebar-scroll-area">
                <div className="biz-twin-list">
                  {bizTwins.map((twin) => {
                    const twinDatasets = instanceDatasets[twin.id] ?? []
                    const totalRecords = twinDatasets.reduce((s, d) => s + d.records.length, 0)
                    const isActive = twin.id === activeBizTwinId
                    return (
                      <div key={twin.id} className={`biz-twin-item${isActive ? ' biz-twin-active' : ''}`}>
                        <button
                          type="button"
                          className="biz-twin-main"
                          onClick={() => setActiveBizTwinId(twin.id)}
                        >
                          <div className="twin-avatar" style={{ background: twin.color }}>
                            {twin.name[0]}
                          </div>
                          <div className="twin-info">
                            <strong>{twin.name}</strong>
                            <small className="twin-meta">{totalRecords} 条实例数据</small>
                          </div>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Schema 导入预览 Modal ── */}
      {importPreview && (
        <div className="neo4j-modal-overlay" onClick={() => !isImporting && setImportPreview(null)}>
          <div className="neo4j-modal schema-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="neo4j-modal-header">
              <Upload size={15} />
              <span>导入 Schema 预览</span>
            </div>
            <div className="neo4j-modal-body" style={{ flexDirection: 'column', gap: 12 }}>

              {/* ── 模式选择 ── */}
              <div className="import-mode-toggle">
                <button
                  type="button"
                  className={`import-mode-btn${importMode === 'merge' ? ' active' : ''}`}
                  onClick={() => setImportMode('merge')}
                >
                  增量导入
                </button>
                <button
                  type="button"
                  className={`import-mode-btn${importMode === 'overwrite' ? ' active' : ''}`}
                  onClick={() => setImportMode('overwrite')}
                >
                  覆盖导入
                </button>
              </div>

              {/* ── 模式说明 ── */}
              {importMode === 'overwrite'
                ? <p className="import-modal-warn">⚠️ 覆盖模式将替换当前模型中的全部实体和关系，此操作不可撤销。建议先「导出」备份。</p>
                : <p className="import-modal-info">新实体和关系将追加到当前模型，原有内容保留不变。</p>
              }

              {/* ── 外部 Schema 来源标记 ── */}
              {importPreview.result.meta?.source === 'external-schema' && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 10px' }}>
                  外部 Schema JSON
                  {importPreview.result.meta.domain && ` · 领域：${importPreview.result.meta.domain}`}
                  {importPreview.result.meta.schemaVersion && ` · v${importPreview.result.meta.schemaVersion}`}
                </div>
              )}

              {/* ── 数量摘要 ── */}
              <div className="import-modal-summary">
                {importMode === 'merge' ? (
                  <>
                    <span>✅ 新增实体：{importPreview.mergeNodes.length} 个（{importPreview.mergeNodes.map((n) => n.data.label).slice(0, 4).join('、')}{importPreview.mergeNodes.length > 4 ? '…' : ''}）</span>
                    <span>✅ 新增关系：{importPreview.mergeEdges.length} 条</span>
                  </>
                ) : (
                  <>
                    <span>✅ 实体：{importPreview.result.entities.length} 个（{importPreview.result.entities.map((e) => e.label).slice(0, 4).join('、')}{importPreview.result.entities.length > 4 ? '…' : ''}）</span>
                    <span>✅ 关系：{importPreview.result.relations.length} 条</span>
                  </>
                )}
              </div>

              {/* ── 改名提示（增量模式冲突时） ── */}
              {importMode === 'merge' && importPreview.renamedLabels.size > 0 && (
                <div className="import-modal-renamed">
                  <p>以下实体因名称冲突已自动重命名，导入后可手动调整：</p>
                  {Array.from(importPreview.renamedLabels.entries()).map(([orig, renamed]) => (
                    <span key={orig} className="import-rename-tag">{orig} → {renamed}</span>
                  ))}
                </div>
              )}

              {/* ── 解析错误 ── */}
              {importPreview.result.errors.length > 0 && (
                <div className="import-modal-errors">
                  {importPreview.result.errors.map((err, i) => (
                    <p key={i}>⚠️ {err}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="neo4j-modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" className="btn-ghost" disabled={isImporting} onClick={() => setImportPreview(null)}>取消</button>
              <button type="button" className="btn-primary" disabled={isImporting} onClick={confirmSchemaImport}>
                {isImporting
                  ? <><Loader2 size={12} className="spin" style={{ marginRight: 4 }} />导入中…</>
                  : importMode === 'merge' ? '确认追加' : '确认覆盖'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 帮助说明 Modal ── */}
      {showHelpModal && (
        <div className="neo4j-modal-overlay" onClick={() => setShowHelpModal(false)}>
          <div className="neo4j-modal schema-help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="neo4j-modal-header">
              <HelpCircle size={15} />
              <span>本体导入模板说明</span>
              <button type="button" className="btn-ghost" style={{ marginLeft: 'auto', padding: 4 }} onClick={() => setShowHelpModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="neo4j-modal-body" style={{ padding: 0 }}>
              <pre className="schema-help-content">{SCHEMA_HELP_TEXT}</pre>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
              <button type="button" className="btn-ghost" onClick={generateTemplateXlsx}>
                <Download size={13} style={{ marginRight: 4 }} />下载标准模板
              </button>
              <button type="button" className="btn-primary" onClick={() => setShowHelpModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

/* ─── Canvas Area ────────────────────────────────────────────────────────── */

function CanvasArea() {
  const nodes            = useSchemaStore((s) => s.nodes)
  const edges            = useSchemaStore((s) => s.edges)
  const setNodes         = useSchemaStore((s) => s.setNodes)
  const setEdges         = useSchemaStore((s) => s.setEdges)
  const deleteEntity     = useSchemaStore((s) => s.deleteEntity)
  const deleteRelation   = useSchemaStore((s) => s.deleteRelation)
  const addEntity        = useSchemaStore((s) => s.addEntity)
  const setSelected      = useSchemaStore((s) => s.setSelected)
  const setContextMenu      = useSchemaStore((s) => s.setContextMenu)
  const canvasView          = useSchemaStore((s) => s.canvasView)
  const setCanvasView       = useSchemaStore((s) => s.setCanvasView)
  const showMiniMap         = useSchemaStore((s) => s.showMiniMap)
  const setShowMiniMap      = useSchemaStore((s) => s.setShowMiniMap)
  const globeNodeSize       = useSchemaStore((s) => s.globeNodeSize)
  const setGlobeNodeSize    = useSchemaStore((s) => s.setGlobeNodeSize)
  const pendingPlacement    = useSchemaStore((s) => s.pendingPlacement)
  const setPendingPlacement = useSchemaStore((s) => s.setPendingPlacement)
  const addRelationBetween  = useSchemaStore((s) => s.addRelationBetween)
  const models              = useSchemaStore((s) => s.models)
  const activeModelId       = useSchemaStore((s) => s.activeModelId)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const [schemaView, setSchemaView] = useState<'graph' | 'list' | 'odl'>('graph')

  const activeModel = models.find((m) => m.id === activeModelId)

  // Cancel placement on Escape
  useEffect(() => {
    if (!pendingPlacement) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPendingPlacement(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingPlacement, setPendingPlacement])

  const sourceEntity = pendingPlacement?.kind === 'relation' && pendingPlacement.sourceId
    ? nodes.find((n) => n.id === pendingPlacement.sourceId)
    : null

  const nodeTypes = useMemo(
    () => ({ entity: canvasView === 'detail' ? EntityCard : GlobeNode }),
    [canvasView],
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<EntityNode>[]) => {
      const removals = changes.filter((c) => c.type === 'remove')
      const others = changes.filter((c) => c.type !== 'remove')
      for (const c of removals) deleteEntity(c.id)
      if (others.length) setNodes((cur) => applyNodeChanges(others, cur) as EntityNode[])
    },
    [setNodes, deleteEntity],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RelationEdge>[]) => {
      const removals = changes.filter((c) => c.type === 'remove')
      const others = changes.filter((c) => c.type !== 'remove')
      for (const c of removals) deleteRelation(c.id)
      if (others.length) setEdges((cur) => applyEdgeChanges(others, cur) as RelationEdge[])
    },
    [setEdges, deleteRelation],
  )
  const onConnect = useCallback(
    (connection: Connection) => {
      const id = makeId('rel')
      setEdges((cur) =>
        addEdge(
          { ...connection, id, type: 'relation', markerEnd: { type: MarkerType.ArrowClosed },
            data: { name: 'relatedTo', cardinality: '1:N', description: '', edgeStyle: 'bezier' } },
          cur,
        ) as RelationEdge[],
      )
      setSelected({ kind: 'relation', id })
    },
    [setEdges, setSelected],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: EntityNode) => {
      if (pendingPlacement?.kind === 'relation') {
        if (pendingPlacement.sourceId === null) {
          setPendingPlacement({ ...pendingPlacement, sourceId: node.id })
        } else if (pendingPlacement.sourceId !== node.id) {
          addRelationBetween(pendingPlacement.sourceId, node.id, {
            name: pendingPlacement.presetName,
            relationCategory: pendingPlacement.categoryId,
          })
          setPendingPlacement(null)
        }
        return
      }
      setSelected({ kind: 'entity', id: node.id })
    },
    [pendingPlacement, setPendingPlacement, addRelationBetween, setSelected],
  )

  const onPaneClick = useCallback(
    (e: React.MouseEvent) => {
      if (pendingPlacement?.kind === 'entity') {
        addEntity(screenToFlowPosition({ x: e.clientX, y: e.clientY }), {
          label: pendingPlacement.label,
          color: pendingPlacement.color,
          entityType: pendingPlacement.entityType as EntityType,
          description: pendingPlacement.definition,
        })
        setPendingPlacement(null)
        return
      }
      if (pendingPlacement?.kind === 'relation') return
      if (e.detail === 2) {
        addEntity(screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        return
      }
      setSelected({ kind: 'workspace' })
      setContextMenu(null)
    },
    [pendingPlacement, setPendingPlacement, addEntity, screenToFlowPosition, setSelected, setContextMenu],
  )

  const canvasClass = pendingPlacement
    ? `canvas canvas-placing-${pendingPlacement.kind}${pendingPlacement.kind === 'relation' && pendingPlacement.sourceId ? '-ready' : ''}`
    : 'canvas'

  return (
    <main className="canvas-shell">
      <div className="topbar">
        <div className="workspace-title">
          <strong>{activeModel?.name ?? '未命名模型'}</strong>
          <span>v1.0 · 草稿已自动保存</span>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => addEntity()}>
            <CirclePlus size={16} /> 实体
          </button>
          <button type="button" onClick={() => fitView({ padding: 0.2, duration: 400 })}>
            <LayoutGrid size={16} /> 适配
          </button>
          {canvasView === 'globe' && (
            <label className="globe-size-control" title={`节点大小：${globeNodeSize}px`}>
              <span>节点大小</span>
              <input
                type="range"
                min={36}
                max={100}
                step={2}
                value={globeNodeSize}
                onChange={(e) => setGlobeNodeSize(Number(e.target.value))}
              />
              <span className="globe-size-value">{globeNodeSize}</span>
            </label>
          )}
          <div className="view-toggle">
            <button
              type="button"
              className={schemaView === 'graph' && canvasView === 'detail' ? 'toggle-active' : ''}
              title="详细视图（卡片模式）"
              onClick={() => { setSchemaView('graph'); setCanvasView('detail') }}
            >
              <LayoutDashboard size={15} /> 详细
            </button>
            <button
              type="button"
              className={schemaView === 'graph' && canvasView === 'globe' ? 'toggle-active' : ''}
              title="简洁视图（球体模式）"
              onClick={() => { setSchemaView('graph'); setCanvasView('globe') }}
            >
              <Network size={15} /> 简洁
            </button>
            <button
              type="button"
              className={schemaView === 'list' ? 'toggle-active' : ''}
              title="列表视图"
              onClick={() => setSchemaView(schemaView === 'list' ? 'graph' : 'list')}
            >
              <List size={15} /> 列表
            </button>
            <button
              type="button"
              className={schemaView === 'odl' ? 'toggle-active' : ''}
              title="ODL 知识层"
              onClick={() => setSchemaView(schemaView === 'odl' ? 'graph' : 'odl')}
            >
              <BookOpen size={15} /> ODL
            </button>
          </div>
        </div>
      </div>

      {schemaView === 'list' ? (
        <SchemaListView />
      ) : schemaView === 'odl' ? (
        <OdlEditorView />
      ) : (
      <div className={canvasClass}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={{ relation: RelationEdgeView }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={(_, edge) => setSelected({ kind: 'relation', id: edge.id })}
          onPaneClick={onPaneClick}
          fitView
        >
          <Background gap={18} color="#d8dee8" />
          <Controls />
          {showMiniMap && (
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => (node.data as EntityNode['data']).color}
              {...(canvasView === 'globe'
                ? { nodeComponent: MiniMapGlobeNode }
                : { nodeBorderRadius: 8 }
              )}
            />
          )}
          <Panel position="bottom-right" className="minimap-panel">
            <button
              type="button"
              className={`minimap-toggle-btn ${showMiniMap ? 'minimap-open' : 'minimap-closed'}`}
              onClick={() => setShowMiniMap(!showMiniMap)}
              title={showMiniMap ? '收起小地图' : '展开小地图'}
            >
              {showMiniMap ? <X size={12} /> : <><MapIcon size={13} /><span>小地图</span></>}
            </button>
          </Panel>
          {pendingPlacement && (
            <Panel position="top-center" className="placement-indicator">
              <span>
                {pendingPlacement.kind === 'entity'
                  ? `在画布上点击放置「${pendingPlacement.label}」`
                  : pendingPlacement.sourceId === null
                    ? `点击起始实体（建立「${pendingPlacement.presetLabel}」关系）`
                    : `已选「${sourceEntity?.data.label || sourceEntity?.data.name || '起始实体'}」→ 点击目标实体`
                }
              </span>
              <button type="button" onClick={() => setPendingPlacement(null)}>取消 ESC</button>
            </Panel>
          )}
        </ReactFlow>
      </div>
      )}
    </main>
  )
}

/* ─── Cypher Console ─────────────────────────────────────────────────────── */

const SCHEMA_PRESETS = [
  { label: '实体定义', query: 'MATCH (e:EntityDef) RETURN e.label AS 实体名称, e.entityType AS 分类, e.name AS 英文名 ORDER BY 实体名称' },
  { label: '关系定义', query: 'MATCH (s:EntityDef)-[r:RelDef]->(t:EntityDef) RETURN s.label AS 源实体, r.label AS 关系名称, t.label AS 目标实体' },
  { label: '索引状态', query: 'SHOW INDEXES YIELD labelsOrTypes, properties, state' },
  { label: '全图概览', query: 'MATCH (n) RETURN labels(n) AS 类型, count(n) AS 数量 ORDER BY 数量 DESC' },
]
const GRAPH_PRESETS = [
  { label: '实例统计', query: 'MATCH (n:EntityInstance) RETURN n.entityLabel AS 实体类型, count(n) AS 数量 ORDER BY 数量 DESC' },
  { label: '关系统计', query: 'MATCH ()-[r]->() RETURN type(r) AS 关系类型, count(r) AS 数量 ORDER BY 数量 DESC' },
  { label: '孤立节点', query: 'MATCH (n:EntityInstance) WHERE NOT (n)--() RETURN n.entityLabel AS 实体类型, n.id AS ID LIMIT 20' },
  { label: '近期数据', query: 'MATCH (n:EntityInstance) RETURN n.entityLabel AS 实体类型, n.id AS ID LIMIT 50' },
]

function CypherConsole({ context }: { context: 'schema' | 'graph' }) {
  const presets = context === 'schema' ? SCHEMA_PRESETS : GRAPH_PRESETS
  const [cypher, setCypher] = useState(presets[0].query)
  const [rows, setRows] = useState<unknown[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function runQuery() {
    if (!cypher.trim()) return
    setLoading(true); setError(null)
    try {
      const { rows: r } = await api.runCypherQuery(cypher)
      setRows(r)
      setColumns(r.length > 0 ? Object.keys(r[0] as object) : [])
    } catch (e) { setError(String(e)); setRows(null) }
    finally { setLoading(false) }
  }

  return (
    <div className="cypher-console">
      <div className="cypher-presets">
        {presets.map((p) => (
          <button key={p.label} type="button" className="cypher-preset-chip"
            onClick={() => setCypher(p.query)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="cypher-editor-wrap">
        <textarea
          className="cypher-textarea"
          value={cypher}
          rows={5}
          onChange={(e) => setCypher(e.target.value)}
          placeholder="输入 Cypher 查询语句…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void runQuery() }}
        />
        <div className="cypher-editor-footer">
          <span className="cypher-shortcut">Ctrl+Enter 运行</span>
          <button type="button" className="btn-primary"
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
            disabled={loading} onClick={() => void runQuery()}>
            <Play size={13} /> {loading ? '查询中…' : '运行'}
          </button>
        </div>
      </div>
      {error && <div className="cypher-error">{error}</div>}
      {rows !== null && (
        <div className="cypher-results">
          <div className="cypher-results-meta">
            {rows.length > 0 ? `${rows.length} 条结果` : '查询成功，无结果'}
          </div>
          {rows.length > 0 && (
            <div className="cypher-results-wrap">
              <table className="cypher-results-table">
                <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => {
                        const v = (row as Record<string, unknown>)[c]
                        return <td key={c}>{v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Constraints & Indexes Panel ────────────────────────────────────────── */

function ConstraintsPanel() {
  const nodes                    = useSchemaStore((s) => s.nodes)
  const syncConstraintsAndIndexes = useSchemaStore((s) => s.syncConstraintsAndIndexes)
  const updateEntityProperty     = useSchemaStore((s) => s.updateProperty)

  const [syncing, setSyncing]   = useState(false)
  const [checking, setChecking] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null)
  // Map of "Label.prop" → true when confirmed in Neo4j
  const [neo4jStatus, setNeo4jStatus] = useState<Record<string, 'ok' | 'missing'>>({})

  // Derive constraint/index items from current entity nodes
  const uniqueItems = useMemo(() => {
    const out: { entityId: string; label: string; propId: string; propName: string }[] = []
    for (const n of nodes) {
      if (n.type !== 'entity') continue
      const label = n.data.label || n.data.name
      for (const p of n.data.properties) {
        if (p.unique) out.push({ entityId: n.id, label, propId: p.id, propName: p.name })
      }
    }
    return out
  }, [nodes])

  const indexedItems = useMemo(() => {
    const out: { entityId: string; label: string; propId: string; propName: string }[] = []
    for (const n of nodes) {
      if (n.type !== 'entity') continue
      const label = n.data.label || n.data.name
      for (const p of n.data.properties) {
        if (p.indexed && !p.unique) out.push({ entityId: n.id, label, propId: p.id, propName: p.name })
      }
    }
    return out
  }, [nodes])

  async function handleCheck() {
    setChecking(true)
    setSyncResult(null)
    try {
      const [cRes, iRes] = await Promise.all([
        api.runCypherQuery('SHOW CONSTRAINTS YIELD name, labelsOrTypes, properties'),
        api.runCypherQuery('SHOW INDEXES YIELD name, labelsOrTypes, properties, state'),
      ])
      const status: Record<string, 'ok' | 'missing'> = {}
      const existingConstraints = new Set(
        (cRes.rows as Array<Record<string, unknown>>).map((r) =>
          `${String((r.labelsOrTypes as string[])?.[0] ?? '')}.${String((r.properties as string[])?.[0] ?? '')}`,
        ),
      )
      const existingIndexes = new Set(
        (iRes.rows as Array<Record<string, unknown>>)
          .filter((r) => r.state === 'ONLINE')
          .map((r) =>
            `${String((r.labelsOrTypes as string[])?.[0] ?? '')}.${String((r.properties as string[])?.[0] ?? '')}`,
          ),
      )
      for (const item of uniqueItems) {
        status[`c:${item.label}.${item.propName}`] =
          existingConstraints.has(`${item.label}.${item.propName}`) ? 'ok' : 'missing'
      }
      for (const item of indexedItems) {
        status[`i:${item.label}.${item.propName}`] =
          existingIndexes.has(`${item.label}.${item.propName}`) ? 'ok' : 'missing'
      }
      setNeo4jStatus(status)
    } catch { /* ignore */ }
    finally { setChecking(false) }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    const result = await syncConstraintsAndIndexes()
    setSyncResult(result)
    setSyncing(false)
    // Re-check status after sync
    await handleCheck()
  }

  function removeUniqueFlag(entityId: string, propId: string) {
    updateEntityProperty(entityId, propId, { unique: undefined })
  }
  function removeIndexedFlag(entityId: string, propId: string) {
    updateEntityProperty(entityId, propId, { indexed: undefined })
  }

  const isEmpty = uniqueItems.length === 0 && indexedItems.length === 0

  return (
    <div className="constraints-panel">
      <div className="constraints-panel-toolbar">
        <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
          disabled={checking || isEmpty} onClick={handleCheck}>
          {checking ? <><Loader2 size={12} className="spin" style={{ marginRight: 4 }} />检查中…</> : '检查 Neo4j 状态'}
        </button>
        <button type="button" className="btn-primary" style={{ fontSize: 12 }}
          disabled={syncing || isEmpty} onClick={handleSync}>
          {syncing ? <><Loader2 size={12} className="spin" style={{ marginRight: 4 }} />同步中…</> : '同步到 Neo4j ▶'}
        </button>
      </div>

      {syncResult && (
        <div className={`constraints-sync-result ${syncResult.errors.length > 0 ? 'has-errors' : ''}`}>
          {syncResult.errors.length === 0
            ? `✓ 已同步 ${syncResult.synced} 条`
            : `已同步 ${syncResult.synced} 条，${syncResult.errors.length} 条失败`}
          {syncResult.errors.map((e, i) => <div key={i} style={{ fontSize: 11, marginTop: 2 }}>{e}</div>)}
        </div>
      )}

      {isEmpty ? (
        <div className="constraints-empty">
          暂无约束或索引定义。<br />在实体属性面板中勾选"唯一"或"索引"来添加。
        </div>
      ) : (
        <>
          {uniqueItems.length > 0 && (
            <section className="constraints-section">
              <div className="constraints-section-title">UNIQUE 约束</div>
              {uniqueItems.map((item) => {
                const key = `c:${item.label}.${item.propName}`
                const st  = neo4jStatus[key]
                return (
                  <div key={key} className="constraints-row">
                    <span className="constraints-key">{item.label}<span className="dot">·</span>{item.propName}</span>
                    {st && <span className={`constraints-status ${st}`}>{st === 'ok' ? '✓ 已同步' : '⚠ 未同步'}</span>}
                    <button type="button" className="constraints-remove" title="移除"
                      onClick={() => removeUniqueFlag(item.entityId, item.propId)}>×</button>
                  </div>
                )
              })}
            </section>
          )}
          {indexedItems.length > 0 && (
            <section className="constraints-section">
              <div className="constraints-section-title">INDEX（普通索引）</div>
              {indexedItems.map((item) => {
                const key = `i:${item.label}.${item.propName}`
                const st  = neo4jStatus[key]
                return (
                  <div key={key} className="constraints-row">
                    <span className="constraints-key">{item.label}<span className="dot">·</span>{item.propName}</span>
                    {st && <span className={`constraints-status ${st}`}>{st === 'ok' ? '✓ 已同步' : '⚠ 未同步'}</span>}
                    <button type="button" className="constraints-remove" title="移除"
                      onClick={() => removeIndexedFlag(item.entityId, item.propId)}>×</button>
                  </div>
                )
              })}
            </section>
          )}
        </>
      )}
    </div>
  )
}

/* ─── Schema List View ───────────────────────────────────────────────────── */

function SchemaListView() {
  const nodes            = useSchemaStore((s) => s.nodes)
  const edges            = useSchemaStore((s) => s.edges)
  const setSelected      = useSchemaStore((s) => s.setSelected)
  const setInspectorOpen = useSchemaStore((s) => s.setInspectorOpen)

  const [tab, setTab]         = useState<'entity' | 'relation' | 'cypher' | 'constraints'>('entity')
  const [query, setQuery]     = useState('')
  const [sortKey, setSortKey] = useState('label')
  const [sortAsc, setSortAsc] = useState(true)

  function toggleSort(key: string) {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
  }
  function sortIndicator(key: string) {
    if (sortKey !== key) return null
    return <span style={{ fontSize: 10, marginLeft: 3 }}>{sortAsc ? '↑' : '↓'}</span>
  }

  function pick(id: string, kind: 'entity' | 'relation') {
    setSelected({ kind, id })
    setInspectorOpen(true)
  }

  const q = query.toLowerCase()

  const filteredNodes = nodes
    .filter((n) => !q || n.data.label?.toLowerCase().includes(q) || n.data.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      const va = sortKey === 'propCount'
        ? a.data.properties.length
        : String((a.data as Record<string, unknown>)[sortKey] ?? '')
      const vb = sortKey === 'propCount'
        ? b.data.properties.length
        : String((b.data as Record<string, unknown>)[sortKey] ?? '')
      const cmp = typeof va === 'number'
        ? (va as number) - (vb as number)
        : String(va).localeCompare(String(vb), 'zh-CN')
      return sortAsc ? cmp : -cmp
    })

  const filteredEdges = edges
    .filter((e) => !q
      || (e.data?.label ?? '').toLowerCase().includes(q)
      || (e.data?.name ?? '').toLowerCase().includes(q)
      || nodes.find((n) => n.id === e.source)?.data.label?.toLowerCase().includes(q)
      || nodes.find((n) => n.id === e.target)?.data.label?.toLowerCase().includes(q)
    )
    .slice()
    .sort((a, b) => {
      const va = String(a.data?.label ?? a.data?.name ?? '')
      const vb = String(b.data?.label ?? b.data?.name ?? '')
      return sortAsc ? va.localeCompare(vb, 'zh-CN') : vb.localeCompare(va, 'zh-CN')
    })

  const ENTITY_TYPE_LABELS: Record<string, string> = {
    physical: '物理', abstract: '抽象', event: '事件', role: '角色',
    location: '地点', document: '文档', process: '过程', concept: '概念',
  }
  const REL_CAT_LABELS: Record<string, string> = {
    composition: '组合', association: '关联', dependency: '依赖',
    generalization: '泛化', realization: '实现',
  }

  return (
    <div className="schema-list-view">
      <div className="schema-list-toolbar">
        <input
          className="schema-list-search"
          placeholder="搜索实体 / 关系名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="schema-list-tabs">
          <button type="button" className={tab === 'entity' ? 'active' : ''} onClick={() => setTab('entity')}>
            实体 <span>{filteredNodes.length}</span>
          </button>
          <button type="button" className={tab === 'relation' ? 'active' : ''} onClick={() => setTab('relation')}>
            关系 <span>{filteredEdges.length}</span>
          </button>
          <button type="button" className={tab === 'cypher' ? 'active' : ''} onClick={() => setTab('cypher')}>
            Cypher
          </button>
          <button type="button" className={tab === 'constraints' ? 'active' : ''} onClick={() => setTab('constraints')}>
            约束 & 索引
          </button>
        </div>
      </div>

      {tab === 'entity' && (
        <div className="schema-list-wrap">
          {filteredNodes.length === 0 ? (
            <div className="schema-list-empty">暂无实体{q ? `（无匹配「${query}」的结果）` : ''}</div>
          ) : (
            <table className="schema-list-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th onClick={() => toggleSort('label')}>中文名称{sortIndicator('label')}</th>
                  <th onClick={() => toggleSort('name')}>英文标识{sortIndicator('name')}</th>
                  <th onClick={() => toggleSort('entityType')}>实体类型{sortIndicator('entityType')}</th>
                  <th onClick={() => toggleSort('propCount')} style={{ width: 70, textAlign: 'right' }}>
                    属性数{sortIndicator('propCount')}
                  </th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {filteredNodes.map((n) => (
                  <tr key={n.id} className="schema-list-row" onClick={() => pick(n.id, 'entity')}>
                    <td><span className="entity-color-swatch" style={{ background: n.data.color }} /></td>
                    <td className="schema-list-main">{n.data.label || n.data.name}</td>
                    <td className="schema-list-mono">{n.data.name}</td>
                    <td>{ENTITY_TYPE_LABELS[n.data.entityType ?? ''] ?? n.data.entityType ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{n.data.properties.length}</td>
                    <td>
                      <button
                        type="button"
                        className="schema-list-edit-btn"
                        onClick={(e) => { e.stopPropagation(); pick(n.id, 'entity') }}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'relation' && (
        <div className="schema-list-wrap">
          {filteredEdges.length === 0 ? (
            <div className="schema-list-empty">暂无关系{q ? `（无匹配「${query}」的结果）` : ''}</div>
          ) : (
            <table className="schema-list-table">
              <thead>
                <tr>
                  <th onClick={() => toggleSort('label')}>关系名称{sortIndicator('label')}</th>
                  <th>英文标识</th>
                  <th>源实体</th>
                  <th>目标实体</th>
                  <th>类别</th>
                  <th style={{ width: 56 }} />
                </tr>
              </thead>
              <tbody>
                {filteredEdges.map((e) => {
                  const src = nodes.find((n) => n.id === e.source)
                  const tgt = nodes.find((n) => n.id === e.target)
                  return (
                    <tr key={e.id} className="schema-list-row" onClick={() => pick(e.id, 'relation')}>
                      <td className="schema-list-main">{e.data?.label || e.data?.name || '—'}</td>
                      <td className="schema-list-mono">{e.data?.name ?? '—'}</td>
                      <td>{src?.data.label || src?.data.name || '—'}</td>
                      <td>{tgt?.data.label || tgt?.data.name || '—'}</td>
                      <td>{REL_CAT_LABELS[e.data?.relationCategory ?? ''] ?? e.data?.relationCategory ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="schema-list-edit-btn"
                          onClick={(ev) => { ev.stopPropagation(); pick(e.id, 'relation') }}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'cypher' && <CypherConsole context="schema" />}
      {tab === 'constraints' && <ConstraintsPanel />}
    </div>
  )
}

/* ─── Inspector ──────────────────────────────────────────────────────────── */

function Inspector() {
  const selected        = useSchemaStore((s) => s.selected)
  const nodes           = useSchemaStore((s) => s.nodes)
  const edges           = useSchemaStore((s) => s.edges)
  const updateEntity    = useSchemaStore((s) => s.updateEntity)
  const updateRelation  = useSchemaStore((s) => s.updateRelation)
  const rerouteRelation = useSchemaStore((s) => s.rerouteRelation)
  const addProperty     = useSchemaStore((s) => s.addProperty)
  const updateProperty  = useSchemaStore((s) => s.updateProperty)
  const removeProperty  = useSchemaStore((s) => s.removeProperty)
  const deleteSelected  = useSchemaStore((s) => s.deleteSelected)
  const inspectorOpen   = useSchemaStore((s) => s.inspectorOpen)
  const setInspectorOpen = useSchemaStore((s) => s.setInspectorOpen)

  const [tab, setTab] = useState<'editor' | 'ai'>('editor')
  const [expandedPropId, setExpandedPropId] = useState<string | null>(null)
  const [newEnumVal, setNewEnumVal] = useState('')

  const entity   = selected.kind === 'entity'   ? nodes.find((n) => n.id === selected.id) : undefined
  const relation = selected.kind === 'relation' ? edges.find((e) => e.id === selected.id) : undefined

  if (!inspectorOpen) {
    return (
      <aside className="inspector inspector-collapsed">
        <button
          type="button"
          className="panel-toggle-btn"
          title="展开属性面板"
          onClick={() => setInspectorOpen(true)}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="inspector-collapsed-icons">
          <Settings2 size={18} />
          <Bot size={17} />
          <CheckCircle2 size={17} />
        </div>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <button
          type="button"
          className="panel-toggle-inline panel-toggle-right"
          title="折叠属性面板"
          onClick={() => setInspectorOpen(false)}
        >
          <ChevronRight size={16} />
        </button>
        <div>
          <strong>属性 &amp; AI</strong>
          <span>
            {selected.kind === 'workspace' ? '工作区' : selected.kind === 'entity' ? '实体编辑' : '关系编辑'}
          </span>
        </div>
        <button
          type="button"
          title="删除选中项"
          onClick={deleteSelected}
          disabled={selected.kind === 'workspace'}
          className="danger-btn"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="inspector-tabs">
        <button type="button" className={tab === 'editor' ? 'tab-active' : ''} onClick={() => setTab('editor')}>
          <Settings2 size={14} /> 编辑
        </button>
        <button type="button" className={tab === 'ai' ? 'tab-active' : ''} onClick={() => setTab('ai')}>
          <Bot size={14} /> AI 对话
        </button>
      </div>

      <div className="inspector-body">
        {tab === 'editor' && (
          <div className="editor-tab">
            {entity && (
              <section className="editor-section">
                <div className="section-heading">
                  <div className="entity-color-dot" style={{ background: entity.data.color }} />
                  <span>实体</span>
                  <input
                    type="color"
                    value={entity.data.color}
                    onChange={(e) => updateEntity(entity.id, { color: e.target.value })}
                    className="color-picker"
                    title="更改实体颜色"
                  />
                </div>
                <Field label="中文名称" value={entity.data.label} onChange={(v) => updateEntity(entity.id, { label: v })} />
                <Field label="英文标识符" value={entity.data.name} onChange={(v) => updateEntity(entity.id, { name: v })} />
                <TextArea label="描述" value={entity.data.description} onChange={(v) => updateEntity(entity.id, { description: v })} />
                <label className="field">
                  <span>实体类型</span>
                  <select
                    value={entity.data.entityType ?? ''}
                    onChange={(e) => updateEntity(entity.id, { entityType: (e.target.value as EntityType) || undefined })}
                  >
                    <option value="">未分类</option>
                    {ENTITY_CATEGORIES.map((cat) => (
                      <optgroup key={cat.id} label={`${cat.label}（${cat.name}）`}>
                        {cat.subtypes.map((sub) => (
                          <option key={sub.id} value={sub.id}>{sub.label} · {sub.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <div className="property-editor-header">
                  <span>属性列表（{entity.data.properties.length}）</span>
                  <button type="button" onClick={() => addProperty(entity.id)}>
                    <Plus size={14} /> 添加
                  </button>
                </div>
                {/* Column hints */}
                <div className="prop-col-hints">
                  <span>中文名称</span><span>英文别名</span><span>类型</span><span>必填</span><span /><span />
                </div>
                <div className="property-editor">
                  {entity.data.properties.map((p) => {
                    const isExpanded = expandedPropId === p.id
                    const c = p.constraints ?? {}
                    const hasExtra = (
                      Boolean(p.unique) || Boolean(p.indexed) ||
                      (p.type === 'enum' && (c.enumValues?.length ?? 0) > 0) ||
                      (p.type === 'number' && (c.min !== undefined || c.max !== undefined)) ||
                      (p.type === 'string' && (c.minLength !== undefined || c.maxLength !== undefined || c.pattern)) ||
                      (p.type === 'date' && (c.minDate || c.maxDate))
                    )
                    const patchC = (patch: Partial<PropertyConstraints>) =>
                      updateProperty(entity.id, p.id, { constraints: { ...c, ...patch } })
                    return (
                      <div className="property-item" key={p.id}>
                        <div className="property-editor-row">
                          <input
                            value={p.nameZh ?? ''}
                            onChange={(e) => updateProperty(entity.id, p.id, { nameZh: e.target.value })}
                            placeholder="中文名称"
                          />
                          <input
                            value={p.name}
                            onChange={(e) => updateProperty(entity.id, p.id, { name: e.target.value })}
                            placeholder="英文别名"
                          />
                          <select
                            value={p.type}
                            onChange={(e) => updateProperty(entity.id, p.id, { type: e.target.value as PropertyType })}
                          >
                            <option value="string">字符串</option>
                            <option value="number">数值</option>
                            <option value="date">日期</option>
                            <option value="boolean">布尔</option>
                            <option value="enum">枚举</option>
                            <option value="reference">引用</option>
                          </select>
                          <label className="checkbox-label" title="必填">
                            <input
                              type="checkbox"
                              checked={p.required}
                              onChange={(e) => updateProperty(entity.id, p.id, { required: e.target.checked })}
                            />
                            必填
                          </label>
                          <button type="button" title="删除" onClick={() => removeProperty(entity.id, p.id)}>
                            <Trash2 size={13} />
                          </button>
                          <button
                            type="button"
                            title={isExpanded ? '收起详情' : '展开（唯一/索引/约束）'}
                            className={`prop-constraint-toggle${hasExtra ? ' has-constraints' : ''}`}
                            onClick={() => { setExpandedPropId(isExpanded ? null : p.id); setNewEnumVal('') }}
                          >
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="prop-constraints-row">
                            {/* 唯一 / 索引（Neo4j 级别） */}
                            <div className="prop-db-flags">
                              <label className="checkbox-label prop-flag-unique" title="建立 UNIQUE 约束">
                                <input
                                  type="checkbox"
                                  checked={Boolean(p.unique)}
                                  onChange={(e) => updateProperty(entity.id, p.id, { unique: e.target.checked || undefined, indexed: e.target.checked ? undefined : p.indexed })}
                                />
                                唯一约束
                              </label>
                              <label className="checkbox-label prop-flag-index" title="建立普通 INDEX">
                                <input
                                  type="checkbox"
                                  checked={Boolean(p.indexed)}
                                  disabled={Boolean(p.unique)}
                                  onChange={(e) => updateProperty(entity.id, p.id, { indexed: e.target.checked || undefined })}
                                />
                                普通索引
                              </label>
                            </div>
                            {/* 值域约束（按类型） */}
                            {p.type === 'enum' ? (
                              <div className="prop-constraints-section">
                                <div className="prop-constraints-label">枚举值 <span className="prop-constraints-hint">（导入时值必须为以下之一）</span></div>
                                <div className="prop-enum-tags">
                                  {(c.enumValues ?? []).map((v) => (
                                    <span key={v} className="prop-enum-tag">
                                      {v}
                                      <button type="button" onClick={() => patchC({ enumValues: (c.enumValues ?? []).filter((x) => x !== v) })}>
                                        <X size={10} />
                                      </button>
                                    </span>
                                  ))}
                                  <input
                                    className="prop-enum-add"
                                    placeholder="输入后回车添加"
                                    value={newEnumVal}
                                    onChange={(e) => setNewEnumVal(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault()
                                        const v = newEnumVal.trim()
                                        if (v && !(c.enumValues ?? []).includes(v)) {
                                          patchC({ enumValues: [...(c.enumValues ?? []), v] })
                                        }
                                        setNewEnumVal('')
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            ) : p.type === 'number' ? (
                              <div className="prop-constraints-section">
                                <div className="prop-constraints-label">取值范围</div>
                                <div className="prop-constraint-fields">
                                  <label>最小值<input type="number" placeholder="不限" value={c.min ?? ''} onChange={(e) => patchC({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                  <label>最大值<input type="number" placeholder="不限" value={c.max ?? ''} onChange={(e) => patchC({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                </div>
                              </div>
                            ) : p.type === 'string' ? (
                              <div className="prop-constraints-section">
                                <div className="prop-constraints-label">格式约束</div>
                                <div className="prop-constraint-fields">
                                  <label>最短<input type="number" min={0} placeholder="不限" value={c.minLength ?? ''} onChange={(e) => patchC({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                  <label>最长<input type="number" min={0} placeholder="不限" value={c.maxLength ?? ''} onChange={(e) => patchC({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                                  <label className="prop-constraint-pattern">正则<input placeholder="如 ^[A-Z]+" value={c.pattern ?? ''} onChange={(e) => patchC({ pattern: e.target.value || undefined })} /></label>
                                </div>
                              </div>
                            ) : p.type === 'date' ? (
                              <div className="prop-constraints-section">
                                <div className="prop-constraints-label">日期范围</div>
                                <div className="prop-constraint-fields">
                                  <label>最早<input type="date" value={c.minDate ?? ''} onChange={(e) => patchC({ minDate: e.target.value || undefined })} /></label>
                                  <label>最晚<input type="date" value={c.maxDate ?? ''} onChange={(e) => patchC({ maxDate: e.target.value || undefined })} /></label>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {entity.data.entityType && (() => {
                  const def = findEntitySubtype(entity.data.entityType)
                  return def ? (
                    <div className="type-definition">
                      <div className="type-def-title">
                        <span className="type-def-dot" style={{ background: def.color }} />
                        <strong>{def.label}</strong>
                        <small>{def.name}</small>
                      </div>
                      <p>{def.definition}</p>
                    </div>
                  ) : null
                })()}
              </section>
            )}

            {relation && (
              <section className="editor-section">
                <div className="section-heading"><Link2 size={15} /><span>关系</span></div>
                <Field label="关系名称" value={relation.data?.label ?? ''} onChange={(v) => updateRelation(relation.id, { label: v })} />
                <Field label="英文别名" value={relation.data?.name ?? ''} onChange={(v) => updateRelation(relation.id, { name: v })} />
                <label className="field">
                  <span>源实体</span>
                  <select
                    value={relation.source}
                    onChange={(e) => rerouteRelation(relation.id, e.target.value, relation.target)}
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.data.label || n.data.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>目标实体</span>
                  <select
                    value={relation.target}
                    onChange={(e) => rerouteRelation(relation.id, relation.source, e.target.value)}
                  >
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.data.label || n.data.name}</option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>线条样式</span>
                  <div className="edge-style-selector">
                    {([
                      { key: 'bezier',   label: '曲线', icon: '∿' },
                      { key: 'step',     label: '折线', icon: '⌐' },
                      { key: 'straight', label: '直线', icon: '—' },
                    ] as { key: EdgeStyle; label: string; icon: string }[]).map(({ key, label, icon }) => (
                      <button
                        key={key}
                        type="button"
                        className={`edge-style-btn ${(relation.data?.edgeStyle ?? 'bezier') === key ? 'edge-style-active' : ''}`}
                        onClick={() => updateRelation(relation.id, { edgeStyle: key })}
                        title={label}
                      >
                        <span className="edge-style-icon">{icon}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>关系分类（一级）</span>
                  <select
                    value={relation.data?.relationCategory ?? ''}
                    onChange={(e) => {
                      const cat = (e.target.value as RelationCategoryId) || undefined
                      updateRelation(relation.id, { relationCategory: cat, relationType: undefined })
                    }}
                  >
                    <option value="">未分类</option>
                    {RELATION_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.label} · {cat.name}</option>
                    ))}
                  </select>
                </label>
                {relation.data?.relationCategory && (() => {
                  const catDef = findRelationCategory(relation.data.relationCategory)
                  if (!catDef || catDef.presets.length === 0) return null
                  return (
                    <label className="field">
                      <span>关系类型（二级）</span>
                      <select
                        value={relation.data?.relationType ?? ''}
                        onChange={(e) => updateRelation(relation.id, { relationType: e.target.value || undefined })}
                      >
                        <option value="">— 不指定 —</option>
                        {catDef.presets.map((p) => (
                          <option key={p.name} value={p.name}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                })()}
                <TextArea label="描述" value={relation.data?.description ?? ''} onChange={(v) => updateRelation(relation.id, { description: v })} />
                <div className="inspector-section-title" style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>实例外键映射（用于自动建立实例关系）</div>
                {(() => {
                  const srcNode = nodes.find((n) => n.id === relation.source) as EntityNode | undefined
                  const tgtNode = nodes.find((n) => n.id === relation.target) as EntityNode | undefined
                  const srcProps = srcNode?.data?.properties ?? []
                  const tgtProps = tgtNode?.data?.properties ?? []
                  return (
                    <>
                      <label className="field">
                        <span>源实体字段（sourceKey）</span>
                        {srcProps.length > 0 ? (
                          <select
                            value={relation.data?.sourceKey ?? ''}
                            onChange={(e) => updateRelation(relation.id, { sourceKey: e.target.value || undefined })}
                          >
                            <option value="">— 不配置 —</option>
                            {srcProps.map((p) => (
                              <option key={p.id} value={p.name}>
                                {p.nameZh ? `${p.nameZh}（${p.name}）` : p.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <small style={{ color: 'var(--text-muted)', display: 'block', padding: '4px 0' }}>
                            源实体暂无属性，请先在实体面板添加属性
                          </small>
                        )}
                      </label>
                      <label className="field">
                        <span>目标实体字段（targetKey）</span>
                        {tgtProps.length > 0 ? (
                          <select
                            value={relation.data?.targetKey ?? ''}
                            onChange={(e) => updateRelation(relation.id, { targetKey: e.target.value || undefined })}
                          >
                            <option value="">— 不配置 —</option>
                            {tgtProps.map((p) => (
                              <option key={p.id} value={p.name}>
                                {p.nameZh ? `${p.nameZh}（${p.name}）` : p.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <small style={{ color: 'var(--text-muted)', display: 'block', padding: '4px 0' }}>
                            目标实体暂无属性，请先在实体面板添加属性
                          </small>
                        )}
                      </label>
                    </>
                  )
                })()}
                {relation.data?.relationCategory && (() => {
                  const def = findRelationCategory(relation.data?.relationCategory)
                  return def ? (
                    <div className="type-definition">
                      <div className="type-def-title">
                        <strong>{def.label}</strong>
                        <small>{def.name}</small>
                      </div>
                      <p>{def.definition}</p>
                    </div>
                  ) : null
                })()}
                {relation.data?.midpoint && (
                  <button
                    type="button"
                    className="rel-reset-bend"
                    onClick={() => updateRelation(relation.id, { midpoint: undefined })}
                  >
                    重置弯曲
                  </button>
                )}
              </section>
            )}

            {selected.kind === 'workspace' && (
              <section className="editor-section empty-state">
                <Settings2 size={18} />
                <strong>选择实体或关系开始编辑</strong>
                <p>双击画布创建实体，或右键已有实体查看快捷操作。拖拽实体右侧连接点建立关系。</p>
              </section>
            )}
          </div>
        )}

        {tab === 'ai' && <AiChatPanel nodes={nodes} edges={edges} />}
      </div>
    </aside>
  )
}

/* ─── LLM Service Section (Model Factory) ───────────────────────────────── */

const PROVIDER_PRESETS = {
  anthropic: {
    provider: 'anthropic' as AiProvider, baseUrl: '', model: 'claude-sonnet-4-6', label: 'Anthropic',
    hint: '可用模型：claude-sonnet-4-6 / claude-opus-4-8 / claude-haiku-4-5', isLocal: false,
  },
  openai: {
    provider: 'openai-compat' as AiProvider, baseUrl: '', model: 'gpt-4o', label: 'OpenAI',
    hint: '可用模型：gpt-4o / gpt-4-turbo / gpt-3.5-turbo', isLocal: false,
  },
  deepseek: {
    provider: 'openai-compat' as AiProvider, baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', label: 'DeepSeek',
    hint: '模型名填 deepseek-chat（V3）或 deepseek-reasoner（R1）。Base URL 固定为 https://api.deepseek.com，不要加 /v1', isLocal: false,
  },
  zhipu: {
    provider: 'openai-compat' as AiProvider, baseUrl: 'https://open.bigmodel.cn/api/paas', model: 'glm-4', label: '智谱 GLM',
    hint: '可用模型：glm-4 / glm-4-flash / glm-4v', isLocal: false,
  },
  ollama: {
    provider: 'openai-compat' as AiProvider, baseUrl: 'http://localhost:11434', model: 'qwen2.5', label: 'Ollama',
    hint: '本地部署，无需 API Key。确保 Ollama 已运行（ollama serve）。', isLocal: true,
  },
  lmstudio: {
    provider: 'openai-compat' as AiProvider, baseUrl: 'http://localhost:1234', model: '', label: 'LM Studio',
    hint: '本地部署，无需 API Key。确保 LM Studio 已启动 Local Server 并加载模型。', isLocal: true,
  },
  custom: {
    provider: 'openai-compat' as AiProvider, baseUrl: '', model: '', label: '自定义',
    hint: '兼容 OpenAI 格式的第三方服务，手动填写 Base URL（不含 /v1）和模型名。', isLocal: false,
  },
} as const

type PresetKey = keyof typeof PROVIDER_PRESETS
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

const CLOUD_PRESET_KEYS: PresetKey[] = ['anthropic', 'openai', 'deepseek', 'zhipu', 'custom']
const LOCAL_PRESET_KEYS: PresetKey[] = []

const LOCAL_FRAMEWORK_PRESETS = {
  ollama:   { label: 'Ollama',     defaultPort: 11434, modelHint: 'ollama list 查看已下载模型，如 qwen2.5 / llama3' },
  lmstudio: { label: 'LM Studio',  defaultPort: 1234,  modelHint: '在 LM Studio 界面查看已加载模型名称' },
  vllm:     { label: 'vLLM',       defaultPort: 8000,  modelHint: '与 vllm serve 启动时 --model 参数一致' },
  llamacpp: { label: 'llama.cpp',  defaultPort: 8080,  modelHint: '见启动参数 -m 指定的模型文件名（去掉路径和后缀）' },
  localai:  { label: 'LocalAI',    defaultPort: 8080,  modelHint: '见 LocalAI 的 models/ 目录中的文件名' },
  custom:   { label: '自定义框架', defaultPort: 11434, modelHint: '填写实际监听端口和模型名' },
} as const

type LocalFrameworkKey = keyof typeof LOCAL_FRAMEWORK_PRESETS

/* 判断是否为自定义本地服务（http://localhost 或 http://127.0.0.1） */
function isCustomLocalService(svc: AiServiceConfig): boolean {
  return svc.baseUrl.startsWith('http://localhost') || svc.baseUrl.startsWith('http://127.0.0.1')
}

/* 从 baseUrl 反解 host 和 port */
function parseHostPort(baseUrl: string): { host: string; port: string } {
  try {
    const u = new URL(baseUrl)
    return { host: u.hostname, port: u.port || '80' }
  } catch {
    return { host: 'localhost', port: '11434' }
  }
}

/* 根据 provider+baseUrl 找已保存的服务（custom 永远返回 undefined） */
function findSavedService(services: AiServiceConfig[], key: PresetKey): AiServiceConfig | undefined {
  if (key === 'custom') return undefined
  const p = PROVIDER_PRESETS[key]
  return services.find((s) => s.provider === p.provider && s.baseUrl === p.baseUrl)
}

type ActiveForm =
  | { kind: 'preset'; key: PresetKey }
  | { kind: 'local-new' }
  | { kind: 'local-edit'; svc: AiServiceConfig }
  | null

function LLMServiceSection() {
  const aiServices         = useSchemaStore((s) => s.aiServices)
  const activeAiServiceId  = useSchemaStore((s) => s.activeAiServiceId)
  const addAiService       = useSchemaStore((s) => s.addAiService)
  const updateAiService    = useSchemaStore((s) => s.updateAiService)
  const deleteAiService    = useSchemaStore((s) => s.deleteAiService)
  const setActiveAiService = useSchemaStore((s) => s.setActiveAiService)

  const [activeForm, setActiveForm] = useState<ActiveForm>(null)

  /* 表单字段（云端和本地共享） */
  const [fname,      setFname]      = useState('')
  const [fbaseUrl,   setFbaseUrl]   = useState('')
  const [fmodel,     setFmodel]     = useState('')
  const [fapiKey,    setFapiKey]    = useState('')
  const [fprovider,  setFprovider]  = useState<AiProvider>('anthropic')
  /* 本地专用字段 */
  const [fhost,      setFhost]      = useState('localhost')
  const [fport,      setFport]      = useState('11434')
  const [fframework, setFframework] = useState<LocalFrameworkKey>('ollama')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg,    setTestMsg]    = useState('')

  /* 当前表单对应的已保存服务 */
  const savedSvc = useMemo(() => {
    if (!activeForm || activeForm.kind !== 'preset') return undefined
    return findSavedService(aiServices, activeForm.key)
  }, [aiServices, activeForm])

  const formSvcId = activeForm?.kind === 'local-edit' ? activeForm.svc.id : savedSvc?.id
  const isInUse   = !!formSvcId && formSvcId === activeAiServiceId

  /* 已保存的自定义本地服务 */
  const customLocalSvcs = useMemo(() => aiServices.filter(isCustomLocalService), [aiServices])

  /* 点击云端预设卡 */
  const selectPresetCard = useCallback((key: PresetKey) => {
    const p = PROVIDER_PRESETS[key]
    const existing = findSavedService(aiServices, key)
    setActiveForm({ kind: 'preset', key })
    setFprovider(p.provider)
    setFbaseUrl(existing?.baseUrl ?? p.baseUrl)
    setFmodel(existing?.model   ?? p.model)
    setFapiKey(existing?.apiKey ?? '')
    setFname(existing?.name     ?? p.label)
    setTestStatus('idle'); setTestMsg('')
  }, [aiServices])

  /* 点击「＋ 添加本地模型」 */
  const openLocalNew = useCallback(() => {
    setActiveForm({ kind: 'local-new' })
    setFframework('ollama')
    setFhost('localhost')
    setFport('11434')
    setFmodel('')
    setFapiKey('')
    setFname('Ollama')
    setFprovider('openai-compat')
    setTestStatus('idle'); setTestMsg('')
  }, [])

  /* 点击自定义本地服务卡（编辑） */
  const openLocalEdit = useCallback((svc: AiServiceConfig) => {
    const { host, port } = parseHostPort(svc.baseUrl)
    const fk = (Object.entries(LOCAL_FRAMEWORK_PRESETS) as [LocalFrameworkKey, { defaultPort: number }][])
      .find(([, f]) => f.defaultPort === parseInt(port))?.[0] ?? 'custom'
    setActiveForm({ kind: 'local-edit', svc })
    setFframework(fk)
    setFhost(host)
    setFport(port)
    setFmodel(svc.model)
    setFapiKey(svc.apiKey)
    setFname(svc.name)
    setFprovider('openai-compat')
    setTestStatus('idle'); setTestMsg('')
  }, [])

  /* 切换本地框架 → 更新默认端口和名称 */
  const changeFramework = useCallback((key: LocalFrameworkKey) => {
    const f = LOCAL_FRAMEWORK_PRESETS[key]
    setFframework(key)
    setFport(String(f.defaultPort))
    setFname(f.label)
  }, [])

  /* 保存 */
  const handleSave = useCallback(() => {
    if (!fname.trim()) return
    const isLocalForm = activeForm?.kind === 'local-new' || activeForm?.kind === 'local-edit'
    const computedUrl = isLocalForm ? `http://${fhost.trim()}:${fport.trim()}` : fbaseUrl
    const cfg = { name: fname.trim(), provider: fprovider, baseUrl: computedUrl, model: fmodel, apiKey: fapiKey }
    if (activeForm?.kind === 'preset' && savedSvc) {
      updateAiService(savedSvc.id, cfg)
    } else if (activeForm?.kind === 'local-edit') {
      updateAiService(activeForm.svc.id, cfg)
    } else {
      addAiService(cfg)
      setActiveForm(null)
    }
  }, [fname, fprovider, fbaseUrl, fhost, fport, fmodel, fapiKey, activeForm, savedSvc, updateAiService, addAiService])

  /* 测试连接（走后端代理，避免 CORS 并提供模型名校验） */
  const handleTest = useCallback(async () => {
    setTestStatus('testing'); setTestMsg('')
    const isLocalForm = activeForm?.kind === 'local-new' || activeForm?.kind === 'local-edit'
    const testBase = isLocalForm ? `http://${fhost.trim()}:${fport.trim()}` : (fbaseUrl || null)
    try {
      const resp = await fetch('/api/ai/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: fprovider,
          baseUrl: testBase,
          model: fmodel.trim(),
          apiKey: fapiKey.trim(),
        }),
      })
      const result = await resp.json() as { ok: boolean; msg: string }
      if (result.ok) {
        setTestStatus('ok'); setTestMsg(result.msg)
      } else {
        setTestStatus('fail'); setTestMsg(result.msg)
      }
    } catch (e) {
      setTestStatus('fail'); setTestMsg(e instanceof Error ? e.message : '连接失败')
    }
  }, [fprovider, fapiKey, fbaseUrl, fhost, fport, fmodel, activeForm])

  const preset       = activeForm?.kind === 'preset' ? PROVIDER_PRESETS[activeForm.key] : null
  const isLocalForm  = activeForm?.kind === 'local-new' || activeForm?.kind === 'local-edit'
  const frameworkHint = isLocalForm ? LOCAL_FRAMEWORK_PRESETS[fframework].modelHint : ''

  return (
    <div className="factory-section llm-factory-section">
      <div className="factory-section-title">
        <Bot size={16} />
        <span>大模型服务</span>
      </div>

      {/* ── 上段：服务商卡片区（分云端 / 本地两行） ── */}
      <div className="provider-picker">
        <div className="provider-section-label">云端服务</div>
        <div className="provider-card-grid">
          {CLOUD_PRESET_KEYS.map((key) => {
            const p   = PROVIDER_PRESETS[key]
            const svc = findSavedService(aiServices, key)
            const inUse      = svc?.id === activeAiServiceId
            const configured = !!svc
            const isSelected = activeForm?.kind === 'preset' && activeForm.key === key
            return (
              <button key={key} type="button"
                className={`provider-card${isSelected ? ' provider-card-active' : ''}${inUse ? ' provider-card-inuse' : ''}`}
                onClick={() => selectPresetCard(key)}>
                <span className="provider-card-label">{p.label}</span>
                {inUse           && <span className="card-status card-inuse">使用中</span>}
                {!inUse && configured && <span className="card-status card-configured">已配置</span>}
              </button>
            )
          })}
        </div>

        <div className="provider-section-label" style={{ marginTop: 10 }}>本地部署</div>
        <div className="provider-card-grid">
          {LOCAL_PRESET_KEYS.map((key) => {
            const p   = PROVIDER_PRESETS[key]
            const svc = findSavedService(aiServices, key)
            const inUse      = svc?.id === activeAiServiceId
            const configured = !!svc
            const isSelected = activeForm?.kind === 'preset' && activeForm.key === key
            return (
              <button key={key} type="button"
                className={`provider-card${isSelected ? ' provider-card-active' : ''}${inUse ? ' provider-card-inuse' : ''}`}
                onClick={() => selectPresetCard(key)}>
                <span className="provider-card-label">{p.label}</span>
                {inUse           && <span className="card-status card-inuse">使用中</span>}
                {!inUse && configured && <span className="card-status card-configured">已配置</span>}
              </button>
            )
          })}
          {customLocalSvcs.map((svc) => {
            const inUse = svc.id === activeAiServiceId
            const isSelected = activeForm?.kind === 'local-edit' && activeForm.svc.id === svc.id
            return (
              <button key={svc.id} type="button"
                className={`provider-card${isSelected ? ' provider-card-active' : ''}${inUse ? ' provider-card-inuse' : ''}`}
                onClick={() => openLocalEdit(svc)}>
                <span className="provider-card-label">{svc.name}</span>
                {inUse ? <span className="card-status card-inuse">使用中</span>
                       : <span className="card-status card-configured">已配置</span>}
              </button>
            )
          })}
          <button type="button"
            className={`provider-card provider-add-local-btn${activeForm?.kind === 'local-new' ? ' provider-card-active' : ''}`}
            onClick={openLocalNew}>
            <Plus size={13} />
            <span className="provider-card-label">添加本地模型</span>
          </button>
        </div>
      </div>

      {/* ── 下段：配置表单 ── */}
      {activeForm ? (
        <div className="llm-config-form">
          <div className="llm-config-form-header">
            <span className="llm-config-form-title">
              {activeForm.kind === 'local-new'  && '新增本地大模型'}
              {activeForm.kind === 'local-edit' && `编辑：${activeForm.svc.name}`}
              {activeForm.kind === 'preset'     && (savedSvc ? `编辑：${savedSvc.name}` : `新增 ${preset?.label} 配置`)}
            </span>
            <div className="llm-header-right">
              {formSvcId && !isInUse && (
                <button type="button" className="llm-set-active-btn"
                  onClick={() => setActiveAiService(formSvcId)}>
                  设为使用
                </button>
              )}
              {isInUse && <span className="llm-inuse-badge">● 当前使用</span>}
              {formSvcId && (
                <button type="button" className="llm-delete-icon-btn" title="删除此配置"
                  onClick={() => {
                    if (window.confirm('确认删除此配置？')) {
                      deleteAiService(formSvcId)
                      setActiveForm(null)
                    }
                  }}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* 本地专属：框架选择 + Host / Port */}
          {isLocalForm && (
            <>
              <label className="cfg-field">
                <span>运行框架</span>
                <select className="local-framework-select" value={fframework}
                  onChange={(e) => changeFramework(e.target.value as LocalFrameworkKey)}>
                  {(Object.keys(LOCAL_FRAMEWORK_PRESETS) as LocalFrameworkKey[]).map((k) => (
                    <option key={k} value={k}>{LOCAL_FRAMEWORK_PRESETS[k].label}</option>
                  ))}
                </select>
              </label>
              <div className="local-host-port-row">
                <label className="cfg-field local-host-field">
                  <span>Host</span>
                  <input value={fhost} onChange={(e) => setFhost(e.target.value)} placeholder="localhost" />
                </label>
                <label className="cfg-field local-port-field">
                  <span>Port</span>
                  <input type="number" value={fport} onChange={(e) => setFport(e.target.value)} placeholder="11434" />
                </label>
              </div>
              <p className="cfg-hint local-url-preview">
                连接地址：http://{fhost || 'localhost'}:{fport || '11434'}/v1/chat/completions
              </p>
            </>
          )}

          {/* 云端专属：Base URL */}
          {!isLocalForm && fprovider === 'openai-compat' && (
            <label className="cfg-field">
              <span>Base URL（不含 /v1，留空则用 OpenAI 官方）</span>
              <input value={fbaseUrl} onChange={(e) => setFbaseUrl(e.target.value)}
                placeholder={activeForm.kind === 'preset' ? (PROVIDER_PRESETS[activeForm.key].baseUrl || 'https://api.example.com') : ''} />
            </label>
          )}

          <label className="cfg-field">
            <span>服务名称</span>
            <input value={fname} onChange={(e) => setFname(e.target.value)} placeholder="给此配置取个名字…" />
          </label>

          <label className="cfg-field">
            <span>模型名称</span>
            <input value={fmodel} onChange={(e) => setFmodel(e.target.value)}
              placeholder={isLocalForm ? (frameworkHint || '模型名称…') : (fprovider === 'anthropic' ? 'claude-sonnet-4-6' : 'deepseek-chat / gpt-4o / …')} />
          </label>

          {isLocalForm && frameworkHint && <p className="cfg-hint">{frameworkHint}</p>}

          <label className="cfg-field">
            <span>API Key{isLocalForm ? '（本地通常无需，可留空）' : ''}</span>
            <input type="password" value={fapiKey} onChange={(e) => setFapiKey(e.target.value)}
              placeholder={isLocalForm ? '留空即可' : 'sk-…'} />
          </label>

          {!isLocalForm && preset?.hint && <p className="cfg-hint">{preset.hint}</p>}

          <div className="llm-form-actions">
            <button type="button" className="cfg-save-btn" disabled={!fname.trim()} onClick={handleSave}>
              {(activeForm.kind === 'preset' && savedSvc) || activeForm.kind === 'local-edit'
                ? '保存修改' : '保存配置'}
            </button>
            <button type="button" className="test-conn-btn"
              disabled={testStatus === 'testing'} onClick={handleTest}>
              {testStatus === 'testing' ? '测试中…' : '测试连接'}
            </button>
          </div>

          {testStatus === 'ok'   && <p className="test-result test-ok">✓ {testMsg}</p>}
          {testStatus === 'fail' && <p className="test-result test-fail">✗ {testMsg}</p>}
        </div>
      ) : (
        <p className="factory-empty">点击上方任意服务商卡片，在此处填写配置后保存。</p>
      )}
    </div>
  )
}

/* ─── Model Factory View ─────────────────────────────────────────────────── */

const GRAPH_ALGOS = [
  { name: '图神经网络 GNN',  tag: '节点分类', desc: '基于图结构学习节点表示，用于实体分类与预测' },
  { name: '图嵌入 Node2Vec', tag: '图嵌入',   desc: '随机游走生成节点向量，支持相似度搜索' },
  { name: '社区发现 Louvain',tag: '聚类分析', desc: '模块度优化算法，识别本体中的实体簇' },
  { name: '链接预测 RotatE', tag: '知识图谱', desc: '关系路径补全，发现缺失的实体关系' },
  { name: 'PageRank 重要度', tag: '路径分析', desc: '识别本体图中核心实体节点' },
  { name: '图同构检测',      tag: '结构分析', desc: '检测子图相似性，辅助本体合并与对齐' },
]

function GraphAlgoSection() {
  return (
    <div className="factory-section">
      <div className="factory-section-title">
        <Network size={16} />
        <span>专家模型</span>
      </div>
      <div className="algo-grid">
        {GRAPH_ALGOS.map((algo) => (
          <div key={algo.name} className="algo-card">
            <div className="algo-card-header">
              <span className="algo-name">{algo.name}</span>
              <span className="algo-tag">{algo.tag}</span>
            </div>
            <p className="algo-desc">{algo.desc}</p>
            <span className="algo-coming-soon">即将上线</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Skill Library ──────────────────────────────────────────────────────── */

const CATEGORY_LABELS: Record<string, string> = {
  'ontology':    '本体设计',
  'graph-query': '图谱查询',
  'data-import': '数据导入',
  'cypher-gen':  'Cypher 生成',
  'reasoning':   '知识推理',
  'monitoring':  '监控告警',
}

const BLANK_SKILL: Omit<Skill, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'> = {
  name: '', description: '', category: 'graph-query', skillType: 'tool',
  systemPrompt: '', cypherRead: '', cypherWrite: '', outputSchema: '',
  toolName: '', toolDescription: '', toolInputSchema: null, cypherExecution: '',
  enabled: true, version: '1.0.0',
}

function SkillEditorModal({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const isNew = !skill
  const saveSkill = useSaveSkill()

  const [form, setForm] = useState<Omit<Skill, 'id' | 'isBuiltIn' | 'createdAt' | 'updatedAt'>>(
    skill ? {
      name: skill.name, description: skill.description, category: skill.category,
      skillType: skill.skillType, systemPrompt: skill.systemPrompt,
      cypherRead: skill.cypherRead, cypherWrite: skill.cypherWrite,
      outputSchema: skill.outputSchema, toolName: skill.toolName,
      toolDescription: skill.toolDescription,
      toolInputSchema: skill.toolInputSchema,
      cypherExecution: skill.cypherExecution, enabled: skill.enabled, version: skill.version,
    } : { ...BLANK_SKILL },
  )

  const [schemaText, setSchemaText] = useState(
    form.toolInputSchema ? JSON.stringify(form.toolInputSchema, null, 2) : '',
  )
  const [schemaError, setSchemaError] = useState('')

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  function handleSave() {
    let parsedSchema: Record<string, unknown> | null = null
    if (form.skillType === 'tool' && schemaText.trim()) {
      try { parsedSchema = JSON.parse(schemaText) }
      catch { setSchemaError('JSON 格式错误'); return }
    }
    setSchemaError('')
    const payload = { ...form, toolInputSchema: parsedSchema, id: skill?.id }
    saveSkill.mutate(payload as Skill, { onSuccess: onClose })
  }

  return (
    <div className="skill-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="skill-modal">
        <div className="skill-modal-header">
          <strong>{isNew ? '新建技能' : `编辑：${skill?.name}`}</strong>
          <button type="button" className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="skill-modal-body">
          {/* 基本信息 */}
          <div className="skill-field-group">
            <label className="skill-field">
              <span>名称</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="技能名称" />
            </label>
            <label className="skill-field">
              <span>描述</span>
              <textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="技能功能描述" />
            </label>
            <div className="skill-field-row">
              <label className="skill-field">
                <span>分类</span>
                <select value={form.category} onChange={(e) => set({ category: e.target.value as Skill['category'] })}>
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="skill-field">
                <span>类型</span>
                <select value={form.skillType} onChange={(e) => set({ skillType: e.target.value as Skill['skillType'] })}>
                  <option value="tool">tool（函数调用）</option>
                  <option value="workflow">workflow（固定流程）</option>
                </select>
              </label>
              <label className="skill-field skill-field-toggle">
                <span>启用</span>
                <button type="button" className={`toggle-btn${form.enabled ? ' on' : ''}`}
                  onClick={() => set({ enabled: !form.enabled })}>
                  {form.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </button>
              </label>
            </div>
          </div>

          {/* Workflow 字段 */}
          {form.skillType === 'workflow' && (
            <div className="skill-field-group">
              <div className="skill-group-title">Workflow 配置</div>
              <label className="skill-field">
                <span>系统提示词 (systemPrompt)</span>
                <textarea rows={4} value={form.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} placeholder="告知 LLM 如何处理读取结果…" />
              </label>
              <label className="skill-field">
                <span>读取 Cypher (cypherRead)</span>
                <textarea rows={4} value={form.cypherRead} onChange={(e) => set({ cypherRead: e.target.value })} placeholder="MATCH (n) RETURN n LIMIT 100" className="code-area" />
              </label>
              <label className="skill-field">
                <span>写入 Cypher (cypherWrite，可留空)</span>
                <textarea rows={3} value={form.cypherWrite} onChange={(e) => set({ cypherWrite: e.target.value })} placeholder="可选：执行后回写图谱" className="code-area" />
              </label>
              <label className="skill-field">
                <span>输出 Schema (JSON Schema，可留空)</span>
                <textarea rows={3} value={form.outputSchema} onChange={(e) => set({ outputSchema: e.target.value })} placeholder='{"type":"object",...}' className="code-area" />
              </label>
            </div>
          )}

          {/* Tool 字段 */}
          {form.skillType === 'tool' && (
            <div className="skill-field-group">
              <div className="skill-group-title">Tool 配置</div>
              <label className="skill-field">
                <span>工具名称 (toolName，snake_case)</span>
                <input value={form.toolName} onChange={(e) => set({ toolName: e.target.value })} placeholder="my_tool_name" />
              </label>
              <label className="skill-field">
                <span>工具说明 (toolDescription，告知 LLM 何时调用)</span>
                <textarea rows={3} value={form.toolDescription} onChange={(e) => set({ toolDescription: e.target.value })} placeholder="当用户需要…时调用此工具" />
              </label>
              <label className="skill-field">
                <span>输入参数 Schema (JSON Schema)</span>
                <textarea rows={6} value={schemaText} onChange={(e) => { setSchemaText(e.target.value); setSchemaError('') }} placeholder={'{\n  "type": "object",\n  "properties": {}\n}'} className="code-area" />
                {schemaError && <span className="skill-error">{schemaError}</span>}
              </label>
              <label className="skill-field">
                <span>Cypher 执行模板 (tool call 触发后运行)</span>
                <textarea rows={4} value={form.cypherExecution} onChange={(e) => set({ cypherExecution: e.target.value })} placeholder="MATCH (n) WHERE n.id = $id RETURN n" className="code-area" />
              </label>
            </div>
          )}
        </div>

        <div className="skill-modal-footer">
          {skill?.isBuiltIn && (
            <span className="skill-builtin-tip">内置技能，不可删除，仅可调整参数</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saveSkill.isPending}>
              {saveSkill.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SkillLibrarySection() {
  const { data: skills = [], isLoading, isError } = useSkills()
  const toggleSkill  = useToggleSkill()
  const deleteSkill  = useDeleteSkill()
  const importSkill  = useImportSkill()
  const queryClient  = useQueryClient()

  const [filterCat, setFilterCat]   = useState<string>('all')
  const [search, setSearch]         = useState('')
  const [editingSkill, setEditing]  = useState<Skill | null | 'new'>(null)

  const filtered = useMemo(() => {
    let list = skills
    if (filterCat !== 'all') list = list.filter((s) => s.category === filterCat)
    if (search.trim()) list = list.filter((s) =>
      s.name.includes(search) || s.description.includes(search) || s.toolName?.includes(search),
    )
    return list
  }, [skills, filterCat, search])

  function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text) as Skill
        const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = data
        importSkill.mutate({ ...rest, isBuiltIn: false })
      } catch {
        alert('JSON 格式错误，导入失败')
      }
    }
    input.click()
  }

  async function handleExportBundle() {
    try {
      const bundle = await api.exportSkillBundle()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `skills-bundle-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('导出失败，请稍后重试')
    }
  }

  function handleImportBundle() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const bundleSkills: unknown[] = parsed.skills ?? (Array.isArray(parsed) ? parsed : [parsed])
        if (bundleSkills.length === 0) { alert('技能包为空'); return }
        const result = await api.importSkillBundle(bundleSkills)
        const msg = `导入完成：新增 ${result.imported} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条（内置）`
          + (result.errors.length ? `\n失败：${result.errors.join('\n')}` : '')
        alert(msg)
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
      } catch {
        alert('技能包解析失败，请确认文件格式正确')
      }
    }
    input.click()
  }

  async function handleExport(skill: Skill) {
    const data = await (api as any).exportSkill(skill.id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${skill.name}.skill.json`; a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return (
    <div className="skill-loading"><Loader2 size={20} className="spin" /> 加载技能库…</div>
  )
  if (isError) return (
    <div className="skill-error-banner"><AlertCircle size={16} /> 技能库加载失败，请确认后端服务正常</div>
  )

  return (
    <div className="skill-library">
      {/* Toolbar */}
      <div className="skill-toolbar">
        <button type="button" className="btn-primary skill-new-btn" onClick={() => setEditing('new')}>
          <Plus size={14} /> 新建技能
        </button>
        <button type="button" className="btn-ghost" onClick={handleImport} title="导入单条技能 JSON">
          <Upload size={14} /> 导入
        </button>
        <button type="button" className="btn-ghost" onClick={handleExportBundle} title="将所有自定义技能导出为技能包（可跨系统迁移）">
          <FileDown size={14} /> 导出技能包
        </button>
        <button type="button" className="btn-ghost" onClick={handleImportBundle} title="从技能包文件批量导入技能（支持幂等更新）">
          <Upload size={14} /> 导入技能包
        </button>
        <div className="skill-search">
          <Search size={13} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索技能…" />
        </div>
      </div>

      {/* Category filter */}
      <div className="skill-cats">
        {['all', 'ontology', 'graph-query', 'data-import', 'cypher-gen', 'reasoning', 'monitoring'].map((cat) => (
          <button key={cat} type="button"
            className={`skill-cat-btn${filterCat === cat ? ' active' : ''}`}
            onClick={() => setFilterCat(cat)}>
            {cat === 'all' ? '全部' : CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="skill-list">
        {filtered.length === 0 && (
          <div className="skill-empty">暂无匹配技能</div>
        )}
        {filtered.map((skill) => (
          <div key={skill.id} className={`skill-row${skill.enabled ? '' : ' skill-row-disabled'}`}>
            <button
              type="button"
              className="skill-toggle"
              title={skill.enabled ? '点击禁用' : '点击启用'}
              onClick={() => toggleSkill.mutate({ id: skill.id, enabled: !skill.enabled })}
            >
              {skill.enabled ? <ToggleRight size={20} className="toggle-on" /> : <ToggleLeft size={20} className="toggle-off" />}
            </button>
            <div className="skill-row-info">
              <span className="skill-row-name">{skill.name}</span>
              <span className="skill-row-desc">{skill.description}</span>
            </div>
            <div className="skill-row-meta">
              <span className="skill-tag skill-tag-cat">{CATEGORY_LABELS[skill.category] ?? skill.category}</span>
              <span className="skill-tag skill-tag-type">{skill.skillType}</span>
              {skill.isBuiltIn && <span className="skill-tag skill-tag-builtin">内置</span>}
            </div>
            <div className="skill-row-actions">
              <button type="button" className="icon-btn" title="编辑" onClick={() => setEditing(skill)}>
                <Pencil size={14} />
              </button>
              <button type="button" className="icon-btn" title="导出" onClick={() => handleExport(skill)}>
                <Download size={14} />
              </button>
              {!skill.isBuiltIn && (
                <button type="button" className="icon-btn icon-btn-danger" title="删除"
                  onClick={() => { if (confirm(`删除技能「${skill.name}」？`)) deleteSkill.mutate(skill.id) }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editingSkill != null && (
        <SkillEditorModal
          skill={editingSkill === 'new' ? null : editingSkill}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ModelFactoryView() {
  const factoryTab = useSchemaStore((s) => s.factoryTab)
  const tab = FACTORY_TABS.find((t) => t.key === factoryTab) ?? FACTORY_TABS[0]
  const Icon = tab.icon
  return (
    <div className="model-factory-view">
      <div className="model-factory-header">
        <Icon size={18} />
        <div>
          <strong>{tab.label}</strong>
          <span>
            {factoryTab === 'llm'    && '配置并管理大模型 API 服务'}
            {factoryTab === 'skills' && '管理 AI 技能，赋能图谱交互'}
            {factoryTab === 'expert' && '图分析算法专家模型'}
          </span>
        </div>
      </div>
      <div className="model-factory-body">
        {factoryTab === 'llm'    && <LLMServiceSection />}
        {factoryTab === 'skills' && <SkillLibrarySection />}
        {factoryTab === 'expert' && <GraphAlgoSection />}
      </div>
    </div>
  )
}

/* ─── AI Chat Panel ──────────────────────────────────────────────────────── */

/* ─── Patch Review Card ──────────────────────────────────────────────────── */

function PatchCard({ item, onApply, onDismiss }: {
  item: PatchItem
  onApply: () => void
  onDismiss: () => void
}) {
  const { patch, status } = item
  let icon = '✦'
  let label = ''
  let detail = ''

  if (patch.kind === 'add_entity') {
    icon = '◈'; label = `新增实体：${patch.data.label}（${patch.data.name}）`
    detail = patch.data.description ?? ''
  } else if (patch.kind === 'add_relation') {
    icon = '→'; label = `新增关系：${patch.sourceLabel} → ${patch.targetLabel}`
    detail = `${patch.data.name ?? ''} · ${patch.data.cardinality ?? ''}  ${patch.data.description ?? ''}`
  } else if (patch.kind === 'add_property') {
    icon = '＋'; label = `新增属性：${patch.entityName} · ${patch.property.name}`
    detail = `${patch.property.type}${patch.property.required ? ' · 必填' : ''}  ${patch.property.description ?? ''}`
  } else if (patch.kind === 'cypher_note') {
    icon = '⌘'; label = `Cypher 建议：${patch.description}`
    detail = patch.cypher
  }

  return (
    <div className={`patch-card patch-card-${status}`}>
      <div className="patch-card-icon">{icon}</div>
      <div className="patch-card-body">
        <div className="patch-card-label">{label}</div>
        {detail && <div className="patch-card-detail">{detail}</div>}
      </div>
      {status === 'pending' && patch.kind !== 'cypher_note' && (
        <div className="patch-card-actions">
          <button type="button" className="patch-apply-btn" onClick={onApply} title="应用此建议">✓</button>
          <button type="button" className="patch-dismiss-btn" onClick={onDismiss} title="忽略">✕</button>
        </div>
      )}
      {status === 'pending' && patch.kind === 'cypher_note' && (
        <button type="button" className="patch-dismiss-btn" onClick={onDismiss} title="关闭">✕</button>
      )}
      {status === 'applied'   && <span className="patch-status-tag patch-applied">已应用</span>}
      {status === 'dismissed' && <span className="patch-status-tag patch-dismissed">已忽略</span>}
    </div>
  )
}

function OdlPatchCard({ item, onApply, onDismiss }: {
  item: OdlPatchItem
  onApply: () => void
  onDismiss: () => void
}) {
  const { patch, status } = item
  return (
    <div className={`patch-card patch-card-odl patch-card-${status}`}>
      <div className="patch-card-icon">📖</div>
      <div className="patch-card-body">
        <div className="patch-card-label">ODL · <code>{patch.section}</code></div>
        <div className="patch-card-detail">{patch.description}</div>
        <pre className="odl-patch-preview">{patch.content.length > 240
          ? patch.content.slice(0, 240) + '…'
          : patch.content}</pre>
      </div>
      {status === 'pending' && (
        <div className="patch-card-actions">
          <button type="button" className="patch-apply-btn" onClick={onApply} title="合并到 ODL">✓</button>
          <button type="button" className="patch-dismiss-btn" onClick={onDismiss} title="忽略">✕</button>
        </div>
      )}
      {status === 'applied'   && <span className="patch-status-tag patch-applied">已应用</span>}
      {status === 'dismissed' && <span className="patch-status-tag patch-dismissed">已忽略</span>}
    </div>
  )
}

/* ─── AI Chat Panel ──────────────────────────────────────────────────────── */

function AiChatPanel({ nodes, edges }: { nodes: EntityNode[]; edges: RelationEdge[] }) {
  const aiChatMsgs        = useSchemaStore((s) => s.aiChatMsgs)
  const isAiLoading       = useSchemaStore((s) => s.isAiLoading)
  const sendAiMessage     = useSchemaStore((s) => s.sendAiMessage)
  const clearAiChat       = useSchemaStore((s) => s.clearAiChat)
  const aiServices        = useSchemaStore((s) => s.aiServices)
  const activeAiServiceId = useSchemaStore((s) => s.activeAiServiceId)
  const setActiveAiService = useSchemaStore((s) => s.setActiveAiService)
  const setAppMode        = useSchemaStore((s) => s.setAppMode)
  const activeSkillId     = useSchemaStore((s) => s.activeSkillId)
  const setActiveSkill    = useSchemaStore((s) => s.setActiveSkill)
  const pendingPatches    = useSchemaStore((s) => s.pendingPatches)
  const applyPatch        = useSchemaStore((s) => s.applyPatch)
  const dismissPatch      = useSchemaStore((s) => s.dismissPatch)
  const clearPatches      = useSchemaStore((s) => s.clearPatches)
  const odlPatches        = useSchemaStore((s) => s.odlPatches)
  const applyOdlPatch     = useSchemaStore((s) => s.applyOdlPatch)
  const dismissOdlPatch   = useSchemaStore((s) => s.dismissOdlPatch)
  const clearOdlPatches   = useSchemaStore((s) => s.clearOdlPatches)
  const docContext        = useSchemaStore((s) => s.docContext)
  const setDocContext     = useSchemaStore((s) => s.setDocContext)

  const [input, setInput] = useState('')
  const messagesEndRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiChatMsgs])

  const onSend = useCallback(() => {
    const t = input.trim()
    if (!t || isAiLoading) return
    setInput('')
    sendAiMessage(t)
  }, [input, isAiLoading, sendAiMessage])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
  }, [onSend])

  const schemaCtx     = useMemo(() => buildSchemaContext(nodes, edges), [nodes, edges])
  const activeService = aiServices.find((s) => s.id === activeAiServiceId)
  const activeSkill   = SKILL_DEFINITIONS[activeSkillId]
  const visiblePatches    = pendingPatches.filter((p) => p.status !== 'dismissed')
  const visibleOdlPatches = odlPatches.filter((p) => p.status !== 'dismissed')
  const pendingCount  = pendingPatches.filter((p) => p.status === 'pending').length
                      + odlPatches.filter((p) => p.status === 'pending').length

  const quickPrompts: Record<SkillId, string[]> = {
    'free-chat':        ['检查 Schema 是否有缺失的关系', '为「客户」实体补充常用属性', '列出本体的设计优化建议'],
    'ontology-design':  ['为信贷风险管理补充本体结构（客户、产品、风险指标）', '在现有基础上补充审批流程相关实体', '补充组织架构和岗位职责建模'],
    'consistency-check':['对当前 Schema 进行全面一致性检查', '检查实体命名规范和属性完整性', '分析关系方向和基数是否合理'],
    'doc-extract':      ['提炼业务文档中的关键实体和关系', '从 SOP 中生成本体框架', '识别文档中的风险指标和控制措施'],
    'odl-edit':         ['为当前 Schema 的核心实体生成 concepts 节', '生成常用的业务查询模板（query_templates）', '为模糊业务词补充 disambiguation_rules'],
  }

  return (
    <div className="ai-chat-panel">
      {/* ── Header ── */}
      <div className="ai-chat-header">
        <div className="ai-schema-badge">
          <Sparkles size={13} />
          <span>{nodes.length} 实体 · {edges.length} 关系</span>
        </div>
        <div className="ai-header-actions">
          {pendingCount > 0 && (
            <button type="button" title="清除全部建议"
              onClick={() => { clearPatches(); clearOdlPatches() }}
              className="ai-clear-patches-btn">
              {pendingCount} 条建议
            </button>
          )}
          <button type="button" title="清空对话" onClick={clearAiChat}><RotateCcw size={14} /></button>
        </div>
      </div>

      {/* ── Skill selector ── */}
      <div className="skill-selector">
        {SKILL_ORDER.map((sid) => {
          const sk = SKILL_DEFINITIONS[sid]
          return (
            <button key={sid} type="button"
              className={`skill-tab${activeSkillId === sid ? ' skill-tab-active' : ''}`}
              onClick={() => setActiveSkill(sid as SkillId)}
              title={sk.description}>
              <span className="skill-tab-icon">{sk.icon}</span>
              <span className="skill-tab-label">{sk.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Service selector ── */}
      {aiServices.length === 0 ? (
        <div className="ai-no-service">
          <Bot size={16} />
          <span>尚未配置大模型服务</span>
          <button type="button" onClick={() => setAppMode('model-factory')}>前往模型工场配置</button>
        </div>
      ) : (
        <div className="ai-service-row">
          <Bot size={12} />
          <select value={activeAiServiceId ?? ''}
            onChange={(e) => setActiveAiService(e.target.value || null)}>
            {!activeAiServiceId && <option value="">— 选择服务 —</option>}
            {aiServices.map((svc) => (
              <option key={svc.id} value={svc.id}>{svc.name}</option>
            ))}
          </select>
          {activeService && (
            <span className="ai-service-hint">
              {activeService.provider === 'anthropic' ? 'Anthropic' : 'OpenAI compat'} · {activeService.model || '—'}
              {activeSkill.anthropicTools.length > 0 && <span className="ai-fc-badge" title="支持结构化建议">FC</span>}
            </span>
          )}
        </div>
      )}

      {/* ── Doc context textarea (doc-extract skill only) ── */}
      {activeSkillId === 'doc-extract' && (
        <div className="doc-context-area">
          <div className="doc-context-label">
            <span>业务文档内容</span>
            {docContext && <button type="button" onClick={() => setDocContext('')} className="doc-clear-btn">清除</button>}
          </div>
          <textarea
            className="doc-context-input"
            value={docContext}
            onChange={(e) => setDocContext(e.target.value)}
            placeholder="粘贴 SOP、流程文档、组织架构说明等业务文档内容，AI 将从中提炼本体元素…"
            rows={5}
          />
        </div>
      )}

      <details className="schema-ctx-preview">
        <summary>当前 Schema 上下文（点击展开）</summary>
        <pre>{JSON.stringify(schemaCtx, null, 2)}</pre>
      </details>

      {/* ── Messages ── */}
      <div className="ai-messages">
        {aiChatMsgs.length === 0 && (
          <div className="ai-welcome">
            <Bot size={28} />
            <strong>{activeSkill.icon} {activeSkill.label}</strong>
            <p>{activeSkill.description}</p>
            <div className="ai-suggestions">
              {quickPrompts[activeSkillId].map((s) => (
                <button key={s} type="button" onClick={() => sendAiMessage(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {aiChatMsgs.map((msg) => (
          <div key={msg.id} className={`ai-msg ai-msg-${msg.role}`}>
            <div className="ai-msg-avatar">{msg.role === 'user' ? '你' : <Bot size={14} />}</div>
            <div className="ai-msg-content"><pre>{msg.content}</pre></div>
          </div>
        ))}

        {isAiLoading && (
          <div className="ai-msg ai-msg-assistant">
            <div className="ai-msg-avatar"><Bot size={14} /></div>
            <div className="ai-msg-content ai-thinking"><span /><span /><span /></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Pending patches panel ── */}
      {(visiblePatches.length > 0 || visibleOdlPatches.length > 0) && (
        <div className="patches-panel">
          <div className="patches-panel-header">
            <span>AI 建议（{pendingCount} 待审批）</span>
            <button type="button" className="patches-clear-all-btn"
              onClick={() => { clearPatches(); clearOdlPatches() }}>全部清除</button>
          </div>
          <div className="patches-list">
            {pendingPatches.map((item) => (
              <PatchCard
                key={item.id}
                item={item}
                onApply={() => applyPatch(item.id)}
                onDismiss={() => dismissPatch(item.id)}
              />
            ))}
            {visibleOdlPatches.map((item) => (
              <OdlPatchCard
                key={item.id}
                item={item}
                onApply={() => applyOdlPatch(item.id)}
                onDismiss={() => dismissOdlPatch(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Input ── */}
      <div className="ai-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={activeSkillId === 'doc-extract' && !docContext
            ? '先粘贴业务文档，再描述提炼目标…'
            : '描述设计需求或提问（Enter 发送，Shift+Enter 换行）'}
          rows={2}
          disabled={isAiLoading}
        />
        <button type="button" className="send-btn" onClick={onSend}
          disabled={!input.trim() || isAiLoading} title="发送">
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

/* ─── Bottom Dock ────────────────────────────────────────────────────────── */

function BottomDock() {
  const nodes  = useSchemaStore((s) => s.nodes)
  const edges  = useSchemaStore((s) => s.edges)
  const issues = useMemo(() => validateSchema(nodes, edges), [nodes, edges])

  return (
    <footer className="bottom-dock">
      <div className="dock-panel">
        <div className="dock-title">
          <CheckCircle2 size={15} className={issues.length === 0 ? 'ok-icon' : 'warn-icon'} />
          <span>Schema 校验</span>
          {issues.length > 0 && <span className="issue-badge">{issues.length}</span>}
        </div>
        {issues.length === 0
          ? <p className="ok-text">未发现阻断问题。</p>
          : issues.map((iss) => <p key={iss} className="issue-text">⚠ {iss}</p>)}
      </div>
      <div className="dock-panel">
        <div className="dock-title"><Database size={15} /><span>工作区概览</span></div>
        <p>
          {nodes.length} 个实体，{edges.length} 条关系，
          属性总数 {nodes.reduce((a, n) => a + n.data.properties.length, 0)}。
          双击画布创建实体，右键实体查看快捷操作。
        </p>
      </div>
    </footer>
  )
}

/* ─── Field helpers ──────────────────────────────────────────────────────── */

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/* ─── Instance Data: InstanceDataGrid ────────────────────────────────────── */

function InstanceDataGrid({ dataset, entityNode }: { dataset: InstanceDataset; entityNode: EntityNode }) {
  const updateRecord  = useSchemaStore((s) => s.updateRecord)
  const deleteRecord  = useSchemaStore((s) => s.deleteRecord)
  const deleteRecords = useSchemaStore((s) => s.deleteRecords)
  const properties    = entityNode.data.properties
  const records       = dataset.records

  const [selectedIds,   setSelectedIds]  = useState<Set<string>>(new Set())
  const [editingRowId,  setEditingRowId] = useState<string | null>(null)
  const [editRowData,   setEditRowData]  = useState<Record<string, string>>({})

  /* Reset editing when dataset changes */
  useEffect(() => { setSelectedIds(new Set()); setEditingRowId(null) }, [dataset.id])

  const allSelected   = records.length > 0 && selectedIds.size === records.length
  const someSelected  = selectedIds.size > 0 && !allSelected

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(records.map((r) => r.id)))
  }

  function toggleRow(id: string) {
    if (editingRowId) return  // 编辑中不允许切换选中行
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleDeleteSelected() {
    const ids = [...selectedIds]
    setSelectedIds(new Set())
    deleteRecords(dataset.id, ids)
  }

  function startEdit(rec: InstanceRecord) {
    const snapshot: Record<string, string> = {}
    for (const p of properties) {
      snapshot[p.name] = rec.data[p.name] != null ? String(rec.data[p.name]) : ''
    }
    setEditingRowId(rec.id)
    setEditRowData(snapshot)
  }

  function saveEdit(rec: InstanceRecord) {
    const newData: Record<string, InstanceFieldValue> = { ...rec.data }
    for (const p of properties) {
      const raw = editRowData[p.name] ?? ''
      if (p.type === 'number') newData[p.name] = raw === '' ? null : Number(raw)
      else if (p.type === 'boolean') newData[p.name] = raw.toLowerCase() === 'true' || raw === '1'
      else newData[p.name] = raw === '' ? null : raw
    }
    updateRecord(dataset.id, rec.id, newData)
    setEditingRowId(null)
  }

  function cancelEdit() { setEditingRowId(null) }

  if (records.length === 0) {
    return (
      <div className="grid-empty">
        <Upload size={32} strokeWidth={1} />
        <p>暂无实例数据，请导入 CSV 或 JSON 文件</p>
      </div>
    )
  }

  return (
    <div className="data-grid-wrap">
      {selectedIds.size > 0 && (
        <div className="grid-selection-bar">
          <span>已选 {selectedIds.size} 条</span>
          <button
            type="button"
            className="btn-ghost grid-sel-del-btn"
            onClick={handleDeleteSelected}
          >
            <Trash2 size={13} /> 删除所选
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 12, padding: '2px 8px' }}
            onClick={() => setSelectedIds(new Set())}
          >
            取消选择
          </button>
        </div>
      )}
      <div className="data-grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                  title="全选 / 取消全选"
                />
              </th>
              {properties.map((p) => (
                <th key={p.name}>
                  <span className="prop-label">{p.nameZh || p.name}</span>
                  {p.required && <span className="prop-required">*</span>}
                  <span className="prop-type">{p.type}</span>
                </th>
              ))}
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const hasErr  = Object.keys(rec.validationErrors).length > 0
              const checked = selectedIds.has(rec.id)
              return (
                <tr
                  key={rec.id}
                  className={`${hasErr ? 'row-has-errors' : ''} ${checked ? 'row-selected' : ''} ${editingRowId === rec.id ? 'row-editing' : ''}`}
                  onClick={() => toggleRow(rec.id)}
                >
                  <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(rec.id)}
                    />
                  </td>
                  {properties.map((p) => {
                    const err = rec.validationErrors[p.name]
                    const isRowEditing = editingRowId === rec.id
                    return (
                      <td key={p.name} className={err ? 'cell-error' : ''} title={err}>
                        {isRowEditing ? (
                          <input
                            className="cell-edit-input"
                            value={editRowData[p.name] ?? ''}
                            onChange={(e) => setEditRowData((d) => ({ ...d, [p.name]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(rec)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          rec.data[p.name] != null ? String(rec.data[p.name]) : <span className="cell-null">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    {editingRowId === rec.id ? (
                      <>
                        <button type="button" className="btn-row-save" title="保存" onClick={() => saveEdit(rec)}>✓</button>
                        <button type="button" className="btn-row-cancel" title="取消" onClick={cancelEdit}>✕</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn-row-edit" title="编辑此行" onClick={() => startEdit(rec)}>
                          <Pencil size={12} />
                        </button>
                        <button type="button" className="btn-row-del" title="删除此行" onClick={() => deleteRecord(dataset.id, rec.id)}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid-footer">
        {records.length} 条记录 · 来源：{dataset.sourceLabel}
        {selectedIds.size > 0 && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>· 已选 {selectedIds.size} 条</span>}
      </div>
    </div>
  )
}

/* ─── Instance Data: InstanceTableView ───────────────────────────────────── */

function InstanceTableView() {
  const allModels           = useSchemaStore((s) => s.models)
  const instanceDatasets    = useSchemaStore((s) => s.instanceDatasets)
  const instanceActiveEntity = useSchemaStore((s) => s.instanceActiveEntity)
  const setInstanceActiveEntity = useSchemaStore((s) => s.setInstanceActiveEntity)
  const bizTwins            = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId     = useSchemaStore((s) => s.activeBizTwinId)

  const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)
  const twinDatasets = instanceDatasets[activeBizTwinId ?? ''] ?? []

  const entityNodes = useMemo<EntityNode[]>(() => {
    if (!activeTwin) return []
    const seen = new Set<string>()
    return activeTwin.modelIds.flatMap((mid) => {
      const model = allModels.find((m) => m.id === mid)
      return (model?.nodes ?? []).filter((n): n is EntityNode => {
        if (n.type !== 'entity' || seen.has(n.id)) return false
        seen.add(n.id)
        return true
      })
    })
  }, [activeTwin, allModels])

  useEffect(() => {
    if (!instanceActiveEntity && entityNodes.length > 0) {
      setInstanceActiveEntity(entityNodes[0].id)
    }
  }, [instanceActiveEntity, entityNodes, setInstanceActiveEntity])

  const activeEntity = entityNodes.find((n) => n.id === instanceActiveEntity)
  const activeDataset = twinDatasets.find((d) => d.entityNodeId === instanceActiveEntity)

  return (
    <div className="instance-table-view">
      <div className="entity-tabs-bar">
        <div className="entity-tabs">
          {entityNodes.map((node) => {
            const ds = twinDatasets.find((d) => d.entityNodeId === node.id)
            const count = ds?.records.length ?? 0
            const isActive = node.id === instanceActiveEntity
            return (
              <button
                key={node.id}
                type="button"
                className={`entity-tab ${isActive ? 'active' : ''}`}
                onClick={() => setInstanceActiveEntity(node.id)}
              >
                <span className="tab-label">{node.data.label || node.data.name}</span>
                {count > 0 && <span className="tab-badge">{count}</span>}
              </button>
            )
          })}
          {entityNodes.length === 0 && (
            <span className="tabs-empty">当前孪生绑定的模型尚无实体定义</span>
          )}
        </div>
      </div>
      <div className="table-content">
        {activeEntity ? (
          activeDataset ? (
            <InstanceDataGrid dataset={activeDataset} entityNode={activeEntity} />
          ) : (
            <div className="grid-empty">
              <Upload size={32} strokeWidth={1} />
              <p>「{activeEntity.data.label || activeEntity.data.name}」暂无实例数据</p>
              <p className="hint">使用右上角的「导入数据」按钮导入 CSV 或 JSON</p>
            </div>
          )
        ) : null}
      </div>
    </div>
  )
}

/* ─── Instance Data: ImportDataView ─────────────────────────────────────── */

// ── Mapping config persistence helpers ────────────────────────────────────
function computeMappingFingerprint(fieldPaths: string[]): string {
  const s = [...fieldPaths].sort().join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff
  return h.toString(36)
}
function mappingStorageKey(twinId: string, fp: string) { return `biz_mapping_${twinId}_${fp}` }
function saveMappingConfig(twinId: string, fp: string, mappings: FolderFieldMapping[]) {
  try {
    localStorage.setItem(mappingStorageKey(twinId, fp), JSON.stringify({ mappings, savedAt: new Date().toISOString() }))
  } catch { /* quota exceeded – ignore */ }
}
function loadMappingConfig(twinId: string, fp: string): FolderFieldMapping[] | null {
  try {
    const raw = localStorage.getItem(mappingStorageKey(twinId, fp))
    if (!raw) return null
    return (JSON.parse(raw) as { mappings: FolderFieldMapping[] }).mappings ?? null
  } catch { return null }
}

// ── Twin-level source config: persists which source was last used per twin ─
type TwinSourceConfig = {
  sourceType: 'json-folder' | 'db-file'
  fingerprint: string
  label: string
  entitySummary: string
  savedAt: string
}
function twinSourceKey(twinId: string) { return `biz_twin_source_${twinId}` }
function saveTwinSource(twinId: string, cfg: TwinSourceConfig) {
  try { localStorage.setItem(twinSourceKey(twinId), JSON.stringify(cfg)) } catch {}
}
function loadTwinSource(twinId: string): TwinSourceConfig | null {
  try { return JSON.parse(localStorage.getItem(twinSourceKey(twinId)) ?? 'null') } catch { return null }
}
function clearTwinSource(twinId: string) { localStorage.removeItem(twinSourceKey(twinId)) }
function buildEntitySummary(mappings: FolderFieldMapping[], entityNodes: EntityNode[]): string {
  const ids = [...new Set(mappings.filter((m) => m.entityNodeId).map((m) => m.entityNodeId!))]
  return ids.map((id) => entityNodes.find((n) => n.id === id)?.data.label || id).join(' · ') || '（未映射）'
}

// ── Array field helpers ────────────────────────────────────────────────────
// Returns the [*]-prefix for an array-derived path, e.g. "input.行程明细[*].出发地点" → "input.行程明细[*]"
function getArrayPrefix(jsonPath: string): string | null {
  const idx = jsonPath.indexOf('[*]')
  return idx === -1 ? null : jsonPath.slice(0, idx + 3)
}

type LocalImportFile = {
  id: string
  name: string
  entityNodeId: string
  headers: string[]
  rows: Record<string, string>[]
  columnMappings: ColumnMapping[]
}

function ImportDataView() {
  const allModels           = useSchemaStore((s) => s.models)
  const bizTwins            = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId     = useSchemaStore((s) => s.activeBizTwinId)
  const addOrReplaceDataset = useSchemaStore((s) => s.addOrReplaceDataset)
  const activeModelId       = useSchemaStore((s) => s.activeModelId)
  const setInstanceViewTab  = useSchemaStore((s) => s.setInstanceViewTab)
  const relinkInstances     = useSchemaStore((s) => s.relinkInstances)
  const initFromApi         = useSchemaStore((s) => s.initFromApi)

  const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)

  const entityNodes = useMemo<EntityNode[]>(() => {
    if (!activeTwin) return []
    const seen = new Set<string>()
    return activeTwin.modelIds.flatMap((mid) => {
      const model = allModels.find((m) => m.id === mid)
      return (model?.nodes ?? []).filter((n): n is EntityNode => {
        if (n.type !== 'entity' || seen.has(n.id)) return false
        seen.add(n.id)
        return true
      })
    })
  }, [activeTwin, allModels])

  const [step, setStep] = useState<'source' | 'folder-mapping' | 'mapping' | 'confirm'>('source')
  const [sourceType, setSourceType] = useState<'json-folder' | 'db-file' | 'direct-db' | 'bundle' | null>(null)
  const [files, setFiles] = useState<LocalImportFile[]>([])
  const [activeFileIdx, setActiveFileIdx] = useState(0)
  const folderRef  = useRef<HTMLInputElement>(null)
  const dbFileRef  = useRef<HTMLInputElement>(null)
  const bundleRef  = useRef<HTMLInputElement>(null)

  // Bundle import state
  const [bundleData,      setBundleData]      = useState<TwinBundle | null>(null)
  const [bundleImporting, setBundleImporting] = useState(false)
  const [bundleLog,       setBundleLog]       = useState<string[]>([])

  // Folder import — per-folder state (one mapping template for all files, multi-entity)
  const [folderRawFiles, setFolderRawFiles]       = useState<File[]>([])
  const [folderSample, setFolderSample]           = useState<Record<string, string>>({})
  const [folderMappings, setFolderMappings]       = useState<FolderFieldMapping[]>([])
  const [folderFingerprint, setFolderFingerprint] = useState('')
  const [configRestored, setConfigRestored]       = useState(false)
  const [twinSourceConfig, setTwinSourceConfig]   = useState<TwinSourceConfig | null>(null)

  // On mount / twin change: if a saved source config exists, skip source step
  useEffect(() => {
    if (!activeBizTwinId) return
    const saved = loadTwinSource(activeBizTwinId)
    if (!saved) return
    const mappings = loadMappingConfig(activeBizTwinId, saved.fingerprint)
    if (!mappings) return
    setSourceType(saved.sourceType)
    setFolderMappings(mappings)
    setFolderFingerprint(saved.fingerprint)
    setTwinSourceConfig(saved)
    setConfigRestored(true)
    setStep('folder-mapping')
  }, [activeBizTwinId])

  function autoMapHeaders(headers: string[], entityNodeId: string): ColumnMapping[] {
    const node = entityNodes.find((n) => n.id === entityNodeId)
    return headers.map((h) => {
      const lower = h.toLowerCase().trim()
      const mapped = node?.data.properties.find(
        (p) => p.name.toLowerCase() === lower || (p.nameZh ?? '').toLowerCase() === lower
      )?.name ?? null
      return { csvHeader: h, mappedTo: mapped }
    })
  }

  async function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
      .filter((f) => f.name.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name))
    e.target.value = ''
    if (selected.length === 0) return

    // Detect bundle format: auto-switch to bundle import mode
    try {
      const firstText = await selected[0].text()
      const firstParsed = JSON.parse(firstText)
      if (firstParsed?.version && Array.isArray(firstParsed?.entities)) {
        setSourceType('bundle')
        setBundleData(firstParsed as TwinBundle)
        setBundleLog([])
        return
      }
    } catch { /* not bundle, continue */ }

    try {
      const sample = flattenJsonDocument(JSON.parse(await selected[0].text()))
      const paths  = Object.keys(sample)
      const fp     = computeMappingFingerprint(paths)
      const saved  = activeBizTwinId ? loadMappingConfig(activeBizTwinId, fp) : null

      setFolderRawFiles(selected)
      setFolderSample(sample)
      setFolderFingerprint(fp)

      if (saved) {
        // Exact fingerprint match: restore all saved mappings, fill any missing paths with null
        const merged = paths.map((p) => saved.find((m) => m.jsonPath === p) ?? { jsonPath: p, entityNodeId: null, propertyName: null })
        setFolderMappings(merged)
        setConfigRestored(true)
      } else if (folderMappings.length > 0) {
        // Structure may have changed: preserve mappings for known paths, smart-map new paths
        const smartNew = smartMapFieldsMultiEntity(paths, entityNodes)
        const merged = paths.map((p) =>
          folderMappings.find((m) => m.jsonPath === p)
          ?? smartNew.find((m) => m.jsonPath === p)
          ?? { jsonPath: p, entityNodeId: null, propertyName: null }
        )
        setFolderMappings(merged)
        setConfigRestored(false)
      } else {
        setFolderMappings(smartMapFieldsMultiEntity(paths, entityNodes))
        setConfigRestored(false)
      }
      setStep('folder-mapping')
    } catch {
      alert('无法解析第一个 JSON 文件，请确认文件格式正确')
    }
  }

  function updateFolderFieldEntity(jsonPath: string, entityNodeId: string | null) {
    setFolderMappings((prev) =>
      prev.map((m) => m.jsonPath === jsonPath ? { ...m, entityNodeId, propertyName: null } : m),
    )
  }

  function updateFolderFieldProperty(jsonPath: string, propertyName: string | null) {
    setFolderMappings((prev) =>
      prev.map((m) => m.jsonPath === jsonPath ? { ...m, propertyName } : m),
    )
  }

  function rerunSmartMapMulti() {
    const paths = Object.keys(folderSample).length > 0
      ? Object.keys(folderSample)
      : folderMappings.map((m) => m.jsonPath)
    setFolderMappings(smartMapFieldsMultiEntity(paths, entityNodes))
    setConfigRestored(false)
  }

  async function confirmFolderMapping() {
    if (!activeBizTwinId) return

    const entityGroups: Record<string, FolderFieldMapping[]> = {}
    for (const m of folderMappings) {
      if (!m.entityNodeId || !m.propertyName) continue
      if (!entityGroups[m.entityNodeId]) entityGroups[m.entityNodeId] = []
      entityGroups[m.entityNodeId].push(m)
    }
    if (Object.keys(entityGroups).length === 0) { alert('请至少映射一个字段'); return }

    const folderName = (folderRawFiles[0] as File & { webkitRelativePath?: string })
      ?.webkitRelativePath?.split('/')[0] ?? `${folderRawFiles.length} 个文件`

    // Determine whether each entity group uses scalar fields or array fields
    // (an entity is "array mode" if any of its mapped fields contain [*])
    type GroupMode = { isArray: false } | { isArray: true; prefix: string }
    const groupModes: Record<string, GroupMode> = {}
    const allArrayPrefixes = new Set<string>()

    for (const entityNodeId of Object.keys(entityGroups)) {
      const prefixes = new Set<string>()
      for (const m of entityGroups[entityNodeId]) {
        const p = getArrayPrefix(m.jsonPath)
        if (p) { prefixes.add(p); allArrayPrefixes.add(p) }
      }
      groupModes[entityNodeId] = prefixes.size > 0
        ? { isArray: true, prefix: [...prefixes][0] }
        : { isArray: false }
    }

    // Read all files: collect scalar rows + array rows by prefix
    const scalarRows: Record<string, string>[] = []
    const arrayRowsByPrefix: Record<string, Record<string, string>[]> = {}

    for (const file of folderRawFiles) {
      try {
        const obj = JSON.parse(await file.text())
        scalarRows.push(flattenJsonDocument(obj))
        for (const prefix of allArrayPrefixes) {
          if (!arrayRowsByPrefix[prefix]) arrayRowsByPrefix[prefix] = []
          arrayRowsByPrefix[prefix].push(...extractArrayRows(obj, prefix))
        }
      } catch { /* skip unparseable files */ }
    }

    const newFiles: LocalImportFile[] = []
    for (const entityNodeId of Object.keys(entityGroups)) {
      const grpMappings = entityGroups[entityNodeId]
      const entityNode  = entityNodes.find((n) => n.id === entityNodeId)
      if (!entityNode) continue
      const mode = groupModes[entityNodeId]

      if (mode.isArray) {
        // Array entity: rows = individual array elements, csvHeader = bare field name (no prefix)
        const prefix = mode.prefix
        const rows   = arrayRowsByPrefix[prefix] ?? []
        const prefixDot = prefix + '.'
        const columnMappings = grpMappings
          .filter((m) => m.jsonPath.startsWith(prefixDot))
          .map((m) => ({ csvHeader: m.jsonPath.slice(prefixDot.length), mappedTo: m.propertyName }))
        newFiles.push({
          id: makeId('f'),
          name: `${folderName} → ${entityNode.data.label || entityNode.data.name}（${rows.length} 条）`,
          entityNodeId,
          headers: columnMappings.map((m) => m.csvHeader),
          rows,
          columnMappings,
        })
      } else {
        // Scalar entity: 1 row per file
        newFiles.push({
          id: makeId('f'),
          name: `${folderName} → ${entityNode.data.label || entityNode.data.name}（${scalarRows.length} 条）`,
          entityNodeId,
          headers: grpMappings.map((m) => m.jsonPath),
          rows: scalarRows,
          columnMappings: grpMappings.map((m) => ({ csvHeader: m.jsonPath, mappedTo: m.propertyName })),
        })
      }
    }
    setFiles(newFiles)
    setStep('confirm')
  }

  function handleDbFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const isJson = file.name.toLowerCase().endsWith('.json')

      // Detect bundle format: auto-switch to bundle import mode
      if (isJson) {
        try {
          const parsed = JSON.parse(text)
          if (parsed?.version && Array.isArray(parsed?.entities)) {
            setSourceType('bundle')
            setBundleData(parsed as TwinBundle)
            setBundleLog([])
            return
          }
        } catch { /* not bundle, fall through */ }
      }

      const result = isJson ? parseJSON(text) : parseCSV(text)
      if (result.error) { alert(result.error); return }
      const defaultEntityId = entityNodes[0]?.id ?? ''
      setFiles([{
        id: makeId('f'),
        name: file.name,
        entityNodeId: defaultEntityId,
        headers: result.headers,
        rows: result.rows,
        columnMappings: autoMapHeaders(result.headers, defaultEntityId),
      }])
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function updateFileEntity(fileId: string, entityNodeId: string) {
    setFiles((prev) => prev.map((f) =>
      f.id !== fileId ? f : { ...f, entityNodeId, columnMappings: autoMapHeaders(f.headers, entityNodeId) }
    ))
  }

  function updateFileColumnMapping(fileId: string, csvHeader: string, mappedTo: string | null) {
    setFiles((prev) => prev.map((f) =>
      f.id !== fileId ? f : {
        ...f,
        columnMappings: f.columnMappings.map((m) => m.csvHeader === csvHeader ? { ...m, mappedTo } : m),
      }
    ))
  }

  function doImport() {
    if (!activeBizTwinId) return
    for (const f of files) {
      const entityNode = entityNodes.find((n) => n.id === f.entityNodeId)
      if (!entityNode) continue
      const records = buildInstanceRecords(f.rows, f.columnMappings, entityNode.data.properties)
      addOrReplaceDataset({
        id: makeId('ds'),
        twinId: activeBizTwinId,
        modelId: activeModelId,
        entityNodeId: f.entityNodeId,
        records,
        importedAt: new Date().toISOString(),
        sourceLabel: f.name,
      })
    }
    setInstanceViewTab('table')
  }

  const activeFile   = files[activeFileIdx]
  const activeEntity = activeFile ? entityNodes.find((n) => n.id === activeFile.entityNodeId) : undefined

  // ── Bundle import handlers ──────────────────────────────────────────────────
  function handleBundleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as TwinBundle
        if (!parsed.version || !Array.isArray(parsed.entities)) {
          alert('格式不正确，请选择由本系统「导出数据包」生成的 .json 文件')
          return
        }
        setBundleData(parsed)
        setBundleLog([])
      } catch {
        alert('无法解析文件，请确认选择的是有效的 JSON 数据包')
      }
    })
  }

  async function handleImportBundle() {
    if (!bundleData || !activeBizTwinId) return
    setBundleImporting(true)
    const log = (msg: string) => setBundleLog((prev) => [...prev, msg])
    const modelId = activeTwin?.modelIds[0] ?? activeModelId

    for (const entity of bundleData.entities) {
      const localNode = entityNodes.find((n) => n.data.name === entity.entityName)
      if (!localNode) {
        log(`⚠️ 跳过：本地模型中无实体类型 "${entity.entityName}"`)
        continue
      }
      log(`正在导入 ${entity.entityLabel}（${entity.records.length} 条）…`)
      try {
        await api.deleteDatasetInstances(activeBizTwinId, localNode.id)
        await api.createInstances({
          twinId:      activeBizTwinId,
          entityDefId: localNode.id,
          records:     entity.records.map((data) => ({ id: makeId('r'), data })),
          modelId,
          sourceLabel: `数据包-${bundleData.twinName}`,
          importedAt:  new Date().toISOString(),
        })
        log(`✓ ${entity.entityLabel} 导入完成`)
      } catch (err) {
        log(`✗ ${entity.entityLabel} 失败: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    log('重建实体间关系…')
    const result = await relinkInstances(activeBizTwinId)
    if (result) {
      log(`✓ 关系重建完成（${result.created} 条关系已创建）`)
    } else {
      log('⚠️ 关系重建失败，请在孪生面板手动触发「建立关系」')
    }

    log('刷新数据视图…')
    await initFromApi()
    setBundleImporting(false)
    setInstanceViewTab('table')
  }

  function renderFileList(fileList: LocalImportFile[]) {
    if (fileList.length === 0) return null
    return (
      <table className="import-file-list" style={{ marginTop: 16 }}>
        <thead><tr><th>文件名</th><th>行数</th><th>对应实体</th></tr></thead>
        <tbody>
          {fileList.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.rows.length}</td>
              <td>
                <select value={f.entityNodeId} onChange={(e) => updateFileEntity(f.id, e.target.value)}>
                  {entityNodes.map((n) => (
                    <option key={n.id} value={n.id}>{n.data.label || n.data.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="import-data-view">
      {/* Hidden file inputs */}
      <input
        ref={folderRef}
        type="file"
        accept=".json"
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderInput}
        {...({ webkitdirectory: '' } as object)}
      />
      <input
        ref={bundleRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleBundleFileChange}
      />
      {/* Step bar — hidden in bundle mode */}
      {sourceType !== 'bundle' && (
        <div className="import-step-bar">
          <div className={`import-step-item ${step === 'source' ? 'active' : 'done'}`}>
            <span className="import-step-num">1</span> 数据源
          </div>
          <span className="import-step-sep">›</span>
          <div className={`import-step-item ${step === 'mapping' || step === 'folder-mapping' ? 'active' : step === 'confirm' ? 'done' : ''}`}>
            <span className="import-step-num">2</span> 字段映射
          </div>
          <span className="import-step-sep">›</span>
          <div className={`import-step-item ${step === 'confirm' ? 'active' : ''}`}>
            <span className="import-step-num">3</span> 导入数据
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="import-step-content">
        {step === 'source' && (
          <div>
            <div className="import-source-cards">
              <div
                className={`import-source-card ${sourceType === 'json-folder' ? 'selected' : ''}`}
                onClick={() => { setSourceType('json-folder'); setFiles([]) }}
              >
                <div className="import-source-card-icon"><FolderOpen size={20} /></div>
                <div className="import-source-card-title">JSON 文件夹</div>
                <div className="import-source-card-desc">批量导入文件夹内的 .json 文件</div>
              </div>
              <div
                className={`import-source-card ${sourceType === 'db-file' ? 'selected' : ''}`}
                onClick={() => { setSourceType('db-file'); setFiles([]) }}
              >
                <div className="import-source-card-icon"><Database size={20} /></div>
                <div className="import-source-card-title">数据库文件</div>
                <div className="import-source-card-desc">导入单个 JSON / CSV 数据文件</div>
              </div>
              <div className="import-source-card disabled" title="即将推出">
                <div className="import-source-card-icon"><Server size={20} /></div>
                <div className="import-source-card-title">直连数据库</div>
                <div className="import-source-card-desc">通过连接字符串直接读取</div>
              </div>
              <div
                className={`import-source-card ${sourceType === 'bundle' ? 'selected' : ''}`}
                onClick={() => { setSourceType('bundle'); setFiles([]); setBundleData(null); setBundleLog([]) }}
              >
                <div className="import-source-card-icon"><Package size={20} /></div>
                <div className="import-source-card-title">导入数据包</div>
                <div className="import-source-card-desc">一键导入完整数据包（含关系）</div>
              </div>
            </div>

            {sourceType === 'json-folder' && (
              <div className="import-source-config">
                <div className="import-drop-hint" onClick={() => folderRef.current?.click()}>
                  <FolderOpen size={28} />
                  <span>点击选择 JSON 文件夹</span>
                  <span className="import-drop-sub">将扫描文件夹内所有 .json 文件</span>
                </div>
                {renderFileList(files)}
              </div>
            )}

            {sourceType === 'db-file' && (
              <div className="import-source-config">
                <input
                  ref={dbFileRef}
                  type="file"
                  accept=".json,.csv"
                  style={{ display: 'none' }}
                  onChange={handleDbFileInput}
                />
                <div className="import-drop-hint" onClick={() => dbFileRef.current?.click()}>
                  <Database size={28} />
                  <span>点击选择数据文件</span>
                  <span className="import-drop-sub">支持 .json、.csv 格式</span>
                </div>
                {renderFileList(files)}
              </div>
            )}

            {sourceType === 'bundle' && (
              <div className="import-source-config">
                {!bundleData ? (
                  <div className="import-drop-hint" onClick={() => bundleRef.current?.click()}>
                    <Package size={28} />
                    <span>点击选择数据包文件</span>
                    <span className="import-drop-sub">选择由本系统「导出数据包」生成的 .json 文件</span>
                  </div>
                ) : (
                  <div className="bundle-preview">
                    <div className="bundle-preview-header">
                      <Package size={16} />
                      <div>
                        <div className="bundle-preview-title">{bundleData.twinName}</div>
                        <div className="bundle-preview-meta">
                          模型 {bundleData.modelId} · {bundleData.entityCount} 种实体 · 共 {bundleData.recordCount} 条记录
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ marginLeft: 'auto', fontSize: 11 }}
                        onClick={() => { setBundleData(null); setBundleLog([]) }}
                      >
                        重新选择
                      </button>
                    </div>
                    <ul className="bundle-entity-list">
                      {bundleData.entities.map((e) => (
                        <li key={e.entityName}>
                          <span className="bundle-entity-name">{e.entityLabel}</span>
                          <span className="bundle-entity-count">{e.recordCount} 条</span>
                          {entityNodes.find((n) => n.data.name === e.entityName)
                            ? <span className="bundle-entity-ok">✓ 匹配</span>
                            : <span className="bundle-entity-warn">⚠ 无匹配实体</span>}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ marginTop: 12, width: '100%' }}
                      onClick={() => void handleImportBundle()}
                      disabled={bundleImporting}
                    >
                      {bundleImporting ? <><Loader2 size={14} className="spin" /> 导入中…</> : <><Package size={14} /> 一键导入全部实体并重建关系</>}
                    </button>
                    {bundleLog.length > 0 && (
                      <div className="bundle-log-panel">
                        {bundleLog.map((line, i) => (
                          <div key={i} className="bundle-log-line">{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!bundleData && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ marginTop: 8, fontSize: 12 }}
                    onClick={() => bundleRef.current?.click()}
                  >
                    <Upload size={12} /> 浏览文件…
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'folder-mapping' && (
          <div className="import-mapping-step">
            {/* Header row */}
            <div className="folder-mapping-header">
              <div className="folder-mapping-info">
                <FolderOpen size={14} />
                {folderRawFiles.length > 0
                  ? <>
                      <span>共 <strong>{folderRawFiles.length}</strong> 个文件 · 每文件 1 条记录</span>
                      <span className="folder-mapping-sub">首文件：{folderRawFiles[0]?.name}</span>
                    </>
                  : <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>配置预览（尚未选择数据文件）</span>
                }
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 11 }}
                  title="重新选择文件夹，保留当前映射配置"
                  onClick={() => folderRef.current?.click()}
                >
                  <RefreshCw size={11} /> 刷新数据源
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 11, color: 'var(--text-muted)' }}
                  title="清除配置，重新选择数据源类型"
                  onClick={() => {
                    if (activeBizTwinId) clearTwinSource(activeBizTwinId)
                    setSourceType(null); setFolderRawFiles([]); setFolderSample({})
                    setFolderMappings([]); setFolderFingerprint(''); setTwinSourceConfig(null); setConfigRestored(false)
                    setStep('source')
                  }}
                >
                  更换数据源
                </button>
              </div>
            </div>

            {/* Twin-source banner: shows when config is pre-loaded but no files selected yet */}
            {twinSourceConfig && folderRawFiles.length === 0 && (
              <div className="twin-source-banner">
                <div className="twin-source-info">
                  <span className="twin-source-label">📂 {twinSourceConfig.label}</span>
                  <span className="twin-source-meta">
                    {twinSourceConfig.entitySummary} · 上次配置于 {new Date(twinSourceConfig.savedAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ fontSize: 12 }}
                  onClick={() => folderRef.current?.click()}
                >
                  选择文件夹以导入
                </button>
              </div>
            )}

            {/* Restored-config notice */}
            {configRestored && folderRawFiles.length > 0 && (
              <div className="mapping-restored-banner">
                <span style={{ color: 'var(--accent-green)' }}>✓</span>
                已自动恢复上次保存的映射配置
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 11, marginLeft: 8 }}
                  onClick={rerunSmartMapMulti}
                >
                  重置为智能映射
                </button>
              </div>
            )}

            {/* Stats + action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                已映射 <strong style={{ color: 'var(--text-primary)' }}>
                  {folderMappings.filter((m) => m.entityNodeId && m.propertyName).length}
                </strong>/{folderMappings.length} 个字段
                · 涉及 {new Set(folderMappings.filter((m) => m.entityNodeId).map((m) => m.entityNodeId)).size} 个实体
                {folderMappings.some((m) => m.jsonPath.includes('[*]')) && (
                  <span className="arr-field-hint">· 含明细字段</span>
                )}
              </span>
              <button type="button" className="btn-ghost" style={{ fontSize: 11 }} onClick={rerunSmartMapMulti}>
                <Sparkles size={11} /> 智能映射
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => {
                  if (!activeBizTwinId || !folderFingerprint) return
                  saveMappingConfig(activeBizTwinId, folderFingerprint, folderMappings)
                  const folderLabel = (folderRawFiles[0] as File & { webkitRelativePath?: string })
                    ?.webkitRelativePath?.split('/')[0] ?? folderRawFiles[0]?.name ?? twinSourceConfig?.label ?? '未知'
                  saveTwinSource(activeBizTwinId, {
                    sourceType: 'json-folder',
                    fingerprint: folderFingerprint,
                    label: folderLabel,
                    entitySummary: buildEntitySummary(folderMappings, entityNodes),
                    savedAt: new Date().toISOString(),
                  })
                  setTwinSourceConfig({
                    sourceType: 'json-folder',
                    fingerprint: folderFingerprint,
                    label: folderLabel,
                    entitySummary: buildEntitySummary(folderMappings, entityNodes),
                    savedAt: new Date().toISOString(),
                  })
                  setConfigRestored(true)
                }}
              >
                <Save size={11} /> 保存配置
              </button>
            </div>

            {/* Mapping table */}
            <div className="mapping-table-wrap">
              <table className="mapping-table folder-mapping-table">
                <thead>
                  <tr><th>JSON 字段路径</th><th>示例值</th><th>目标实体</th><th>目标属性</th><th>状态</th></tr>
                </thead>
                <tbody>
                  {folderMappings.map((m) => {
                    const isArr      = m.jsonPath.includes('[*]')
                    const targetEntity = entityNodes.find((n) => n.id === m.entityNodeId)
                    return (
                      <tr key={m.jsonPath} className={isArr ? 'arr-field-row' : ''}>
                        <td className="col-header" title={m.jsonPath}>
                          {isArr
                            ? <>
                                <span className="arr-path-prefix">
                                  {m.jsonPath.slice(0, m.jsonPath.indexOf('[*]') + 3)}
                                </span>
                                <span className="arr-path-field">
                                  {m.jsonPath.slice(m.jsonPath.indexOf('[*]') + 3)}
                                </span>
                              </>
                            : m.jsonPath}
                        </td>
                        <td className="col-example">{folderSample[m.jsonPath] || '—'}</td>
                        <td>
                          <select
                            value={m.entityNodeId ?? ''}
                            onChange={(e) => updateFolderFieldEntity(m.jsonPath, e.target.value || null)}
                          >
                            <option value="">（跳过）</option>
                            {entityNodes.map((n) => (
                              <option key={n.id} value={n.id}>{n.data.label || n.data.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={m.propertyName ?? ''}
                            disabled={!m.entityNodeId}
                            onChange={(e) => updateFolderFieldProperty(m.jsonPath, e.target.value || null)}
                          >
                            <option value="">（选择属性）</option>
                            {targetEntity?.data.properties.map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.nameZh ? `${p.nameZh} (${p.name})` : p.name}{p.required ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {m.entityNodeId && m.propertyName
                            ? <span style={{ color: 'var(--accent-green)' }}>✓</span>
                            : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>跳过</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div className="import-mapping-step">
            {files.length === 0 ? (
              <div className="grid-empty"><p>请先在上一步选择文件</p></div>
            ) : (
              <>
                <div className="import-file-tabs">
                  {files.map((f, idx) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`import-file-tab ${idx === activeFileIdx ? 'active' : ''}`}
                      onClick={() => setActiveFileIdx(idx)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                {activeFile && activeEntity && (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {activeFile.rows.length} 行 · 已映射{' '}
                      {activeFile.columnMappings.filter((m) => m.mappedTo).length}/{activeFile.headers.length} 列
                    </div>
                    <div className="mapping-table-wrap">
                      <table className="mapping-table">
                        <thead>
                          <tr><th>字段名</th><th>映射到属性</th><th>示例值</th></tr>
                        </thead>
                        <tbody>
                          {activeFile.columnMappings.map((m) => (
                            <tr key={m.csvHeader}>
                              <td className="col-header">{m.csvHeader}</td>
                              <td>
                                <select
                                  value={m.mappedTo ?? ''}
                                  onChange={(e) => updateFileColumnMapping(activeFile.id, m.csvHeader, e.target.value || null)}
                                >
                                  <option value="">（跳过）</option>
                                  {activeEntity.data.properties.map((p) => (
                                    <option key={p.name} value={p.name}>
                                      {p.nameZh ? `${p.nameZh} (${p.name})` : p.name}{p.required ? ' *' : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="col-example">
                                {String(activeFile.rows[0]?.[m.csvHeader] ?? '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="import-confirm-grid">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              将导入以下 {files.length} 个文件（同一实体的已有数据将被替换）：
            </div>
            {files.map((f) => {
              const node = entityNodes.find((n) => n.id === f.entityNodeId)
              return (
                <div key={f.id} className="import-confirm-row">
                  <div>
                    <div className="import-confirm-entity">{node?.data.label || node?.data.name || f.entityNodeId}</div>
                    <div className="import-confirm-count">
                      来源：{f.name} · {f.columnMappings.filter((m) => m.mappedTo).length}/{f.headers.length} 列已映射
                    </div>
                  </div>
                  <div className="import-confirm-total">{f.rows.length} 条</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="import-data-footer">
        {step !== 'source' && (
          <button type="button" className="btn-ghost" onClick={() => {
            if (step === 'mapping' || step === 'folder-mapping') setStep('source')
            else if (step === 'confirm') setStep(sourceType === 'json-folder' ? 'folder-mapping' : 'mapping')
          }}>← 上一步</button>
        )}
        <button type="button" className="btn-ghost" onClick={() => setInstanceViewTab('table')}>取消</button>
        {step === 'source' && (
          <button
            type="button"
            className="btn-primary"
            disabled={!sourceType || sourceType === 'json-folder' || files.length === 0}
            onClick={() => { setActiveFileIdx(0); setStep('mapping') }}
          >
            下一步：字段映射 →
          </button>
        )}
        {step === 'folder-mapping' && (
          <button
            type="button"
            className="btn-primary"
            disabled={
              folderRawFiles.length === 0 ||
              folderMappings.filter((m) => m.entityNodeId && m.propertyName).length === 0
            }
            title={folderRawFiles.length === 0 ? '请先选择数据文件夹' : undefined}
            onClick={confirmFolderMapping}
          >
            下一步：确认导入 →
          </button>
        )}
        {step === 'mapping' && (
          <button
            type="button"
            className="btn-primary"
            disabled={files.length === 0}
            onClick={() => setStep('confirm')}
          >
            下一步：确认导入 →
          </button>
        )}
        {step === 'confirm' && (
          <button type="button" className="btn-primary" onClick={doImport}>
            <Upload size={14} /> 开始导入
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── GenData Error Boundary ─────────────────────────────────────────────── */

class GenDataErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(err: Error) { return { error: err.message } }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('[GenerateDataPanel]', err, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#ef4444', fontSize: 13, background: '#fef2f2', borderRadius: 8 }}>
          <strong>AI 生成面板加载失败：</strong><br />{this.state.error}
        </div>
      )
    }
    return this.props.children
  }
}

/* ─── GenerateDataPanel helpers ─────────────────────────────────────────── */

/** DFS topological sort: returns entity IDs with parents before children. */
function topoSortEntityIds(ids: string[], parentMap: Map<string, string>): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const idSet = new Set(ids)
  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const parentId = parentMap.get(id)
    if (parentId && idSet.has(parentId)) visit(parentId)
    result.push(id)
  }
  ids.forEach(id => visit(id))
  return result
}

/** Recursively compute total estimated range accounting for multi-level hierarchy. */
function estimateTotalRange(
  entityId: string,
  entityRanges: Map<string, { min: number; max: number }>,
  hierParentMap: Map<string, string>,
  entityOrder: string[],
  depth = 0,
): { min: number; max: number } {
  if (depth > 10) return { min: 0, max: 0 }
  const range = entityRanges.get(entityId) ?? { min: 7, max: 13 }
  const parentId = hierParentMap.get(entityId)
  if (!parentId || !entityOrder.includes(parentId)) return range
  const parentTotal = estimateTotalRange(parentId, entityRanges, hierParentMap, entityOrder, depth + 1)
  return { min: range.min * parentTotal.min, max: range.max * parentTotal.max }
}

/* ─── Instance Data: GenerateDataPanel ──────────────────────────────────── */

function GenerateDataPanel({ twinId, modelIds, onClose }: {
  twinId:   string
  modelIds: string[]
  onClose:  () => void
}) {
  const models             = useSchemaStore((s) => s.models)
  const aiServices         = useSchemaStore((s) => s.aiServices)
  const isGenerating       = useSchemaStore((s) => s.isGenerating) ?? false
  const genProgress        = useSchemaStore((s) => s.genProgress)
  const generateSimData    = useSchemaStore((s) => s.generateSimData)
  const setInstanceViewTab = useSchemaStore((s) => s.setInstanceViewTab)
  const instanceDatasets   = useSchemaStore((s) => s.instanceDatasets)

  const safeProgress: GenProgressEvent[] = Array.isArray(genProgress) ? genProgress : []

  const entityNodes = useMemo<EntityNode[]>(() => {
    if (!Array.isArray(modelIds)) return []
    const seen = new Set<string>()
    return modelIds.flatMap((mid) => {
      const model = models.find((m) => m.id === mid)
      return (model?.nodes ?? []).filter((n): n is EntityNode => {
        if (n.type !== 'entity' || seen.has(n.id)) return false
        seen.add(n.id)
        return true
      })
    })
  }, [modelIds, models])

  /* Hierarchy map: childEntityId → parentEntityId
   * Built from structural/associative edges (edge.source = child, edge.target = parent).
   * Only records the FIRST parent if multiple exist. */
  const hierParentMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    if (!Array.isArray(modelIds)) return m
    const HIER_REL_TYPES = new Set(['partOf', 'owns', 'initiatedBy', 'appliedTo'])
    for (const mid of modelIds) {
      const model = models.find((mo) => mo.id === mid)
      for (const edge of (model?.edges ?? [])) {
        if (edge.source === edge.target) continue  // 跳过自反关系，防止实体成为自身的父级
        const cat = edge.data?.relationCategory
        const rt  = edge.data?.relationType
        const isHier = (cat === 'structural' || cat === 'associative')
                    || (rt != null && HIER_REL_TYPES.has(rt))
        if (isHier && !m.has(edge.source)) {
          m.set(edge.source, edge.target)
        }
      }
    }
    return m
  }, [modelIds, models])

  /* Count existing records per entity in this twin */
  const existingCountMap = useMemo<Map<string, number>>(() => {
    const twinDatasets = instanceDatasets[twinId] ?? []
    const m = new Map<string, number>()
    for (const ds of twinDatasets) {
      const prev = m.get(ds.entityNodeId) ?? 0
      m.set(ds.entityNodeId, prev + ds.records.length)
    }
    return m
  }, [instanceDatasets, twinId])

  const [theme, setTheme]   = useState('通用企业业务管理系统')
  const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN')
  const [genMode, setGenMode] = useState<'overwrite' | 'append'>('overwrite')

  const GEN_DEFAULT_SYS_PROMPT = '你是仿真数据生成专家。优先调用 submit_entity_records 工具提交数据；若工具不可用，直接输出 JSON 数组。'
  const [systemPrompt, setSystemPrompt]           = useState(GEN_DEFAULT_SYS_PROMPT)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    Array.isArray(aiServices) && aiServices.length > 0 ? aiServices[0].id : ''
  )

  /* entityOrder: IDs of selected entities in user-specified generation order */
  const [entityOrder, setEntityOrder] = useState<string[]>([])
  /* entityRanges: min/max count range per entity */
  const [entityRanges, setEntityRanges] = useState<Map<string, { min: number; max: number }>>(new Map())

  /* batchParentMap: child → parent, built from entityOrder position + any connecting edge.
   * The endpoint with the earlier position is the parent; closest wins when multiple candidates. */
  const batchParentMap = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>()
    if (!Array.isArray(modelIds)) return m
    for (const mid of modelIds) {
      const mdl = models.find((mo) => mo.id === mid)
      for (const edge of (mdl?.edges ?? [])) {
        if (edge.source === edge.target) continue  // 跳过自反关系
        const srcIdx = entityOrder.indexOf(edge.source)
        const tgtIdx = entityOrder.indexOf(edge.target)
        if (srcIdx === -1 || tgtIdx === -1) continue
        const [parentId, childId, parentIdx] =
          srcIdx < tgtIdx ? [edge.source, edge.target, srcIdx] : [edge.target, edge.source, tgtIdx]
        const existingIdx = m.has(childId) ? entityOrder.indexOf(m.get(childId)!) : -1
        if (parentIdx > existingIdx) m.set(childId, parentId)
      }
    }
    return m
  }, [modelIds, models, entityOrder])

  /* Initialize/reset order and ranges when entity list changes */
  useEffect(() => {
    const sorted = topoSortEntityIds(entityNodes.map(n => n.id), hierParentMap)
    setEntityOrder(sorted)
    setEntityRanges(new Map(sorted.map(id => [id, { min: 7, max: 13 }])))
  }, [entityNodes]) // eslint-disable-line react-hooks/exhaustive-deps

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  })

  const isDone      = safeProgress.some((e) => e.type === 'done' || e.type === 'error')
  const modelId     = Array.isArray(modelIds) && modelIds.length > 0 ? modelIds[0] : ''
  const allSelected = entityOrder.length === entityNodes.length

  const toggleAll = () => {
    if (allSelected) {
      setEntityOrder([])
    } else {
      const sorted = topoSortEntityIds(entityNodes.map(n => n.id), hierParentMap)
      setEntityOrder(sorted)
      setEntityRanges(prev => {
        const m = new Map(prev)
        sorted.forEach(id => { if (!m.has(id)) m.set(id, { min: 7, max: 13 }) })
        return m
      })
    }
  }

  const toggleEntity = (id: string, checked: boolean) => {
    if (checked) {
      if (!entityOrder.includes(id)) {
        setEntityOrder(prev => [...prev, id])
        setEntityRanges(prev => {
          const m = new Map(prev)
          if (!m.has(id)) m.set(id, { min: 7, max: 13 })
          return m
        })
      }
    } else {
      setEntityOrder(prev => prev.filter(x => x !== id))
    }
  }

  const moveUp = (id: string) => {
    setEntityOrder(prev => {
      const idx = prev.indexOf(id)
      if (idx <= 0) return prev
      const arr = [...prev];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]]
      return arr
    })
  }

  const moveDown = (id: string) => {
    setEntityOrder(prev => {
      const idx = prev.indexOf(id)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const arr = [...prev];
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
      return arr
    })
  }

  const setMin = (id: string, val: number) => {
    setEntityRanges(prev => {
      const m = new Map(prev)
      const curr = m.get(id) ?? { min: 1, max: 10 }
      const newMin = Math.max(0, Math.min(500, val))
      m.set(id, { min: newMin, max: Math.max(newMin, curr.max) })
      return m
    })
  }

  const setMax = (id: string, val: number) => {
    setEntityRanges(prev => {
      const m = new Map(prev)
      const curr = m.get(id) ?? { min: 1, max: 10 }
      const newMax = Math.max(1, Math.min(500, val))
      m.set(id, { min: Math.min(curr.min, newMax), max: newMax })
      return m
    })
  }

  const onStart = () => {
    if (!modelId || entityOrder.length === 0 || !selectedServiceId) return
    generateSimData({
      twinId, modelId, theme, locale, aiServiceId: selectedServiceId, mode: genMode,
      entityCounts: entityOrder.map(id => {
        const r = entityRanges.get(id) ?? { min: 7, max: 13 }
        return { entityNodeId: id, min: r.min, max: r.max }
      }),
      hierParentIds:      Object.fromEntries(batchParentMap),
      systemPrompt:       systemPrompt !== GEN_DEFAULT_SYS_PROMPT ? systemPrompt : undefined,
      extraInstructions:  extraInstructions.trim() || undefined,
    })
  }

  /* Which selected entities already have data in this twin */
  const entitiesWithData = entityOrder
    .map(id => entityNodes.find(n => n.id === id))
    .filter((n): n is EntityNode => !!n && (existingCountMap.get(n.id) ?? 0) > 0)

  const panel = (
    <>
      {/* Backdrop */}
      <div className="gen-modal-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="gen-data-panel">
        <div className="gen-panel-header">
          <Wand2 size={15} />
          <span>AI 仿真数据生成</span>
          <button type="button" className="gen-panel-close" onClick={onClose} title="关闭">
            <X size={14} />
          </button>
        </div>

        <div className="gen-panel-body">
          {/* ── Config column ── */}
          <div className="gen-panel-config">
            <label className="gen-field">
              <span>业务主题</span>
              <textarea
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                rows={2}
                disabled={isGenerating}
                placeholder="如：差旅费报销管理系统，包含出差申请、费用核销等业务场景"
              />
            </label>

            <div className="gen-field-row">
              <label className="gen-field gen-field-sm">
                <span>数据语言</span>
                <select value={locale} onChange={(e) => setLocale(e.target.value as 'zh-CN' | 'en-US')} disabled={isGenerating}>
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
              <label className="gen-field gen-field-sm">
                <span>AI 服务</span>
                <select value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)} disabled={isGenerating}>
                  {Array.isArray(aiServices) && aiServices.map((svc) => (
                    <option key={svc.id} value={svc.id}>{svc.name}</option>
                  ))}
                  {(!Array.isArray(aiServices) || aiServices.length === 0) && (
                    <option value="">（未配置 AI 服务）</option>
                  )}
                </select>
              </label>
            </div>

            <div className="gen-field">
              <span>
                生成顺序与数量范围
                <small>（{entityOrder.length}/{entityNodes.length} 已选）</small>
                <button type="button" className="gen-select-all-btn" onClick={toggleAll} disabled={isGenerating}>
                  {allSelected ? '取消全选' : '全选'}
                </button>
              </span>
              <div className="gen-entity-list">
                {/* ── Selected entities in user-defined order ── */}
                {entityOrder.length > 0 && (
                  <div className="gen-order-section-label">生成顺序（上方先生成）</div>
                )}
                {entityOrder.map((id, idx) => {
                  const n = entityNodes.find(x => x.id === id)
                  if (!n) return null
                  const parentId   = hierParentMap.get(n.id)
                  const parentNode = parentId ? entityNodes.find(x => x.id === parentId) : undefined
                  const parentInSel = !!parentId && entityOrder.includes(parentId)
                  const showHier   = parentInSel
                  const range      = entityRanges.get(n.id) ?? { min: 7, max: 13 }
                  const est        = showHier ? estimateTotalRange(n.id, entityRanges, hierParentMap, entityOrder) : null
                  return (
                    <div key={n.id} className={`gen-entity-item gen-entity-ordered${showHier ? ' gen-entity-child' : ''}`}>
                      <div className="gen-order-controls">
                        <button
                          type="button"
                          className="gen-order-btn"
                          onClick={() => moveUp(id)}
                          disabled={isGenerating || idx === 0}
                          title="上移"
                        >▲</button>
                        <span className="gen-order-badge">{idx + 1}</span>
                        <button
                          type="button"
                          className="gen-order-btn"
                          onClick={() => moveDown(id)}
                          disabled={isGenerating || idx === entityOrder.length - 1}
                          title="下移"
                        >▼</button>
                      </div>
                      <input
                        type="checkbox"
                        checked={true}
                        disabled={isGenerating}
                        onChange={() => toggleEntity(n.id, false)}
                      />
                      <span className="entity-dot" style={{ background: n.data?.color || '#4f7bbd' }} />
                      <span className="entity-item-label">{n.data?.label || n.data?.name || n.id}</span>
                      {n.data?.name && n.data.name !== n.data?.label && (
                        <code className="entity-item-name">({n.data.name})</code>
                      )}
                      <div className="entity-count-wrap entity-range-wrap">
                        <input
                          type="number"
                          className="entity-count-input"
                          min={0} max={500}
                          value={range.min}
                          disabled={isGenerating}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setMin(n.id, Number(e.target.value))}
                          title="最少条数（0 表示允许不生成）"
                        />
                        <span className="entity-range-sep">~</span>
                        <input
                          type="number"
                          className="entity-count-input"
                          min={1} max={500}
                          value={range.max}
                          disabled={isGenerating}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setMax(n.id, Number(e.target.value))}
                          title="最多条数"
                        />
                        <span className="entity-count-unit">
                          {showHier ? `条/每${parentNode?.data?.label ?? '父级'}` : '条'}
                        </span>
                        {est && (
                          <small className="entity-count-est">≈{est.min}~{est.max}条</small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="gen-single-btn"
                        disabled={isGenerating || !selectedServiceId}
                        title={`单独生成此实体`}
                        onClick={(e) => {
                          e.stopPropagation()
                          const r = entityRanges.get(n.id) ?? { min: 7, max: 13 }
                          generateSimData({
                            twinId, modelId, theme, locale, mode: genMode,
                            aiServiceId: selectedServiceId,
                            entityCounts: [{ entityNodeId: n.id, min: r.min, max: r.max }],
                            hierParentIds: Object.fromEntries(batchParentMap),
                            systemPrompt: systemPrompt !== GEN_DEFAULT_SYS_PROMPT ? systemPrompt : undefined,
                            extraInstructions: extraInstructions.trim() || undefined,
                          })
                        }}
                      >⚡</button>
                    </div>
                  )
                })}

                {/* ── Unselected entities ── */}
                {entityNodes.some(n => !entityOrder.includes(n.id)) && (
                  <div className="gen-order-section-label gen-unsel-label">未选择（点击添加）</div>
                )}
                {entityNodes.filter(n => !entityOrder.includes(n.id)).map((n) => (
                  <div key={n.id} className="gen-entity-item gen-entity-unchecked">
                    <div className="gen-order-controls" />
                    <input
                      type="checkbox"
                      checked={false}
                      disabled={isGenerating}
                      onChange={(e) => toggleEntity(n.id, e.target.checked)}
                    />
                    <span className="entity-dot" style={{ background: n.data?.color || '#4f7bbd' }} />
                    <span className="entity-item-label">{n.data?.label || n.data?.name || n.id}</span>
                    {n.data?.name && n.data.name !== n.data?.label && (
                      <code className="entity-item-name">({n.data.name})</code>
                    )}
                  </div>
                ))}

                {entityNodes.length === 0 && (
                  <p className="gen-empty-hint">本体模型中暂无实体，请先在本体设计中创建实体</p>
                )}
              </div>
            </div>

            {/* ── Write mode ── */}
            <div className="gen-field">
              <span>写入模式</span>
              <div className="gen-mode-tabs">
                <button
                  type="button"
                  className={`gen-mode-btn${genMode === 'overwrite' ? ' active' : ''}`}
                  onClick={() => setGenMode('overwrite')}
                  disabled={isGenerating}
                >
                  覆盖旧数据
                </button>
                <button
                  type="button"
                  className={`gen-mode-btn${genMode === 'append' ? ' active' : ''}`}
                  onClick={() => setGenMode('append')}
                  disabled={isGenerating}
                >
                  追加到旧数据
                </button>
              </div>
              {genMode === 'overwrite' && entitiesWithData.length > 0 && (
                <p className="gen-mode-warn">
                  ⚠ 以下实体的已有数据将被清空：
                  {entitiesWithData.map((n) => (
                    <span key={n.id} className="gen-warn-tag">
                      {n.data?.label ?? n.id}（{existingCountMap.get(n.id)}条）
                    </span>
                  ))}
                </p>
              )}
              {genMode === 'append' && entitiesWithData.length > 0 && (
                <p className="gen-mode-hint">
                  已有数据的实体将按唯一键合并重复记录，无唯一键则直接追加
                </p>
              )}
              {genMode === 'append' && entitiesWithData.length === 0 && (
                <p className="gen-mode-hint">当前选中实体均无已有数据，将直接插入</p>
              )}
            </div>

            <button
              type="button"
              className="btn-primary gen-start-btn"
              disabled={isGenerating || entityOrder.length === 0 || !selectedServiceId}
              onClick={onStart}
            >
              {isGenerating
                ? <><Loader2 size={14} className="spin" /> 生成中…</>
                : <><Wand2 size={14} /> 开始生成</>}
            </button>
          </div>

          {/* ── Right column: prompt editor + progress ── */}
          <div className="gen-prompt-col">
            <div className="gen-prompt-section">
              <div className="gen-prompt-label">
                <span>系统提示词</span>
                {systemPrompt !== GEN_DEFAULT_SYS_PROMPT && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: '1px 6px' }}
                    onClick={() => setSystemPrompt(GEN_DEFAULT_SYS_PROMPT)}
                  >
                    恢复默认
                  </button>
                )}
              </div>
              <textarea
                className="gen-prompt-textarea"
                rows={4}
                value={systemPrompt}
                disabled={isGenerating}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>
            <div className="gen-prompt-section">
              <div className="gen-prompt-label">
                <span>额外要求</span>
                <span className="gen-prompt-hint">追加到每个实体生成请求末尾</span>
              </div>
              <textarea
                className="gen-prompt-textarea"
                rows={6}
                value={extraInstructions}
                disabled={isGenerating}
                placeholder={`例如：\n- 城市人口数量要符合中国实际情况\n- 所有日期不早于 2020 年\n- 公司名称必须包含行业关键词`}
                onChange={(e) => setExtraInstructions(e.target.value)}
              />
            </div>
            {safeProgress.length > 0 && (
              <div className="gen-prompt-section gen-prompt-section-grow">
                <div className="gen-prompt-label"><span>进度日志</span></div>
                <div className="gen-progress-log" ref={logRef}>
                  {safeProgress.map((evt, i) => (
                    <div key={i} className={`gen-log-item gen-log-${evt.type}`}>
                      {evt.type === 'progress'              && <><Loader2 size={11} className="spin gen-log-spin" />&nbsp;[{evt.index}/{evt.total}] 正在生成「{evt.label}」({evt.entity})…</>}
                      {evt.type === 'entity_batch_progress' && <><Loader2 size={11} className="spin gen-log-spin" />&nbsp;[{evt.parentVal}] 正在生成「{evt.label}」（{evt.batchIndex}/{evt.batchTotal}）…</>}
                      {evt.type === 'entity_done'           && <>✓ [{String(i + 1).padStart(2, '0')}] 「{evt.label}」已生成 {evt.count} 条</>}
                      {evt.type === 'entity_error'          && <>✗ 「{evt.label}」失败：{evt.message}</>}
                      {evt.type === 'warning'               && <>{evt.message}</>}
                      {evt.type === 'dedup_done'            && <>🔧 去重：移除 {evt.removed} 条重复记录，保留 {evt.kept} 条唯一实例</>}
                      {evt.type === 'relink_done'           && <>🔗 关联 {evt.relationsLinked} 个关系定义</>}
                      {evt.type === 'done' && (
                        evt.totalRecords === 0
                          ? <>⚠️ LLM 调用完成，但 Neo4j 中写入了 0 条记录。请确认业务孪生已正确保存到数据库后，重新生成一次。</>
                          : <>✅ 完成：{evt.totalEntities} 个实体，共 {evt.totalRecords} 条记录已写入 Neo4j</>
                      )}
                      {evt.type === 'error' && <>❌ 错误：{evt.message}</>}
                    </div>
                  ))}
                </div>
                {isDone && (
                  <button
                    type="button"
                    className="btn-ghost gen-view-btn"
                    onClick={() => { setInstanceViewTab('table'); onClose() }}
                  >
                    <Table size={13} /> 查看数据
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )

  return createPortal(panel, document.body)
}

/* ─── Instance Data: ExportCypherButton ──────────────────────────────────── */

function ExportCypherButton() {
  const nodes            = useSchemaStore((s) => s.nodes)
  const edges            = useSchemaStore((s) => s.edges)
  const instanceDatasets = useSchemaStore((s) => s.instanceDatasets)
  const activeBizTwinId  = useSchemaStore((s) => s.activeBizTwinId)
  const bizTwins         = useSchemaStore((s) => s.bizTwins)

  const twinDatasets = instanceDatasets[activeBizTwinId ?? ''] ?? []
  const twinName     = bizTwins.find((t) => t.id === activeBizTwinId)?.name ?? activeBizTwinId ?? 'export'

  function handleExportCypher() {
    if (twinDatasets.length === 0) { alert('当前孪生暂无实例数据，请先导入'); return }
    const cypher = generateCypher(twinDatasets, nodes as EntityNode[], edges as RelationEdge[])
    downloadCypher(cypher, `twin-${activeBizTwinId ?? 'export'}.cypher`)
  }

  function handleExportExcel() {
    if (twinDatasets.length === 0) { alert('当前孪生暂无实例数据，请先导入'); return }
    void exportTwinAsExcel(twinDatasets, nodes as EntityNode[], twinName)
  }

  function handleExportCSV() {
    if (twinDatasets.length === 0) { alert('当前孪生暂无实例数据，请先导入'); return }
    void exportTwinAsCSV(twinDatasets, nodes as EntityNode[])
  }

  function handleExportJSON() {
    if (twinDatasets.length === 0) { alert('当前孪生暂无实例数据，请先导入'); return }
    const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)
    exportTwinAsJSON(twinDatasets, nodes as EntityNode[], twinName, activeTwin?.modelIds[0] ?? '')
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button type="button" className="btn-export-cypher" onClick={handleExportCypher} title="导出 Neo4j Cypher（可在 Neo4j Browser 中执行）">
        <Database size={14} /> 导出 Cypher
      </button>
      <button type="button" className="btn-export-cypher" onClick={handleExportExcel} title="导出 Excel 多 Sheet（需另存为 CSV 才可导入）">
        <FileDown size={14} /> 导出 Excel
      </button>
      <button type="button" className="btn-export-cypher" onClick={handleExportCSV} title="导出各实体为独立 CSV 文件，可直接通过「导入数据」Tab 重新导入">
        <FileDown size={14} /> 导出 CSV
      </button>
      <button type="button" className="btn-export-cypher" onClick={handleExportJSON} title="将所有实体实例打包为单一 JSON 文件，可在另一系统通过「导入数据包」一键恢复">
        <Package size={14} /> 导出数据包
      </button>
    </div>
  )
}

/* ─── Instance Data: InstanceDataView ───────────────────────────────────── */

function InstanceDataView() {
  const instanceViewTab      = useSchemaStore((s) => s.instanceViewTab)
  const setInstanceViewTab   = useSchemaStore((s) => s.setInstanceViewTab)
  const bizTwins             = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId      = useSchemaStore((s) => s.activeBizTwinId)
  const addBizTwin           = useSchemaStore((s) => s.addBizTwin)
  const setActiveBizTwinId   = useSchemaStore((s) => s.setActiveBizTwinId)
  const setAppMode           = useSchemaStore((s) => s.setAppMode)
  const models               = useSchemaStore((s) => s.models)
  const isGenerating         = useSchemaStore((s) => s.isGenerating)
  const [showNewTwin, setShowNewTwin]   = useState(false)
  const [showGenPanel, setShowGenPanel] = useState(false)
  const dedupInstances  = useSchemaStore((s) => s.dedupInstances)
  const isDeduping      = useSchemaStore((s) => s.isDeduping)

  const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)

  if (!activeTwin) {
    return (
      <div className="instance-shell">
        <div className="instance-no-twin">
          <Database size={40} strokeWidth={1} />
          <p>尚未选择业务孪生</p>
          <small>从左侧选择或新建一个孪生，将实例数据映射到本体模型中</small>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowNewTwin(true)}
          >
            <Plus size={14} /> 新建业务孪生
          </button>
        </div>
        {showNewTwin && (
          <NewTwinModal
            models={models}
            onClose={() => setShowNewTwin(false)}
            onCreate={(twin) => {
              addBizTwin(twin)
              setActiveBizTwinId(twin.id)
              setAppMode('instance')
              setShowNewTwin(false)
            }}
          />
        )}
      </div>
    )
  }

  const twinModelNames = activeTwin.modelIds
    .map((mid) => models.find((m) => m.id === mid)?.name ?? mid)

  return (
    <div className="instance-shell">
      <div className="instance-topbar">
        <div className="instance-twin-header">
          <div className="twin-avatar twin-avatar-sm" style={{ background: activeTwin.color }}>
            {activeTwin.name[0]}
          </div>
          <span className="twin-title">{activeTwin.name}</span>
          {twinModelNames.map((name) => (
            <span key={name} className="model-tag">{name}</span>
          ))}
        </div>
        <div className="instance-topbar-actions">
          <button
            type="button"
            className="btn-ghost"
            title="对当前孪生的所有实例数据执行去重（合并业务字段完全相同的记录）"
            disabled={isDeduping || isGenerating}
            onClick={async () => {
              if (!activeTwin) return
              const r = await dedupInstances(activeTwin.id)
              if (r.removed === 0) alert('没有发现重复记录')
              else alert(`去重完成：移除 ${r.removed} 条重复记录，保留 ${r.kept} 条唯一实例`)
            }}
          >
            {isDeduping
              ? <><Loader2 size={14} className="spin" /> 去重中…</>
              : <><Filter size={14} /> 去重</>}
          </button>
          <button
            type="button"
            className={`btn-ghost gen-data-toggle-btn${showGenPanel ? ' active' : ''}`}
            onClick={() => setShowGenPanel((v) => !v)}
            title="AI 仿真数据生成"
            disabled={isGenerating}
          >
            {isGenerating
              ? <><Loader2 size={14} className="spin" /> 生成中…</>
              : <><Wand2 size={14} /> AI 生成</>}
          </button>
          <ExportCypherButton />
        </div>
      </div>
      {showGenPanel && activeTwin && (
        <GenDataErrorBoundary>
          <GenerateDataPanel
            twinId={activeTwin.id}
            modelIds={activeTwin.modelIds}
            onClose={() => setShowGenPanel(false)}
          />
        </GenDataErrorBoundary>
      )}
      <div className="instance-main-tabs">
        <button
          type="button"
          className={instanceViewTab === 'table' ? 'active' : ''}
          onClick={() => setInstanceViewTab('table')}
        >
          <Table size={14} /> 表格视图
        </button>
        <button
          type="button"
          className={instanceViewTab === 'import' ? 'active' : ''}
          onClick={() => setInstanceViewTab('import')}
        >
          <Upload size={14} /> 导入数据
        </button>
        <button
          type="button"
          className={instanceViewTab === 'query' ? 'active' : ''}
          onClick={() => setInstanceViewTab('query')}
        >
          <TerminalSquare size={14} /> 查询分析
        </button>
      </div>
      <div className="instance-content">
        {instanceViewTab === 'table' ? <InstanceTableView />
          : instanceViewTab === 'import' ? <ImportDataView />
          : <CypherConsole context="graph" />}
      </div>
    </div>
  )
}

/* ─── Smart App: SmartEntityClusterNode ─────────────────────────────────── */

type SmartClusterData = {
  entityNode: EntityNode
  dataset: InstanceDataset | undefined
}

function SmartEntityClusterNode({ data }: { data: SmartClusterData }) {
  const { entityNode, dataset } = data
  const props     = entityNode.data.properties.slice(0, 3)
  const count     = dataset?.records.length ?? 0
  const firstRow  = dataset?.records[0]?.data ?? {}
  const color     = entityNode.data.color || '#4f7bbd'

  return (
    <div className="smart-entity-node">
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <div className="smart-entity-header" style={{ background: color }}>
        <span className="smart-entity-name">{entityNode.data.label || entityNode.data.name}</span>
        {count > 0 && <span className="smart-entity-badge">{count}</span>}
      </div>
      <div className="smart-entity-body">
        {props.map((p) => (
          <div key={p.name} className="smart-entity-prop">
            <span className="smart-prop-key">{p.nameZh || p.name}</span>
            <span className="smart-prop-val">
              {firstRow[p.name] != null ? String(firstRow[p.name]).slice(0, 20) : '—'}
            </span>
          </div>
        ))}
        {count === 0 && <span className="smart-no-data">暂无数据</span>}
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/* ─── Smart App: Neo4j Record Node ──────────────────────────────────────── */

type Neo4jRecordNodeData = {
  labels: string[]
  properties: Record<string, string | number | boolean | null>
  color: string
  entityLabel: string        // Chinese label from ontology (e.g. "城市")
  entityProps: EntityProperty[]  // property definitions from ontology
  displayName: string        // primary identifier value (first meaningful property)
  mode: 'simple' | 'detail'
}

function Neo4jRecordNode({ data }: { data: Neo4jRecordNodeData }) {
  const { labels, properties, color, entityLabel, entityProps, displayName, mode } = data

  const typeLabel = entityLabel || labels.filter((l) => l !== 'EntityInstance')[0] || labels[0] || ''

  if (mode === 'simple') {
    return (
      <div className="neo4j-record-node neo4j-record-simple">
        <Handle type="target" position={Position.Left} />
        <Handle type="target" position={Position.Top} />
        <div className="neo4j-record-header" style={{ background: color }}>
          <span className="neo4j-entity-type-label">{typeLabel}</span>
        </div>
        <div className="neo4j-record-simple-name">{displayName || '—'}</div>
        <Handle type="source" position={Position.Right} />
        <Handle type="source" position={Position.Bottom} />
      </div>
    )
  }

  // detail mode
  const propsToShow = entityProps.length > 0
    ? entityProps.map((p) => ({
        key: p.nameZh || p.name,
        val: properties[p.name],
      })).filter(({ val }) => val != null)
    : Object.entries(properties)
        .filter(([k]) => !k.startsWith('_'))
        .slice(0, 6)
        .map(([k, v]) => ({ key: k, val: v }))

  return (
    <div className="neo4j-record-node neo4j-record-detail">
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <div className="neo4j-record-header" style={{ background: color }}>
        <span className="neo4j-entity-type-label">{typeLabel}</span>
        {displayName && <span className="neo4j-entity-display-name">{displayName}</span>}
      </div>
      <div className="neo4j-record-body">
        {propsToShow.map(({ key, val }) => (
          <div key={key} className="neo4j-record-prop">
            <span className="neo4j-prop-key">{key}</span>
            <span className="neo4j-prop-val">{String(val).slice(0, 20)}</span>
          </div>
        ))}
        {propsToShow.length === 0 && <span className="smart-no-data">无属性</span>}
      </div>
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

/* ─── Smart App: Schema Entity Card (read-only EntityCard for schema-overview) ─ */

type SmartEntityDefData = {
  name: string; label: string; color: string
  description: string; entityType: string
  properties: EntityProperty[]; instanceCount: number
}

function SmartEntityDefCard({ data }: { data: SmartEntityDefData }) {
  const idProp = data.properties.find((p) => p.name === 'id' || p.name === 'ID')
  const otherProps = data.properties.filter((p) => p !== idProp).slice(0, 2)
  const displayProps = idProp ? [idProp, ...otherProps] : data.properties.slice(0, 2)
  const hiddenCount = data.properties.length - displayProps.length
  return (
    <div className="entity-card">
      <Handle type="target" position={Position.Left} className="entity-handle" />
      <div className="entity-accent" style={{ background: data.color }} />
      <div className="entity-header">
        <Database size={13} />
        <div>
          <strong>{data.label || data.name}</strong>
          <span>{data.name}</span>
        </div>
        {data.instanceCount > 0 && (
          <span className="schema-instance-badge">{data.instanceCount}</span>
        )}
      </div>
      <div className="property-list">
        {displayProps.map((p) => (
          <div key={p.id || p.name} className="property-row">
            <span>{p.nameZh || p.name}</span>
            <small>{p.type}{p.required ? '*' : ''}</small>
          </div>
        ))}
        {hiddenCount > 0 && <span className="property-more">+{hiddenCount}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="entity-handle" />
    </div>
  )
}

const smartNodeTypes = {
  smartCluster: SmartEntityClusterNode,
  neo4jRecord:  Neo4jRecordNode,
  schemaEntity: SmartEntityDefCard,
}
const smartEdgeTypes = { relation: RelationEdgeView }

/* ─── Smart App: Layout Engine ───────────────────────────────────────────── */

type LayoutType = 'ring' | 'grid' | 'hierarchy' | 'radial'

const CARD_W = 200
const CARD_H = 140

const LAYOUT_OPTIONS: { key: LayoutType; label: string; icon: React.ElementType }[] = [
  { key: 'ring',      label: '环形', icon: RotateCcw },
  { key: 'grid',      label: '网格', icon: LayoutGrid },
  { key: 'hierarchy', label: '层次', icon: GitBranchPlus },
  { key: 'radial',    label: '辐射', icon: Network },
]

function computeLayout(
  entityNodes: EntityNode[],
  twinDatasets: InstanceDataset[],
  relationEdges: import('@xyflow/react').Edge[],
  layoutType: LayoutType,
) {
  const n = entityNodes.length
  if (n === 0) return []

  let positions: { x: number; y: number }[]

  if (layoutType === 'ring') {
    const R = Math.max(300, n * 120)
    positions = entityNodes.map((_, i) => {
      const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2
      return { x: R * Math.cos(angle) - CARD_W / 2, y: R * Math.sin(angle) - CARD_H / 2 }
    })
  } else if (layoutType === 'grid') {
    const cols = Math.ceil(Math.sqrt(n))
    const GAP_X = 260, GAP_Y = 180
    const rows = Math.ceil(n / cols)
    const totalW = (cols - 1) * GAP_X
    const totalH = (rows - 1) * GAP_Y
    positions = entityNodes.map((_, i) => ({
      x: (i % cols) * GAP_X - totalW / 2 - CARD_W / 2,
      y: Math.floor(i / cols) * GAP_Y - totalH / 2 - CARD_H / 2,
    }))
  } else if (layoutType === 'hierarchy') {
    const outEdges: Record<string, string[]> = {}
    const inDegree: Record<string, number> = {}
    for (const en of entityNodes) { outEdges[en.id] = []; inDegree[en.id] = 0 }
    for (const e of relationEdges) {
      if (outEdges[e.source] !== undefined) outEdges[e.source].push(e.target)
      if (inDegree[e.target] !== undefined) inDegree[e.target]++
    }
    const level: Record<string, number> = {}
    const queue: string[] = []
    for (const en of entityNodes) {
      if (inDegree[en.id] === 0) { queue.push(en.id); level[en.id] = 0 }
    }
    while (queue.length) {
      const id = queue.shift()!
      for (const tgt of (outEdges[id] ?? [])) {
        if (level[tgt] === undefined) { level[tgt] = (level[id] ?? 0) + 1; queue.push(tgt) }
      }
    }
    const maxLevel = entityNodes.reduce((m, en) => Math.max(m, level[en.id] ?? 0), 0)
    for (const en of entityNodes) { if (level[en.id] === undefined) level[en.id] = maxLevel + 1 }
    const byLevel: Record<number, string[]> = {}
    for (const en of entityNodes) { (byLevel[level[en.id]] ??= []).push(en.id) }
    const GAP_X = 280, GAP_Y = 180
    const posMap: Record<string, { x: number; y: number }> = {}
    for (const [lv, ids] of Object.entries(byLevel)) {
      const lvNum = Number(lv)
      const totalH = (ids.length - 1) * GAP_Y
      ids.forEach((id, j) => {
        posMap[id] = { x: lvNum * GAP_X - CARD_W / 2, y: j * GAP_Y - totalH / 2 - CARD_H / 2 }
      })
    }
    positions = entityNodes.map((en) => posMap[en.id])
  } else {
    // radial: most-connected node at center, others on ring
    const degree: Record<string, number> = {}
    for (const en of entityNodes) degree[en.id] = 0
    for (const e of relationEdges) {
      if (degree[e.source] !== undefined) degree[e.source]++
      if (degree[e.target] !== undefined) degree[e.target]++
    }
    const hubId = entityNodes.reduce((best, en) => degree[en.id] > degree[best.id] ? en : best, entityNodes[0]).id
    const hubIdx = entityNodes.findIndex((en) => en.id === hubId)
    const others = entityNodes.filter((_, j) => j !== hubIdx)
    const R = Math.max(280, (n - 1) * 90)
    positions = entityNodes.map((en, i) => {
      if (i === hubIdx) return { x: -CARD_W / 2, y: -CARD_H / 2 }
      const otherIdx = others.findIndex((o) => o.id === en.id)
      const angle = (otherIdx / Math.max(1, n - 1)) * 2 * Math.PI - Math.PI / 2
      return { x: R * Math.cos(angle) - CARD_W / 2, y: R * Math.sin(angle) - CARD_H / 2 }
    })
  }

  return entityNodes.map((en, i) => {
    const ds = twinDatasets.find((d) => d.entityNodeId === en.id)
    return {
      id: en.id,
      type: 'smartCluster' as const,
      position: positions[i],
      data: { entityNode: en, dataset: ds } satisfies SmartClusterData,
    }
  })
}

function labelColor(label: string): string {
  const palette = TWIN_COLORS
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0xffff
  return palette[h % palette.length]
}

type EntityLookup = Record<string, { color: string; label: string; props: EntityProperty[] }>

function buildEntityLookup(models: OntologyModel[]): EntityLookup {
  const lookup: EntityLookup = {}
  for (const model of models) {
    for (const node of model.nodes) {
      lookup[node.id] = { color: node.data.color, label: node.data.label, props: node.data.properties }
    }
  }
  return lookup
}

function compute2Hop(nodeId: string, rels: Neo4jRelRecord[]) {
  const hop1NodeIds  = new Set<string>()
  const hop1EdgeIds  = new Set<string>()
  for (const r of rels) {
    if (r.startNodeElementId === nodeId) { hop1NodeIds.add(r.endNodeElementId);   hop1EdgeIds.add(r.elementId) }
    else if (r.endNodeElementId === nodeId) { hop1NodeIds.add(r.startNodeElementId); hop1EdgeIds.add(r.elementId) }
  }
  const hop2NodeIds  = new Set<string>()
  const hop2EdgeIds  = new Set<string>()
  for (const r of rels) {
    if (hop1EdgeIds.has(r.elementId)) continue
    if (hop1NodeIds.has(r.startNodeElementId) && r.endNodeElementId !== nodeId && !hop1NodeIds.has(r.endNodeElementId)) {
      hop2NodeIds.add(r.endNodeElementId); hop2EdgeIds.add(r.elementId)
    }
    if (hop1NodeIds.has(r.endNodeElementId) && r.startNodeElementId !== nodeId && !hop1NodeIds.has(r.startNodeElementId)) {
      hop2NodeIds.add(r.startNodeElementId); hop2EdgeIds.add(r.elementId)
    }
  }
  return { hop1NodeIds, hop2NodeIds, hop1EdgeIds, hop2EdgeIds }
}

function computeNeo4jLayout(
  nodes: Neo4jNodeRecord[],
  rels: Neo4jRelRecord[],
  layoutType: LayoutType,
  entityLookup: EntityLookup = {},
) {
  const n = nodes.length
  if (n === 0) return { rfNodes: [], rfEdges: [] as import('@xyflow/react').Edge[] }

  const NW = 180, NH = 120
  let positions: { x: number; y: number }[]

  if (layoutType === 'ring') {
    const R = Math.max(300, n * 120)
    positions = nodes.map((_, i) => {
      const angle = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2
      return { x: R * Math.cos(angle) - NW / 2, y: R * Math.sin(angle) - NH / 2 }
    })
  } else if (layoutType === 'grid') {
    const cols = Math.ceil(Math.sqrt(n))
    const GAP_X = 230, GAP_Y = 160
    const rows = Math.ceil(n / cols)
    const totalW = (cols - 1) * GAP_X, totalH = (rows - 1) * GAP_Y
    positions = nodes.map((_, i) => ({
      x: (i % cols) * GAP_X - totalW / 2 - NW / 2,
      y: Math.floor(i / cols) * GAP_Y - totalH / 2 - NH / 2,
    }))
  } else if (layoutType === 'hierarchy') {
    const outMap: Record<string, string[]> = {}
    const inDeg: Record<string, number> = {}
    for (const nd of nodes) { outMap[nd.elementId] = []; inDeg[nd.elementId] = 0 }
    for (const r of rels) {
      if (outMap[r.startNodeElementId]) outMap[r.startNodeElementId].push(r.endNodeElementId)
      if (inDeg[r.endNodeElementId] !== undefined) inDeg[r.endNodeElementId]++
    }
    const level: Record<string, number> = {}
    const q: string[] = []
    for (const nd of nodes) { if (inDeg[nd.elementId] === 0) { q.push(nd.elementId); level[nd.elementId] = 0 } }
    while (q.length) {
      const id = q.shift()!
      for (const tgt of outMap[id] ?? []) {
        if (level[tgt] === undefined) { level[tgt] = (level[id] ?? 0) + 1; q.push(tgt) }
      }
    }
    const maxLv = nodes.reduce((m, nd) => Math.max(m, level[nd.elementId] ?? 0), 0)
    for (const nd of nodes) { if (level[nd.elementId] === undefined) level[nd.elementId] = maxLv + 1 }
    const byLv: Record<number, string[]> = {}
    for (const nd of nodes) { (byLv[level[nd.elementId]] ??= []).push(nd.elementId) }
    const posMap: Record<string, { x: number; y: number }> = {}
    for (const [lv, ids] of Object.entries(byLv)) {
      const lvNum = Number(lv)
      const totalH = (ids.length - 1) * 160
      ids.forEach((id, j) => { posMap[id] = { x: lvNum * 260 - NW / 2, y: j * 160 - totalH / 2 - NH / 2 } })
    }
    positions = nodes.map((nd) => posMap[nd.elementId])
  } else {
    const deg: Record<string, number> = {}
    for (const nd of nodes) deg[nd.elementId] = 0
    for (const r of rels) {
      if (deg[r.startNodeElementId] !== undefined) deg[r.startNodeElementId]++
      if (deg[r.endNodeElementId] !== undefined) deg[r.endNodeElementId]++
    }
    const hubId = nodes.reduce((best, nd) => deg[nd.elementId] > deg[best.elementId] ? nd : best, nodes[0]).elementId
    const hubIdx = nodes.findIndex((nd) => nd.elementId === hubId)
    const others = nodes.filter((_, j) => j !== hubIdx)
    const R = Math.max(260, (n - 1) * 90)
    positions = nodes.map((nd, i) => {
      if (i === hubIdx) return { x: -NW / 2, y: -NH / 2 }
      const oi = others.findIndex((o) => o.elementId === nd.elementId)
      const angle = (oi / Math.max(1, n - 1)) * 2 * Math.PI - Math.PI / 2
      return { x: R * Math.cos(angle) - NW / 2, y: R * Math.sin(angle) - NH / 2 }
    })
  }

  const isSchemaView = nodes.some((nd) => nd.labels.includes('EntityDef'))

  const rfNodes = nodes.map((nd, i) => {
    if (isSchemaView) {
      let parsedProps: EntityProperty[] = []
      try { parsedProps = JSON.parse(nd.properties.properties as string ?? '[]') } catch {}
      return {
        id: nd.elementId,
        type: 'schemaEntity' as const,
        position: positions[i],
        data: {
          name:          String(nd.properties.name  ?? ''),
          label:         String(nd.properties.label ?? nd.properties.name ?? ''),
          color:         String(nd.properties.color ?? '#4f7bbd'),
          description:   String(nd.properties.description ?? ''),
          entityType:    String(nd.properties.entityType  ?? 'abstract'),
          properties:    parsedProps,
          instanceCount: Number(nd.properties.instanceCount ?? 0),
        } satisfies SmartEntityDefData,
      }
    }
    const entityId   = String(nd.properties._entityDefId ?? '')
    const entityDef  = entityLookup[entityId]
    const color      = entityDef?.color ?? labelColor(nd.labels[0] ?? '')
    const entityLabel = entityDef?.label ?? nd.labels.filter((l) => l !== 'EntityInstance')[0] ?? ''
    const entityProps = entityDef?.props ?? []
    // First non-internal property value as the display name
    const firstPropName = entityProps.length > 0 ? entityProps[0].name : ''
    const displayName = String(
      (firstPropName && nd.properties[firstPropName] != null)
        ? nd.properties[firstPropName]
        : (Object.entries(nd.properties).find(([k, v]) => !k.startsWith('_') && v != null)?.[1] ?? ''),
    )
    return {
      id: nd.elementId,
      type: 'neo4jRecord' as const,
      position: positions[i],
      data: { labels: nd.labels, properties: nd.properties, color, entityLabel, entityProps, displayName, mode: 'simple' as const } satisfies Neo4jRecordNodeData,
    }
  })

  const rfEdges: import('@xyflow/react').Edge[] = rels.map((r) => {
    if (isSchemaView) {
      return {
        id: r.elementId,
        source: r.startNodeElementId,
        target: r.endNodeElementId,
        type: 'relation' as const,
        data: {
          name:             r.type,
          cardinality:      String(r.properties?.cardinality ?? '1:N'),
          relationCategory: r.properties?.relationCategory as string | undefined,
          edgeStyle:        'bezier' as const,
        },
      }
    }
    // Use source entity color for the edge
    const srcNode   = nodes.find((n) => n.elementId === r.startNodeElementId)
    const srcColor  = entityLookup[String(srcNode?.properties._entityDefId ?? '')]?.color ?? '#94a3b8'
    return {
      id: r.elementId,
      source: r.startNodeElementId,
      target: r.endNodeElementId,
      label: r.type,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: srcColor, strokeWidth: 1.5 },
    }
  })

  return { rfNodes, rfEdges }
}

/* ─── Smart App: SmartAppGraph ───────────────────────────────────────────── */

function SmartAppGraph({ layoutType, detailMode }: { layoutType: LayoutType; detailMode: 'simple' | 'detail' }) {
  const allModels            = useSchemaStore((s) => s.models)
  const instanceDatasets     = useSchemaStore((s) => s.instanceDatasets)
  const bizTwins             = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId      = useSchemaStore((s) => s.activeBizTwinId)
  const neo4jGraphData       = useSchemaStore((s) => s.neo4jGraphData)
  const neo4jIsLoading       = useSchemaStore((s) => s.neo4jIsLoading)
  const selectedInstanceId   = useSchemaStore((s) => s.selectedInstanceId)
  const setSelectedInstance  = useSchemaStore((s) => s.setSelectedInstance)

  const activeTwin   = bizTwins.find((t) => t.id === activeBizTwinId)
  const twinDatasets = useMemo(
    () => instanceDatasets[activeBizTwinId ?? ''] ?? [],
    [instanceDatasets, activeBizTwinId],
  )

  const { entityNodes, relationEdges } = useMemo(() => {
    if (!activeTwin) return { entityNodes: [] as EntityNode[], relationEdges: [] as import('@xyflow/react').Edge[] }
    const seen = new Set<string>()
    const en: EntityNode[] = []
    for (const mid of activeTwin.modelIds) {
      const model = allModels.find((m) => m.id === mid)
      if (!model) continue
      for (const n of model.nodes) {
        if (n.type === 'entity' && !seen.has(n.id)) { seen.add(n.id); en.push(n as EntityNode) }
      }
    }
    const seenEdges = new Set<string>()
    const re: import('@xyflow/react').Edge[] = []
    for (const mid of activeTwin.modelIds) {
      const model = allModels.find((m) => m.id === mid)
      if (!model) continue
      for (const e of model.edges) {
        if (!seenEdges.has(e.id)) {
          seenEdges.add(e.id)
          re.push({
            id: e.id,
            source: e.source,
            target: e.target,
            label: (e.data as { label?: string; name?: string })?.label || (e.data as { name?: string })?.name,
            type: 'default',
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#94a3b8', strokeWidth: 1.5 },
          })
        }
      }
    }
    return { entityNodes: en, relationEdges: re }
  }, [activeTwin, allModels])

  const entityLookup = useMemo(() => buildEntityLookup(allModels), [allModels])

  const { computedNodes, computedEdges } = useMemo(() => {
    if (neo4jGraphData) {
      const { rfNodes, rfEdges } = computeNeo4jLayout(neo4jGraphData.nodes, neo4jGraphData.relationships, layoutType, entityLookup)
      return { computedNodes: rfNodes, computedEdges: rfEdges }
    }
    return {
      computedNodes: computeLayout(entityNodes, twinDatasets, relationEdges, layoutType),
      computedEdges: relationEdges,
    }
  }, [neo4jGraphData, entityNodes, twinDatasets, relationEdges, layoutType, entityLookup])

  const [rfNodes, setRfNodes] = useState<import('@xyflow/react').Node[]>(computedNodes)
  const [rfEdges, setRfEdges] = useState<import('@xyflow/react').Edge[]>(computedEdges)

  useEffect(() => { setRfNodes(computedNodes) }, [computedNodes])
  useEffect(() => { setRfEdges(computedEdges) }, [computedEdges])

  // Apply detailMode to all instance nodes
  const modeNodes = useMemo(() =>
    rfNodes.map((n) => n.type === 'neo4jRecord'
      ? { ...n, data: { ...(n.data as Neo4jRecordNodeData), mode: detailMode } }
      : n,
    ),
    [rfNodes, detailMode],
  )

  // Apply highlight/dim based on selectedInstanceId + 2-hop
  const displayNodes = useMemo(() => {
    if (!selectedInstanceId || !neo4jGraphData) return modeNodes
    const { hop1NodeIds, hop2NodeIds } = compute2Hop(selectedInstanceId, neo4jGraphData.relationships)
    return modeNodes.map((n) => {
      if (n.id === selectedInstanceId)  return { ...n, className: 'inst-selected' }
      if (hop1NodeIds.has(n.id))        return { ...n, className: 'inst-hop1' }
      if (hop2NodeIds.has(n.id))        return { ...n, className: 'inst-hop2' }
      return { ...n, className: 'inst-dimmed' }
    })
  }, [modeNodes, selectedInstanceId, neo4jGraphData])

  const displayEdges = useMemo(() => {
    if (!selectedInstanceId || !neo4jGraphData) return rfEdges
    const { hop1EdgeIds, hop2EdgeIds } = compute2Hop(selectedInstanceId, neo4jGraphData.relationships)
    return rfEdges.map((e) => {
      if (hop1EdgeIds.has(e.id)) return { ...e, style: { ...(e.style ?? {}), stroke: '#f97316', strokeWidth: 2, opacity: 1 } }
      if (hop2EdgeIds.has(e.id)) return { ...e, style: { ...(e.style ?? {}), stroke: '#fbbf24', strokeWidth: 1.5, opacity: 1 } }
      return { ...e, style: { ...(e.style ?? {}), opacity: 0.15 } }
    })
  }, [rfEdges, selectedInstanceId, neo4jGraphData])

  if (neo4jIsLoading) {
    return (
      <div className="grid-empty">
        <Database size={36} strokeWidth={1} style={{ color: 'var(--accent-blue)' }} />
        <p>正在加载图谱数据…</p>
      </div>
    )
  }

  if (!activeTwin && !neo4jGraphData) {
    return (
      <div className="grid-empty">
        <Bot size={40} strokeWidth={1} />
        <p>请从左侧选择一个业务孪生</p>
      </div>
    )
  }

  if (!neo4jGraphData && entityNodes.length === 0) {
    return (
      <div className="grid-empty">
        <Bot size={40} strokeWidth={1} />
        <p>当前孪生绑定的模型尚无实体定义</p>
      </div>
    )
  }

  const showNoRelHint = neo4jGraphData
    && neo4jGraphData.nodes.length > 0
    && neo4jGraphData.relationships.length === 0

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={smartNodeTypes}
          edgeTypes={smartEdgeTypes}
          onNodesChange={(changes) => setRfNodes((cur) => applyNodeChanges(changes, cur) as typeof cur)}
          onNodeClick={(_, node) => setSelectedInstance(node.id === selectedInstanceId ? null : node.id)}
          onPaneClick={() => setSelectedInstance(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background />
          <Controls />
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
          {showNoRelHint && (
            <div style={{
              position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(251,191,36,0.95)', color: '#78350f', borderRadius: 8,
              padding: '8px 16px', fontSize: 12, lineHeight: 1.6, zIndex: 10,
              maxWidth: 420, textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}>
              ⚠️ 已加载 {neo4jGraphData!.nodes.length} 个实例节点，但关系数为 0。<br />
              请确认：① 关系定义已配置「源/目标实例字段（sourceKey/targetKey）」；② 点击上方「建立实例关系」按钮
            </div>
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

/* ─── Smart App: Instance Property Panel ────────────────────────────────── */

function InstancePropertyPanel() {
  const neo4jGraphData      = useSchemaStore((s) => s.neo4jGraphData)
  const allModels           = useSchemaStore((s) => s.models)
  const selectedInstanceId  = useSchemaStore((s) => s.selectedInstanceId)
  const setSelectedInstance = useSchemaStore((s) => s.setSelectedInstance)

  const [search, setSearch] = useState('')

  const entityLookup = useMemo(() => buildEntityLookup(allModels), [allModels])

  const allNodes = neo4jGraphData?.nodes ?? []

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allNodes.filter((n) => !n.labels.includes('EntityDef'))
    return allNodes.filter((n) => {
      if (n.labels.includes('EntityDef')) return false
      return Object.values(n.properties).some(
        (v) => v != null && String(v).toLowerCase().includes(q),
      )
    })
  }, [allNodes, search])

  const selectedNode = allNodes.find((n) => n.elementId === selectedInstanceId) ?? null
  const selectedEntityDef = selectedNode
    ? entityLookup[String(selectedNode.properties._entityDefId ?? '')]
    : null

  return (
    <div className="inst-prop-panel">
      {/* Search */}
      <div className="inst-prop-search-row">
        <Search size={13} className="inst-prop-search-icon" />
        <input
          className="inst-prop-search"
          placeholder="搜索实例属性值…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="btn-ghost" style={{ padding: '2px 4px' }} onClick={() => setSearch('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* Selected instance details */}
      {selectedNode && (
        <div className="inst-prop-detail">
          <div
            className="inst-prop-detail-header"
            style={{ background: selectedEntityDef?.color ?? '#64748b' }}
          >
            <span className="inst-prop-entity-label">{selectedEntityDef?.label || selectedNode.labels.filter((l) => l !== 'EntityInstance')[0] || ''}</span>
            <button type="button" className="inst-prop-clear" onClick={() => setSelectedInstance(null)} title="取消选中">
              <X size={12} />
            </button>
          </div>
          <div className="inst-prop-detail-body">
            {selectedEntityDef?.props && selectedEntityDef.props.length > 0
              ? selectedEntityDef.props.map((p) => {
                  const val = selectedNode.properties[p.name]
                  return (
                    <div key={p.id} className="inst-prop-row">
                      <span className="inst-prop-key">{p.nameZh || p.name}</span>
                      <span className="inst-prop-val">{val != null ? String(val) : '—'}</span>
                    </div>
                  )
                })
              : Object.entries(selectedNode.properties)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([k, v]) => (
                    <div key={k} className="inst-prop-row">
                      <span className="inst-prop-key">{k}</span>
                      <span className="inst-prop-val">{v != null ? String(v) : '—'}</span>
                    </div>
                  ))
            }
          </div>
        </div>
      )}

      {/* Search results list */}
      {!selectedNode && (
        <div className="inst-prop-list">
          {filteredNodes.length === 0 && (
            <div className="inst-prop-empty">
              {neo4jGraphData ? (search ? '无匹配结果' : '暂无实例数据') : '请先加载实例图谱'}
            </div>
          )}
          {filteredNodes.map((node) => {
            const entityDef = entityLookup[String(node.properties._entityDefId ?? '')]
            const label = entityDef?.label || node.labels.filter((l) => l !== 'EntityInstance')[0] || ''
            const firstProp = entityDef?.props[0]
            const name = firstProp
              ? String(node.properties[firstProp.name] ?? '')
              : String(Object.entries(node.properties).find(([k, v]) => !k.startsWith('_') && v != null)?.[1] ?? '')
            return (
              <button
                key={node.elementId}
                type="button"
                className={`inst-prop-item${selectedInstanceId === node.elementId ? ' active' : ''}`}
                onClick={() => setSelectedInstance(
                  selectedInstanceId === node.elementId ? null : node.elementId,
                )}
              >
                <span
                  className="inst-prop-dot"
                  style={{ background: entityDef?.color ?? '#64748b' }}
                />
                <span className="inst-prop-item-label">{label}</span>
                <span className="inst-prop-item-name">{name || '—'}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Back to list when detail is shown */}
      {selectedNode && (
        <button
          type="button"
          className="btn-ghost inst-prop-back"
          onClick={() => setSelectedInstance(null)}
        >
          ← 返回列表
        </button>
      )}
    </div>
  )
}

/* ─── Smart App: SmartAiPanel ────────────────────────────────────────────── */

const SMART_AI_MODES = [
  {
    id:         'insight',
    icon:       '🔍',
    label:      '数据分析',
    description:'AI 自动调用专属技能查询真实实例数据，交互式逐问分析',
    useSkills:  true,
    placeholder:'描述你的分析需求，AI 将查询图谱后作答…',
    quickPrompts: [
      '出差次数最多的员工是谁？',
      '哪个部门出差最频繁？',
      '交通方式的分布情况如何？',
    ],
  },
  {
    id:         'report',
    icon:       '📊',
    label:      '分析报告',
    description:'AI 自动调用全部专属技能收集真实数据，生成完整结构化分析报告',
    useSkills:  true,
    placeholder:'描述报告需求，AI 将查询数据后生成报告…',
    quickPrompts: [
      '生成差旅费用管理综合分析报告',
      '生成各部门出差情况对比报告',
      '分析出差费用异常情况并给出建议',
    ],
  },
] as const

type SmartAiModeId = typeof SMART_AI_MODES[number]['id']

function ModelSkillsPanel() {
  const { data: skills = [], isLoading } = useSkills()
  const toggleSkill = useToggleSkill()
  const queryClient = useQueryClient()
  const [editingSkill, setEditing] = useState<Skill | null>(null)

  const modelSkills = useMemo(() => skills.filter((s) => !s.isBuiltIn), [skills])

  async function handleExportBundle() {
    try {
      const bundle = await api.exportSkillBundle()
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `skills-bundle-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
    } catch { alert('导出失败，请稍后重试') }
  }

  function handleImportBundle() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      try {
        const parsed = JSON.parse(await file.text())
        const bundleSkills: unknown[] = parsed.skills ?? (Array.isArray(parsed) ? parsed : [parsed])
        if (bundleSkills.length === 0) { alert('技能包为空'); return }
        const result = await api.importSkillBundle(bundleSkills)
        alert(`导入完成：新增 ${result.imported} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条（内置）`
          + (result.errors.length ? `\n失败：${result.errors.join('\n')}` : ''))
        void queryClient.invalidateQueries({ queryKey: ['skills'] })
      } catch { alert('技能包解析失败，请确认文件格式正确') }
    }
    input.click()
  }

  if (isLoading) return (
    <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)' }}>加载中…</div>
  )
  if (modelSkills.length === 0) return (
    <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
      暂无专属技能，点击「生成专属技能」自动生成
    </div>
  )

  return (
    <>
      <div className="skill-bundle-bar">
        <button type="button" className="skill-bundle-btn" onClick={handleExportBundle}
          title="将所有专属技能导出为 JSON 包，可导入到其他同本体系统">
          <FileDown size={12} /> 导出技能包
        </button>
        <button type="button" className="skill-bundle-btn" onClick={handleImportBundle}
          title="从技能包 JSON 文件批量导入或更新专属技能">
          <Upload size={12} /> 导入技能包
        </button>
      </div>
      <div className="skill-list">
        {modelSkills.map((skill) => (
          <div key={skill.id} className={`skill-row${skill.enabled ? '' : ' skill-row-disabled'}`}>
            <button
              type="button"
              className="skill-toggle"
              title={skill.enabled ? '点击禁用' : '点击启用'}
              onClick={() => toggleSkill.mutate({ id: skill.id, enabled: !skill.enabled })}
            >
              {skill.enabled
                ? <ToggleRight size={20} className="toggle-on" />
                : <ToggleLeft  size={20} className="toggle-off" />}
            </button>
            <div className="skill-row-info">
              <span className="skill-row-name">{skill.name}</span>
              <span className="skill-row-desc">{skill.description}</span>
            </div>
            <div className="skill-row-actions">
              <button type="button" className="icon-btn" title="编辑" onClick={() => setEditing(skill)}>
                <Pencil size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {editingSkill && (
        <SkillEditorModal skill={editingSkill} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function SmartAiPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const smartChatMsgs      = useSchemaStore((s) => s.smartChatMsgs)
  const isSmartChatLoading = useSchemaStore((s) => s.isSmartChatLoading)
  const sendSmartMessage   = useSchemaStore((s) => s.sendSmartMessage)
  const clearSmartChat     = useSchemaStore((s) => s.clearSmartChat)
  const aiServices         = useSchemaStore((s) => s.aiServices)
  const activeAiServiceId  = useSchemaStore((s) => s.activeAiServiceId)
  const setActiveAiService = useSchemaStore((s) => s.setActiveAiService)
  const allModels          = useSchemaStore((s) => s.models)
  const bizTwins           = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId    = useSchemaStore((s) => s.activeBizTwinId)

  const schemaCtx = useMemo(() => {
    const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)
    const twinNodes: EntityNode[] = []
    const twinEdges: RelationEdge[] = []
    const seen = new Set<string>()
    for (const mid of activeTwin?.modelIds ?? []) {
      const model = allModels.find((m) => m.id === mid)
      for (const n of model?.nodes ?? []) {
        if (n.type === 'entity' && !seen.has(n.id)) { seen.add(n.id); twinNodes.push(n as EntityNode) }
      }
      for (const e of model?.edges ?? []) {
        if (!seen.has(e.id)) { seen.add(e.id); twinEdges.push(e as RelationEdge) }
      }
    }
    return buildSchemaContext(twinNodes, twinEdges)
  }, [bizTwins, activeBizTwinId, allModels])

  const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)
  const activeModelId = activeTwin?.modelIds?.[0] ?? null

  const [input, setInput]         = useState('')
  const [activeMode, setActiveMode] = useState<SmartAiModeId>('insight')
  const [isRegenerating, setIsRegenerating]   = useState(false)
  const [regenMsg, setRegenMsg]               = useState<string | null>(null)
  const [isGenModelSkills, setIsGenModelSkills] = useState(false)
  const [modelSkillsLog, setModelSkillsLog]   = useState<string[]>([])
  const [showSkillList, setShowSkillList]     = useState(false)
  const [rightTab, setRightTab]               = useState<'ai' | 'props'>('ai')
  const messagesEndRef            = useRef<HTMLDivElement>(null)

  const mode        = SMART_AI_MODES.find((m) => m.id === activeMode)!
  const activeService = aiServices.find((s) => s.id === activeAiServiceId)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [smartChatMsgs])

  function handleSend(text?: string) {
    const t = (text ?? input).trim()
    if (!t || isSmartChatLoading) return
    if (!text) setInput('')
    sendSmartMessage(t, mode.useSkills, mode.id === 'report')
  }

  async function handleRegenerateSkills() {
    if (!activeService) { setRegenMsg('请先选择大模型服务'); return }
    setIsRegenerating(true)
    setRegenMsg(null)
    try {
      const resp = await fetch('/api/ai/regenerate-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaContext: JSON.stringify(schemaCtx, null, 2),
          twinId:   activeBizTwinId,
          aiConfig: {
            provider: activeService.provider,
            baseUrl:  activeService.baseUrl ?? '',
            model:    activeService.model,
            apiKey:   activeService.apiKey,
          },
        }),
      })
      const data = await resp.json()
      if (resp.ok) {
        setRegenMsg(`已更新 ${data.updated}/${data.total} 个技能`)
      } else {
        setRegenMsg(`失败：${data.error}`)
      }
    } catch (e) {
      setRegenMsg(`请求错误：${String(e)}`)
    } finally {
      setIsRegenerating(false)
    }
  }

  async function handleGenModelSkills() {
    if (!activeService || !activeModelId) return
    setIsGenModelSkills(true)
    setModelSkillsLog([])
    try {
      const resp = await fetch('/api/ai/generate-model-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: activeModelId,
          twinId:  activeBizTwinId ?? undefined,
          aiConfig: {
            provider: activeService.provider,
            baseUrl:  activeService.baseUrl ?? '',
            model:    activeService.model,
            apiKey:   activeService.apiKey,
          },
        }),
      })
      const reader = resp.body?.getReader()
      if (!reader) { setModelSkillsLog(['请求失败，无响应体']); return }
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (raw === '[DONE]') break
          try {
            const evt = JSON.parse(raw)
            if (evt.type === 'progress')   setModelSkillsLog((l) => [...l, `⏳ ${evt.message}`])
            if (evt.type === 'skill_ok')   setModelSkillsLog((l) => [...l, `✓ ${evt.toolName}：${evt.description}`])
            if (evt.type === 'skill_warn') setModelSkillsLog((l) => [...l, `⚠ ${evt.toolName}（Cypher 警告）`])
            if (evt.type === 'done')       setModelSkillsLog((l) => [...l, `✅ 完成：已保存 ${evt.saved}/${evt.total} 个专属技能`])
            if (evt.type === 'error')      setModelSkillsLog((l) => [...l, `❌ ${evt.message}`])
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      setModelSkillsLog((l) => [...l, `请求错误：${String(e)}`])
    } finally {
      setIsGenModelSkills(false)
    }
  }

  if (collapsed) {
    return (
      <div className="smart-ai-panel smart-ai-panel-collapsed">
        <button type="button" className="smart-ai-toggle" onClick={onToggle} title="展开 AI 对话">
          <Bot size={18} />
        </button>
      </div>
    )
  }

  return (
    <div className="smart-ai-panel smart-ai-panel-expanded">
      {/* ── Header ── */}
      <div className="smart-ai-header">
        {rightTab === 'ai' ? <Bot size={15} /> : <Search size={15} />}
        <span>{rightTab === 'ai' ? 'AI 分析助手' : '属性栏'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {rightTab === 'ai' && smartChatMsgs.length > 0 && (
            <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={clearSmartChat}>
              清空
            </button>
          )}
          <button type="button" className="smart-ai-toggle" onClick={onToggle} title="折叠面板">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* ── 面板页签 ── */}
      <div className="smart-panel-tabs">
        <button
          type="button"
          className={`smart-panel-tab${rightTab === 'ai' ? ' active' : ''}`}
          onClick={() => setRightTab('ai')}
        >
          <Bot size={12} /> AI 助手
        </button>
        <button
          type="button"
          className={`smart-panel-tab${rightTab === 'props' ? ' active' : ''}`}
          onClick={() => setRightTab('props')}
        >
          <Search size={12} /> 属性栏
        </button>
      </div>

      {rightTab === 'props' && <InstancePropertyPanel />}

      {rightTab === 'ai' && <>
      {/* ── 模式 tab ── */}
      <div className="smart-ai-mode-tabs">
        {SMART_AI_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`smart-ai-mode-tab${activeMode === m.id ? ' active' : ''}`}
            title={m.description}
            onClick={() => setActiveMode(m.id)}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* ── Schema 上下文预览 ── */}
      <details className="schema-ctx-preview">
        <summary>
          当前 Schema 上下文（{schemaCtx.entities.length} 实体 · {schemaCtx.relations.length} 关系）
        </summary>
        <pre>{JSON.stringify(schemaCtx, null, 2)}</pre>
      </details>

      {/* ── 技能管理工具栏 ── */}
      <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
            disabled={isRegenerating || !activeService}
            onClick={handleRegenerateSkills}
            title="重新生成通用技能的 Cypher（与模型无关的内置技能）"
          >
            <RefreshCw size={11} style={isRegenerating ? { animation: 'spin 1s linear infinite' } : {}} />
            {isRegenerating ? '生成中…' : '重新生成通用技能'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ fontSize: 11, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4, color: activeModelId ? 'var(--primary)' : undefined }}
            disabled={isGenModelSkills || !activeService || !activeModelId}
            onClick={handleGenModelSkills}
            title={activeModelId ? `为当前本体模型（${activeModelId}）生成专属分析技能` : '请先选择包含本体模型的业务孪生'}
          >
            <Sparkles size={11} style={isGenModelSkills ? { animation: 'spin 1s linear infinite' } : {}} />
            {isGenModelSkills ? '生成专属技能…' : '生成专属技能'}
          </button>
          {regenMsg && <span style={{ fontSize: 11, color: regenMsg.startsWith('失败') ? 'var(--error)' : 'var(--text-muted)' }}>{regenMsg}</span>}
        </div>
        {modelSkillsLog.length > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted)', maxHeight: 80, overflowY: 'auto' }}>
            {modelSkillsLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
        <button
          type="button"
          className="btn-ghost smart-skill-list-toggle"
          onClick={() => setShowSkillList((v) => !v)}
        >
          <Zap size={11} /> 专属技能清单 {showSkillList ? '▴' : '▾'}
        </button>
      </div>

      {showSkillList && (
        <div className="smart-skill-list-panel">
          <ModelSkillsPanel />
        </div>
      )}

      {/* ── 模型服务选择器 ── */}
      <div className="smart-ai-service-bar">
        <Sparkles size={12} className="smart-ai-service-icon" />
        {aiServices.length === 0 ? (
          <span className="smart-ai-service-empty">未配置大模型服务，请前往「模型工场 → 大模型服务」添加</span>
        ) : (
          <select
            className="smart-ai-service-select"
            value={activeAiServiceId ?? ''}
            onChange={(e) => setActiveAiService(e.target.value || null)}
          >
            {!activeAiServiceId && <option value="">— 选择服务 —</option>}
            {aiServices.map((svc) => (
              <option key={svc.id} value={svc.id}>
                {svc.name}（{svc.model}）
              </option>
            ))}
          </select>
        )}
        {activeService && (
          <span className="smart-ai-service-badge">
            {activeService.provider === 'anthropic' ? 'Anthropic' : '兼容'}
            {mode.useSkills && <span style={{ marginLeft: 4, opacity: 0.7 }}>· 工具</span>}
          </span>
        )}
      </div>

      {/* ── 消息列表 ── */}
      <div className="smart-ai-messages">
        {smartChatMsgs.length === 0 && (
          <div className="smart-ai-welcome">
            <span style={{ fontSize: 28 }}>{mode.icon}</span>
            <strong style={{ fontSize: 13 }}>{mode.label}</strong>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>{mode.description}</p>
            {mode.id === 'report' && (
              <button
                type="button"
                className="smart-report-auto-btn"
                onClick={() => handleSend(
                  '请依次调用所有专属数据查询技能，收集各项数据后生成一份完整的业务分析报告，包含执行摘要、关键发现、风险与建议。'
                )}
              >
                ⚡ 一键生成综合分析报告
              </button>
            )}
            <div className="smart-ai-prompts">
              {mode.quickPrompts.map((p) => (
                <button key={p} type="button" className="smart-ai-prompt-chip"
                  onClick={() => handleSend(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {smartChatMsgs.map((msg) => (
          <div key={msg.id} className={`smart-chat-msg smart-chat-msg-${msg.role}`}>
            <div className="smart-chat-bubble">{msg.content}</div>
          </div>
        ))}
        {isSmartChatLoading && (
          <div className="smart-chat-msg smart-chat-msg-assistant">
            <div className="smart-chat-bubble smart-chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 输入区 ── */}
      <div className="smart-ai-input-row">
        <textarea
          className="smart-ai-input"
          placeholder={mode.placeholder}
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
        />
        <button
          type="button"
          className="btn-primary"
          style={{ flexShrink: 0, padding: '6px 12px' }}
          disabled={!input.trim() || isSmartChatLoading}
          onClick={() => handleSend()}
        >
          <Send size={14} />
        </button>
      </div>
      </>}
    </div>
  )
}

/* ─── ODL Editor ─────────────────────────────────────────────────────────── */

function OdlEditorView() {
  const models       = useSchemaStore((s) => s.models)
  const activeModelId = useSchemaStore((s) => s.activeModelId)
  const nodes        = useSchemaStore((s) => s.nodes)
  const saveOdl      = useSchemaStore((s) => s.saveOdl)

  const activeModel = models.find((m) => m.id === activeModelId)
  const [yaml, setYaml] = useState(activeModel?.odl ?? '')
  const [saved, setSaved] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [testResult, setTestResult] = useState<{ rows?: unknown[]; error?: string } | null>(null)
  const [testCypher, setTestCypher] = useState('')
  const [testRunning, setTestRunning] = useState(false)

  // Sync editor when model changes
  useEffect(() => {
    setYaml(activeModel?.odl ?? '')
    setSaved(true)
    setErrors([])
    setWarnings([])
  }, [activeModelId, activeModel?.odl])

  const validate = useCallback(() => {
    const errs: string[] = []
    const warns: string[] = []

    // Syntax check
    try {
      const obj = parseOdlYaml(yaml)
      if (!obj || typeof obj !== 'object') {
        errs.push('YAML 格式错误：根节点必须是对象')
      } else {
        const entityLabels = new Set(nodes.map((n) => n.data.label))

        // Check concept maps_to_node
        const concepts = (obj as any).concepts ?? []
        for (const c of concepts) {
          if (c.maps_to_node && !entityLabels.has(c.maps_to_node)) {
            warns.push(`概念 "${c.concept_id ?? c.display_name}"：maps_to_node "${c.maps_to_node}" 在当前 Schema 中不存在`)
          }
        }

        // Check query_templates required fields
        const templates = (obj as any).query_templates ?? []
        for (const t of templates) {
          if (!t.intent_id) errs.push(`query_templates 中存在缺少 intent_id 的条目`)
          if (!t.cypher_template) warns.push(`意图模板 "${t.intent_id ?? '?'}" 缺少 cypher_template`)
        }
      }
    } catch (e) {
      errs.push(`YAML 解析失败：${e instanceof Error ? e.message : String(e)}`)
    }

    setErrors(errs)
    setWarnings(warns)
    return errs.length === 0
  }, [yaml, nodes])

  const handleSave = useCallback(async () => {
    if (!validate()) return
    setSaving(true)
    try {
      await saveOdl(yaml)
      setSaved(true)
    } catch (e) {
      setErrors([`保存失败：${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setSaving(false)
    }
  }, [yaml, validate, saveOdl])

  const handleRunCypher = useCallback(async () => {
    if (!testCypher.trim()) return
    setTestRunning(true)
    setTestResult(null)
    try {
      const result = await import('./lib/api').then(({ api }) => api.runCypherQuery(testCypher))
      setTestResult({ rows: result.rows })
    } catch (e) {
      setTestResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTestRunning(false)
    }
  }, [testCypher])

  return (
    <div className="odl-editor-view">
      <div className="odl-editor-header">
        <div className="odl-editor-title">
          <BookOpen size={16} />
          <span>ODL 知识层编辑器</span>
          <span className="odl-model-badge">{activeModel?.name ?? '—'}</span>
        </div>
        <div className="odl-editor-actions">
          <button type="button" className="odl-btn odl-btn-secondary" onClick={validate}>
            <CheckCircle size={14} />
            验证
          </button>
          <button
            type="button"
            className="odl-btn odl-btn-secondary"
            disabled={!yaml.trim()}
            onClick={() => {
              const blob = new Blob([yaml], { type: 'text/yaml' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${activeModel?.name ?? 'odl'}.odl.yaml`
              a.click()
              URL.revokeObjectURL(url)
            }}
            title="下载为本地 YAML 文件"
          >
            <Download size={14} />
            下载
          </button>
          <button
            type="button"
            className={`odl-btn odl-btn-primary${saving ? ' odl-btn-loading' : ''}`}
            onClick={handleSave}
            disabled={saving || saved}
          >
            <Save size={14} />
            {saving ? '保存中…' : saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>

      <div className="odl-editor-body">
        <div className="odl-editor-main">
          <textarea
            className="odl-yaml-editor"
            value={yaml}
            onChange={(e) => { setYaml(e.target.value); setSaved(false) }}
            placeholder={ODL_PLACEHOLDER}
            spellCheck={false}
          />
        </div>

        <div className="odl-editor-panel">
          {/* Validation results */}
          <div className="odl-panel-section">
            <div className="odl-panel-title">验证结果</div>
            {errors.length === 0 && warnings.length === 0 ? (
              <div className="odl-validation-ok">点击「验证」检查 ODL 内容</div>
            ) : (
              <>
                {errors.map((e, i) => (
                  <div key={i} className="odl-validation-error">
                    <AlertTriangle size={12} />
                    {e}
                  </div>
                ))}
                {warnings.map((w, i) => (
                  <div key={i} className="odl-validation-warning">
                    <AlertCircle size={12} />
                    {w}
                  </div>
                ))}
                {errors.length === 0 && (
                  <div className="odl-validation-pass">
                    <CheckCircle size={12} />
                    语法正确，{warnings.length} 个 Schema 一致性警告
                  </div>
                )}
              </>
            )}
          </div>

          {/* Cypher template test */}
          <div className="odl-panel-section">
            <div className="odl-panel-title">Cypher 模板试运行</div>
            <textarea
              className="odl-cypher-input"
              value={testCypher}
              onChange={(e) => setTestCypher(e.target.value)}
              placeholder="粘贴 query_templates 中的 Cypher，填入实际参数后执行…"
              rows={4}
            />
            <button
              type="button"
              className={`odl-btn odl-btn-primary odl-btn-block${testRunning ? ' odl-btn-loading' : ''}`}
              onClick={handleRunCypher}
              disabled={testRunning || !testCypher.trim()}
            >
              <Play size={13} />
              {testRunning ? '执行中…' : '▶ 执行'}
            </button>
            {testResult && (
              <div className="odl-test-result">
                {testResult.error ? (
                  <div className="odl-validation-error">{testResult.error}</div>
                ) : (
                  <div className="odl-test-rows">
                    返回 {(testResult.rows ?? []).length} 行
                    {(testResult.rows ?? []).slice(0, 5).map((row, i) => (
                      <pre key={i} className="odl-test-row">{JSON.stringify(row, null, 2)}</pre>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function parseOdlYaml(text: string): unknown {
  if (!text.trim()) return {}
  // Simple YAML object parse: try JSON first (for JSON-mode), then naive YAML check
  try { return JSON.parse(text) } catch { /* not JSON */ }
  // Verify it looks like valid YAML by checking for known parse errors
  // We use a basic structural check since we don't have a YAML library
  if (text.includes('\t')) {
    throw new Error('YAML 中不允许使用 Tab 缩进，请使用空格')
  }
  // Return a token object so validation can at least run basic checks
  // Full YAML parsing would require js-yaml, which is not in package.json
  return { _raw: text, concepts: extractYamlList(text, 'concepts'), query_templates: extractYamlList(text, 'query_templates') }
}

function extractYamlList(yaml: string, key: string): Array<Record<string, string>> {
  // Naive extraction of top-level list items under a key for basic validation
  const results: Array<Record<string, string>> = []
  const keyPattern = new RegExp(`^${key}:`, 'm')
  if (!keyPattern.test(yaml)) return results
  const lines = yaml.split('\n')
  let inSection = false
  let currentItem: Record<string, string> | null = null
  for (const line of lines) {
    if (line.match(new RegExp(`^${key}:`))) { inSection = true; continue }
    if (inSection && line.match(/^\w/) && !line.match(/^\s/)) { inSection = false }
    if (!inSection) continue
    if (line.match(/^\s+- /)) {
      if (currentItem) results.push(currentItem)
      currentItem = {}
    } else if (currentItem && line.match(/^\s+\w+:/)) {
      const m = line.match(/^\s+(\w+):\s*(.*)$/)
      if (m) currentItem[m[1]] = m[2]
    }
  }
  if (currentItem) results.push(currentItem)
  return results
}

const ODL_PLACEHOLDER = `# ODL（企业经营知识层）
# 参考格式：template/sample-data/files/odl.yaml

ontology:
  domain: 业务域名称
  version: "1.0"
  schema_ref: schema.json

concepts:
  - concept_id: example_concept
    maps_to_node: EntityLabel
    display_name: 业务概念名称
    synonyms: ["同义词1", "同义词2"]
    description: 该概念的业务含义

metrics:
  - metric_id: example_metric
    display_name: 指标名称
    synonyms: ["别名1", "别名2"]
    canonical_formula:
      node: EntityLabel
      field: field_name
      aggregation: SUM

disambiguation_rules:
  - rule_id: example_rule
    description: 描述歧义场景
    trigger_keywords: ["关键词1", "关键词2"]
    action: 消解方式说明

query_templates:
  - intent_id: example_intent
    description: 意图描述
    parameters:
      - name: param_name
        maps_to: Entity.field
    cypher_template: >
      MATCH (n:Entity { field: $param_name })
      RETURN n LIMIT 10

data_quality_rules:
  - field_pattern: "占位值"
    applies_to:
      - Entity.field
    treatment: 视为空值，不参与统计
`

/* ─── Smart App: SmartAppView ────────────────────────────────────────────── */

const DEFAULT_CYPHER = 'MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 200'

function SmartAppView() {
  const bizTwins            = useSchemaStore((s) => s.bizTwins)
  const activeBizTwinId     = useSchemaStore((s) => s.activeBizTwinId)
  const neo4jError          = useSchemaStore((s) => s.neo4jError)
  const neo4jIsLoading      = useSchemaStore((s) => s.neo4jIsLoading)
  const neo4jGraphData      = useSchemaStore((s) => s.neo4jGraphData)
  const queryNeo4jViaApi    = useSchemaStore((s) => s.queryNeo4jViaApi)
  const querySchemaOverview = useSchemaStore((s) => s.querySchemaOverview)
  const relinkInstances     = useSchemaStore((s) => s.relinkInstances)

  const [aiCollapsed, setAiCollapsed]       = useState(false)
  const [layoutType, setLayoutType]         = useState<LayoutType>('ring')
  const [queryPanelOpen, setQueryPanelOpen] = useState(false)
  const [formCypher, setFormCypher]         = useState(DEFAULT_CYPHER)
  const [graphMode, setGraphMode]           = useState<'schema' | 'instance'>('schema')
  const [detailMode, setDetailMode]         = useState<'simple' | 'detail'>('simple')
  const [relinkMsg, setRelinkMsg]           = useState<string | null>(null)

  const activeTwin = bizTwins.find((t) => t.id === activeBizTwinId)

  // Auto-load graph when twin or mode changes
  useEffect(() => {
    if (!activeBizTwinId) return
    if (graphMode === 'schema') {
      querySchemaOverview(activeBizTwinId)
    } else {
      queryNeo4jViaApi(undefined, activeBizTwinId)
    }
  }, [activeBizTwinId, graphMode, querySchemaOverview, queryNeo4jViaApi])

  function handleRequery() {
    queryNeo4jViaApi(formCypher.trim() || undefined, activeBizTwinId ?? undefined)
    setQueryPanelOpen(false)
  }

  async function handleRelink() {
    if (!activeBizTwinId) return
    setRelinkMsg(null)
    const result = await relinkInstances(activeBizTwinId)
    if (result) {
      setRelinkMsg(`已创建 ${result.created} 条实例关系（匹配 ${result.linked} 个RelDef）`)
      // Refresh instance view
      await queryNeo4jViaApi(undefined, activeBizTwinId)
    }
  }

  return (
    <div className="smart-app-shell">
      <div className="smart-app-topbar">
        <div className="smart-app-twin-info">
          {activeTwin ? (
            <>
              <div className="twin-avatar twin-avatar-sm" style={{ background: activeTwin.color }}>
                {activeTwin.name[0]}
              </div>
              <span className="smart-app-twin-name">{activeTwin.name}</span>
              <span className="model-tag">图谱浏览</span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>请从左侧选择业务孪生</span>
          )}
        </div>
        <div className="smart-layout-tabs">
          {LAYOUT_OPTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`smart-layout-btn${layoutType === key ? ' active' : ''}`}
              onClick={() => setLayoutType(key)}
              title={label}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 12, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {neo4jGraphData && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {neo4jGraphData.nodes.length} 节点 · {neo4jGraphData.relationships.length} 关系
            </span>
          )}
          {/* 视图模式切换 */}
          <div className="smart-layout-tabs">
            <button type="button"
              className={`smart-layout-btn${graphMode === 'schema' ? ' active' : ''}`}
              onClick={() => setGraphMode('schema')} title="本体结构（EntityDef + RelDef）">
              <Network size={12} /> 本体结构
            </button>
            <button type="button"
              className={`smart-layout-btn${graphMode === 'instance' ? ' active' : ''}`}
              onClick={() => setGraphMode('instance')} title="实例图谱（EntityInstance节点）">
              <Database size={12} /> 实例图谱
            </button>
          </div>
          {graphMode === 'instance' && (
            <>
              <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
                title="根据RelDef外键配置建立实例间关系"
                disabled={neo4jIsLoading} onClick={handleRelink}>
                <Link size={13} /> 建立实例关系
              </button>
              <div className="smart-layout-tabs">
                <button type="button"
                  className={`smart-layout-btn${detailMode === 'simple' ? ' active' : ''}`}
                  onClick={() => setDetailMode('simple')}>
                  简洁
                </button>
                <button type="button"
                  className={`smart-layout-btn${detailMode === 'detail' ? ' active' : ''}`}
                  onClick={() => setDetailMode('detail')}>
                  详细
                </button>
              </div>
            </>
          )}
          <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
            disabled={neo4jIsLoading}
            onClick={graphMode === 'instance' ? () => setQueryPanelOpen(true) : () => activeBizTwinId && querySchemaOverview(activeBizTwinId)}>
            <RotateCcw size={13} /> {neo4jIsLoading ? '加载中…' : '刷新'}
          </button>
        </div>
        {aiCollapsed && (
          <button type="button" className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }}
            onClick={() => setAiCollapsed(false)}>
            <Bot size={14} /> AI 分析
          </button>
        )}
      </div>

      {/* Cypher Query Panel */}
      {queryPanelOpen && (
        <div className="neo4j-modal-overlay" onClick={() => setQueryPanelOpen(false)}>
          <div className="neo4j-modal" onClick={(e) => e.stopPropagation()}>
            <div className="neo4j-modal-header">
              <Database size={15} />
              <span>自定义图谱查询</span>
              <button type="button" className="btn-ghost" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={() => setQueryPanelOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="neo4j-modal-body">
              <label className="neo4j-field">
                <span>Cypher 查询</span>
                <textarea
                  rows={5}
                  value={formCypher}
                  onChange={(e) => setFormCypher(e.target.value)}
                  placeholder={DEFAULT_CYPHER}
                />
              </label>
              {neo4jError && <div className="neo4j-error">{neo4jError}</div>}
            </div>
            <div className="neo4j-modal-footer">
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setQueryPanelOpen(false)}>取消</button>
                <button type="button" className="btn-primary" style={{ fontSize: 12 }} disabled={neo4jIsLoading} onClick={handleRequery}>
                  {neo4jIsLoading ? '查询中…' : '执行查询'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {relinkMsg && (
        <div style={{ position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '6px 14px', fontSize: 12, color: '#15803d', zIndex: 9999 }}
          onClick={() => setRelinkMsg(null)}>
          ✓ {relinkMsg}
        </div>
      )}

      <div className="smart-app-body">
        <div className="smart-graph-area">
          <SmartAppGraph layoutType={layoutType} detailMode={detailMode} />
        </div>
        <SmartAiPanel collapsed={aiCollapsed} onToggle={() => setAiCollapsed((c) => !c)} />
      </div>
    </div>
  )
}

/* ─── App root ───────────────────────────────────────────────────────────── */

function AppShell() {
  const sidebarOpen    = useSchemaStore((s) => s.sidebarOpen)
  const inspectorOpen  = useSchemaStore((s) => s.inspectorOpen)
  const appMode        = useSchemaStore((s) => s.appMode)
  const initFromApi    = useSchemaStore((s) => s.initFromApi)
  const apiSyncStatus  = useSchemaStore((s) => s.apiSyncStatus)
  const hasHydrated    = useSchemaStore((s) => s._hasHydrated)

  useEffect(() => { void initFromApi() }, [initFromApi])

  // Wait for Zustand rehydration + first API load before rendering anything,
  // prevents the "flash of wrong/empty content" on page open.
  if (!hasHydrated || apiSyncStatus === 'syncing') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', width: '100vw', background: 'var(--bg-primary)',
        flexDirection: 'column', gap: 12,
      }}>
        <Loader2 size={28} className="spin" style={{ color: 'var(--accent-blue)' }} />
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {!hasHydrated ? '初始化…' : '正在从 Neo4j 加载数据…'}
        </span>
      </div>
    )
  }

  const cols = `${sidebarOpen ? 270 : 44}px minmax(0, 1fr) ${appMode === 'schema' && inspectorOpen ? 380 : appMode === 'schema' ? 44 : 0}px`

  return (
    <div className="app-shell" style={{ gridTemplateColumns: cols }}>
      <Sidebar />
      <div className="workbench">
        {apiSyncStatus === 'error' && (
          <div style={{ position:'fixed', bottom:8, right:8, background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:6, padding:'4px 10px', fontSize:11, color:'#dc2626', zIndex:9999, pointerEvents:'none' }}>
            ⚠ 后端连接失败，当前为本地模式
          </div>
        )}
        {appMode === 'schema' && <><CanvasArea /><BottomDock /></>}
        {appMode === 'instance' && <InstanceDataView />}
        {appMode === 'model-factory' && <ModelFactoryView />}
        {appMode === 'smart-app' && <SmartAppView />}
      </div>
      {appMode === 'schema' && <Inspector />}
    </div>
  )
}

function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
      <ContextMenuPortal />
    </ReactFlowProvider>
  )
}

export default App
