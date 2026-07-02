import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { MarkerType } from '@xyflow/react'
import type {
  EntityNode, RelationEdge, EntityData, EntityProperty,
  RelationData, Selection, AiChatMsg, ContextMenuState,
  AiConfig, AiProvider, AiServiceConfig, CanvasView, PendingPlacement, OntologyModel,
  AppMode, InstanceViewTab, InstanceDataset, ActiveImport,
  SkillId, OntologyPatch, PatchItem, OdlPatch, OdlPatchItem, BizTwin,
  Neo4jGraphData,
  FactoryTab,
  GenProgressEvent, GenDataConfig,
} from './types'

import { SKILL_DEFINITIONS } from './lib/skills'
import { api, loadFullModel, seedModelToApi, bizTwinDtoToLocal } from './lib/api'

export const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

function mergeOdlSection(yaml: string, section: string, newContent: string): string {
  const lines = yaml.split('\n')
  const sectionIdx = lines.findIndex((l) => l.startsWith(`${section}:`))
  if (sectionIdx === -1) {
    return yaml.trimEnd() + `\n\n${section}:\n${newContent}\n`
  }
  let endIdx = lines.length
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    if (lines[i].match(/^[a-zA-Z_]/)) { endIdx = i; break }
  }
  return [
    ...lines.slice(0, sectionIdx),
    `${section}:`,
    newContent,
    '',
    ...lines.slice(endIdx),
  ].join('\n')
}

// Sync nodes/edges patch back into the models array for the active model
function patchActiveModel(
  models: OntologyModel[],
  activeModelId: string,
  patch: Partial<Pick<OntologyModel, 'nodes' | 'edges'>>,
): OntologyModel[] {
  return models.map((m) => (m.id === activeModelId ? { ...m, ...patch } : m))
}

export function buildSchemaContext(nodes: EntityNode[], edges: RelationEdge[]) {
  return {
    workspace: 'Customer Knowledge Ontology',
    version: '0.1.0',
    summary: `当前工作区包含 ${nodes.length} 个实体和 ${edges.length} 条关系。`,
    entities: nodes.map((n) => ({
      id: n.id,
      name: n.data.name,
      label: n.data.label,
      description: n.data.description,
      properties: n.data.properties.map((p) => ({
        name: p.name,
        nameZh: p.nameZh,
        type: p.type,
        required: p.required,
        description: p.description,
      })),
    })),
    relations: edges.map((e) => ({
      id: e.id,
      name: e.data?.name,
      source: nodes.find((n) => n.id === e.source)?.data.name,
      target: nodes.find((n) => n.id === e.target)?.data.name,
      cardinality: e.data?.cardinality,
      description: e.data?.description,
    })),
  }
}

export function validateSchema(nodes: EntityNode[], edges: RelationEdge[]) {
  const issues: string[] = []
  const names = new Set<string>()
  nodes.forEach((n) => {
    if (names.has(n.data.name)) issues.push(`实体名称重复：${n.data.name}`)
    names.add(n.data.name)
    if (!n.data.properties.some((p) => p.required)) issues.push(`${n.data.name} 缺少必填属性。`)
  })
  edges.forEach((e) => {
    if (!nodes.some((n) => n.id === e.source) || !nodes.some((n) => n.id === e.target))
      issues.push(`关系 ${e.data?.name ?? e.id} 存在断裂引用。`)
  })
  return issues
}

/* ─── Initial Data ─────────────────────────────────────────────────────────── */

const initialNodes: EntityNode[] = [
  {
    id: 'entity-customer',
    type: 'entity',
    position: { x: 80, y: 110 },
    data: {
      name: 'Customer', label: '客户', description: '购买产品或服务的主体，可为个人或组织。',
      color: '#4a8fa6', entityType: 'role' as const,
      properties: [
        { id: 'prop-customer-id', name: 'id', nameZh: 'ID', type: 'string', required: true, description: '客户唯一标识。' },
        { id: 'prop-customer-name', name: 'name', nameZh: '名称', type: 'string', required: true, description: '客户名称。' },
        { id: 'prop-customer-status', name: 'status', nameZh: '状态', type: 'enum', required: false, description: '客户生命周期状态。' },
      ],
    },
  },
  {
    id: 'entity-contract',
    type: 'entity',
    position: { x: 480, y: 120 },
    data: {
      name: 'Contract', label: '合同', description: '客户与组织之间达成的业务协议。',
      color: '#5b6ee1', entityType: 'abstract' as const,
      properties: [
        { id: 'prop-contract-id', name: 'id', nameZh: 'ID', type: 'string', required: true, description: '合同唯一标识。' },
        { id: 'prop-contract-amount', name: 'amount', nameZh: '金额', type: 'number', required: false, description: '合同金额。' },
      ],
    },
  },
]

const initialEdges: RelationEdge[] = [
  {
    id: 'rel-signed-contract',
    type: 'relation',
    source: 'entity-customer',
    target: 'entity-contract',
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { name: 'signedContract', cardinality: '1:N', description: '客户签署一个或多个合同。', relationCategory: 'participatory' as const },
  },
]

const defaultModel: OntologyModel = {
  id: 'model-default',
  name: '客户知识本体',
  description: '示例本体模型',
  nodes: initialNodes,
  edges: initialEdges,
  createdAt: new Date().toISOString(),
}

/* ─── Travel Ontology Sample Model ─────────────────────────────────────────── */

const travelOntologyModel: OntologyModel = {
  id: 'model-travel',
  name: '差旅费用本体',
  description: '中国互联网游戏公司（50人规模）差旅报销场景本体模型，覆盖组织架构、各类交通出行、住宿及票据凭证。',
  createdAt: new Date().toISOString(),
  nodes: [
    // ── A. 组织架构 ──
    {
      id: 'tn-company', type: 'entity', position: { x: 60, y: 60 },
      data: {
        name: 'Company', label: '公司', color: '#5b6ee1', entityType: 'abstract' as const,
        description: '互联网游戏公司法人实体，约50人规模。',
        properties: [
          { id: 'tp-co-id',       name: 'id',       nameZh: 'ID',     type: 'string', required: true,  description: '公司唯一标识' },
          { id: 'tp-co-name',     name: 'name',     nameZh: '公司名称', type: 'string', required: true,  description: '公司全称' },
          { id: 'tp-co-industry', name: 'industry', nameZh: '所属行业', type: 'string', required: false, description: '如：互联网游戏' },
          { id: 'tp-co-scale',    name: 'scale',    nameZh: '员工规模', type: 'number', required: false, description: '在职员工人数' },
          { id: 'tp-co-city',     name: 'city',     nameZh: '注册城市', type: 'string', required: false, description: '公司注册所在城市' },
        ],
      },
    },
    {
      id: 'tn-department', type: 'entity', position: { x: 60, y: 240 },
      data: {
        name: 'Department', label: '部门', color: '#5b6ee1', entityType: 'abstract' as const,
        description: '公司内部职能部门，如产品、研发、市场、运营、行政、财务等。',
        properties: [
          { id: 'tp-dp-id',     name: 'id',           nameZh: 'ID',     type: 'string', required: true,  description: '部门唯一标识' },
          { id: 'tp-dp-name',   name: 'name',         nameZh: '部门名称', type: 'string', required: true,  description: '部门英文名' },
          { id: 'tp-dp-namezh', name: 'nameZh',       nameZh: '部门中文名', type: 'string', required: false, description: '部门中文名称' },
          { id: 'tp-dp-count',  name: 'headcount',    nameZh: '人数',   type: 'number', required: false, description: '部门在职人数' },
          { id: 'tp-dp-cost',   name: 'budgetCenter', nameZh: '成本中心', type: 'string', required: false, description: '财务成本中心编码' },
        ],
      },
    },
    {
      id: 'tn-employee', type: 'entity', position: { x: 60, y: 420 },
      data: {
        name: 'Employee', label: '员工', color: '#7a5aa6', entityType: 'agent' as const,
        description: '公司在职员工，具备出差申请和报销提交权限。',
        properties: [
          { id: 'tp-em-id',       name: 'id',       nameZh: 'ID',     type: 'string', required: true,  description: '员工唯一标识' },
          { id: 'tp-em-name',     name: 'name',     nameZh: '姓名',   type: 'string', required: true,  description: '员工真实姓名' },
          { id: 'tp-em-empno',    name: 'empNo',    nameZh: '工号',   type: 'string', required: true,  description: '员工工号' },
          { id: 'tp-em-email',    name: 'email',    nameZh: '邮箱',   type: 'string', required: false, description: '公司邮箱' },
          { id: 'tp-em-phone',    name: 'phone',    nameZh: '手机',   type: 'string', required: false, description: '联系电话' },
          { id: 'tp-em-hiredate', name: 'hireDate', nameZh: '入职日期', type: 'date',   required: false, description: '入职日期' },
          { id: 'tp-em-status',   name: 'status',   nameZh: '状态',   type: 'enum',   required: false, description: '在职/离职/试用期' },
        ],
      },
    },
    {
      id: 'tn-jobgrade', type: 'entity', position: { x: 60, y: 620 },
      data: {
        name: 'JobGrade', label: '职级', color: '#4a8fa6', entityType: 'abstract' as const,
        description: '员工职级体系，管理序列M1-M4，技术序列P1-P8，决定差旅住宿标准（高/中/低三档）。',
        properties: [
          { id: 'tp-jg-id',      name: 'id',                  nameZh: 'ID',       type: 'string', required: true,  description: '职级唯一标识' },
          { id: 'tp-jg-code',    name: 'code',                nameZh: '职级编码',  type: 'string', required: true,  description: '如P1-P8或M1-M4' },
          { id: 'tp-jg-name',    name: 'name',                nameZh: '职级名称',  type: 'string', required: true,  description: '如高级工程师、技术总监' },
          { id: 'tp-jg-type',    name: 'gradeType',           nameZh: '序列',     type: 'enum',   required: true,  description: '管理序列/技术序列' },
          { id: 'tp-jg-tier',    name: 'tier',                nameZh: '档次',     type: 'enum',   required: true,  description: '高档/中档/低档' },
          { id: 'tp-jg-hotel',   name: 'accommodationLimit',  nameZh: '住宿上限（元/晚）', type: 'number', required: true,  description: '高档≥800，中档400-800，低档≤400' },
          { id: 'tp-jg-meal',    name: 'dailyMealAllowance',  nameZh: '日餐补（元/天）',  type: 'number', required: false, description: '每日餐饮补贴标准' },
          { id: 'tp-jg-air',     name: 'airClass',            nameZh: '机舱等级',  type: 'enum',   required: false, description: '经济舱/商务舱/头等舱' },
        ],
      },
    },
    // ── B. 差旅申请与报销 ──
    {
      id: 'tn-businesstrip', type: 'entity', position: { x: 380, y: 200 },
      data: {
        name: 'BusinessTrip', label: '出差申请', color: '#d4984a', entityType: 'activity' as const,
        description: '员工发起的出差申请，记录出行目的、时间、目的地和预算，经审批后生效。',
        properties: [
          { id: 'tp-bt-id',      name: 'id',              nameZh: 'ID',       type: 'string', required: true,  description: '申请单唯一标识' },
          { id: 'tp-bt-tripno',  name: 'tripNo',          nameZh: '申请单号',  type: 'string', required: true,  description: '出差申请编号' },
          { id: 'tp-bt-purpose', name: 'purpose',         nameZh: '出差事由',  type: 'string', required: true,  description: '出差目的说明' },
          { id: 'tp-bt-depcity', name: 'departureCity',   nameZh: '出发城市',  type: 'string', required: true,  description: '出发地城市' },
          { id: 'tp-bt-descity', name: 'destinationCity', nameZh: '目的地城市', type: 'string', required: true,  description: '目的地城市' },
          { id: 'tp-bt-depdate', name: 'departureDate',   nameZh: '出发日期',  type: 'date',   required: true,  description: '计划出发日期' },
          { id: 'tp-bt-retdate', name: 'returnDate',      nameZh: '返回日期',  type: 'date',   required: true,  description: '计划返回日期' },
          { id: 'tp-bt-days',    name: 'days',            nameZh: '出差天数',  type: 'number', required: false, description: '出差持续天数' },
          { id: 'tp-bt-status',  name: 'status',          nameZh: '状态',     type: 'enum',   required: true,  description: '待审批/已批准/出行中/已完成/已拒绝' },
          { id: 'tp-bt-budget',  name: 'budgetAmount',    nameZh: '预算金额',  type: 'number', required: false, description: '预估出差总费用' },
        ],
      },
    },
    {
      id: 'tn-expensereport', type: 'entity', position: { x: 380, y: 520 },
      data: {
        name: 'ExpenseReport', label: '报销单', color: '#c06a3d', entityType: 'event' as const,
        description: '员工出差归来后提交的费用报销申请，经财务和上级审批后付款。',
        properties: [
          { id: 'tp-er-id',       name: 'id',             nameZh: 'ID',       type: 'string', required: true,  description: '报销单唯一标识' },
          { id: 'tp-er-reportno', name: 'reportNo',       nameZh: '报销单号',  type: 'string', required: true,  description: '报销单编号' },
          { id: 'tp-er-subdate',  name: 'submittedDate',  nameZh: '提交日期',  type: 'date',   required: true,  description: '提交报销的日期' },
          { id: 'tp-er-total',    name: 'totalAmount',    nameZh: '申请金额',  type: 'number', required: true,  description: '总报销金额（元）' },
          { id: 'tp-er-approved', name: 'approvedAmount', nameZh: '批准金额',  type: 'number', required: false, description: '实际审批通过金额' },
          { id: 'tp-er-status',   name: 'status',         nameZh: '状态',     type: 'enum',   required: true,  description: '草稿/审批中/已批准/已付款/已拒绝' },
          { id: 'tp-er-reject',   name: 'rejectReason',   nameZh: '拒绝原因',  type: 'string', required: false, description: '审批拒绝时的说明' },
        ],
      },
    },
    // ── C. 交通出行凭证 ──
    {
      id: 'tn-flightticket', type: 'entity', position: { x: 700, y: 60 },
      data: {
        name: 'FlightTicket', label: '机票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '航空公司出具的客运机票，差旅中最常用的长途交通方式，需配合行程单报销。',
        properties: [
          { id: 'tp-ft-id',      name: 'id',            nameZh: 'ID',       type: 'string', required: true,  description: '机票唯一标识' },
          { id: 'tp-ft-ticketno',name: 'ticketNo',      nameZh: '票号',     type: 'string', required: true,  description: '航空公司票号' },
          { id: 'tp-ft-flightno',name: 'flightNo',      nameZh: '航班号',   type: 'string', required: true,  description: '如CA1234' },
          { id: 'tp-ft-airline', name: 'airline',       nameZh: '航空公司',  type: 'string', required: false, description: '如国航、南航、东航' },
          { id: 'tp-ft-from',    name: 'from',          nameZh: '出发机场',  type: 'string', required: true,  description: '出发机场三字码或城市' },
          { id: 'tp-ft-to',      name: 'to',            nameZh: '到达机场',  type: 'string', required: true,  description: '到达机场三字码或城市' },
          { id: 'tp-ft-deptime', name: 'departureTime', nameZh: '起飞时间',  type: 'date',   required: true,  description: '计划起飞时间' },
          { id: 'tp-ft-arrtime', name: 'arrivalTime',   nameZh: '到达时间',  type: 'date',   required: false, description: '计划到达时间' },
          { id: 'tp-ft-seat',    name: 'seatClass',     nameZh: '舱位',     type: 'enum',   required: true,  description: '经济舱/商务舱/头等舱' },
          { id: 'tp-ft-amount',  name: 'amount',        nameZh: '票价（元）', type: 'number', required: true,  description: '实际支付票价' },
        ],
      },
    },
    {
      id: 'tn-trainticket', type: 'entity', position: { x: 700, y: 240 },
      data: {
        name: 'TrainTicket', label: '火车/高铁票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '铁路旅客运输票，包括高速铁路（高铁/动车）和普速铁路，票面即报销凭证。',
        properties: [
          { id: 'tp-tr-id',      name: 'id',            nameZh: 'ID',       type: 'string', required: true,  description: '票务唯一标识' },
          { id: 'tp-tr-trainno', name: 'trainNo',       nameZh: '车次',     type: 'string', required: true,  description: '如G123、Z456、K789' },
          { id: 'tp-tr-from',    name: 'from',          nameZh: '出发站',   type: 'string', required: true,  description: '出发车站' },
          { id: 'tp-tr-to',      name: 'to',            nameZh: '到达站',   type: 'string', required: true,  description: '到达车站' },
          { id: 'tp-tr-deptime', name: 'departureTime', nameZh: '出发时间',  type: 'date',   required: true,  description: '计划发车时间' },
          { id: 'tp-tr-seat',    name: 'seatType',      nameZh: '座位类型',  type: 'enum',   required: true,  description: '高铁：二等/一等/商务座；普铁：硬座/硬卧/软卧' },
          { id: 'tp-tr-amount',  name: 'amount',        nameZh: '票价（元）', type: 'number', required: true,  description: '实际支付票价' },
        ],
      },
    },
    {
      id: 'tn-busticket', type: 'entity', position: { x: 700, y: 400 },
      data: {
        name: 'LongDistanceBusTicket', label: '长途车票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '城际长途客运汽车票，适用于无火车直达的短途差旅或末端接驳。',
        properties: [
          { id: 'tp-lb-id',      name: 'id',            nameZh: 'ID',       type: 'string', required: true,  description: '票务唯一标识' },
          { id: 'tp-lb-company', name: 'company',       nameZh: '运营公司',  type: 'string', required: false, description: '客运公司名称' },
          { id: 'tp-lb-from',    name: 'from',          nameZh: '出发站',   type: 'string', required: true,  description: '出发汽车站' },
          { id: 'tp-lb-to',      name: 'to',            nameZh: '到达站',   type: 'string', required: true,  description: '到达汽车站' },
          { id: 'tp-lb-deptime', name: 'departureTime', nameZh: '出发时间',  type: 'date',   required: true,  description: '计划发车时间' },
          { id: 'tp-lb-seat',    name: 'seatType',      nameZh: '座位类型',  type: 'enum',   required: false, description: '普通座/卧铺' },
          { id: 'tp-lb-amount',  name: 'amount',        nameZh: '票价（元）', type: 'number', required: true,  description: '实际支付票价' },
        ],
      },
    },
    {
      id: 'tn-shipticket', type: 'entity', position: { x: 700, y: 560 },
      data: {
        name: 'ShipTicket', label: '船票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '水路客运船票，适用于岛屿、沿江沿海等特定差旅路线。',
        properties: [
          { id: 'tp-sh-id',      name: 'id',          nameZh: 'ID',       type: 'string', required: true,  description: '票务唯一标识' },
          { id: 'tp-sh-ship',    name: 'shipName',    nameZh: '船名',     type: 'string', required: false, description: '轮渡或邮轮名称' },
          { id: 'tp-sh-route',   name: 'route',       nameZh: '航线',     type: 'string', required: false, description: '航线名称' },
          { id: 'tp-sh-from',    name: 'from',        nameZh: '出发港口',  type: 'string', required: true,  description: '出发港口或码头' },
          { id: 'tp-sh-to',      name: 'to',          nameZh: '到达港口',  type: 'string', required: true,  description: '到达港口或码头' },
          { id: 'tp-sh-depdate', name: 'departureDate', nameZh: '出发时间', type: 'date',  required: true,  description: '计划出发时间' },
          { id: 'tp-sh-cabin',   name: 'cabinClass',  nameZh: '舱位等级',  type: 'enum',   required: false, description: '普通/二等/一等/特等舱' },
          { id: 'tp-sh-amount',  name: 'amount',      nameZh: '票价（元）', type: 'number', required: true,  description: '实际支付票价' },
        ],
      },
    },
    {
      id: 'tn-taxireceipt', type: 'entity', position: { x: 700, y: 720 },
      data: {
        name: 'TaxiReceipt', label: '出租/网约车票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '出租车或网约车（滴滴、曹操、T3等）的行程收据，适用于城市内接送机/站及商务用车。',
        properties: [
          { id: 'tp-tx-id',     name: 'id',          nameZh: 'ID',       type: 'string', required: true,  description: '票据唯一标识' },
          { id: 'tp-tx-date',   name: 'date',        nameZh: '用车日期',  type: 'date',   required: true,  description: '用车日期' },
          { id: 'tp-tx-type',   name: 'type',        nameZh: '用车类型',  type: 'enum',   required: true,  description: '出租车/滴滴/曹操出行/T3出行' },
          { id: 'tp-tx-from',   name: 'from',        nameZh: '出发地',   type: 'string', required: true,  description: '上车地点' },
          { id: 'tp-tx-to',     name: 'to',          nameZh: '到达地',   type: 'string', required: true,  description: '下车地点' },
          { id: 'tp-tx-amount', name: 'amount',      nameZh: '金额（元）', type: 'number', required: true,  description: '实际支付金额' },
          { id: 'tp-tx-invtype',name: 'invoiceType', nameZh: '凭证类型',  type: 'enum',   required: true,  description: '电子发票/纸质发票/行程收据' },
        ],
      },
    },
    {
      id: 'tn-transitticket', type: 'entity', position: { x: 700, y: 880 },
      data: {
        name: 'UrbanTransitTicket', label: '地铁/公交票', color: '#2f7d6d', entityType: 'physical' as const,
        description: '城市轨道交通（地铁）或公共汽车票，金额小但需统一归集报销。',
        properties: [
          { id: 'tp-ut-id',     name: 'id',     nameZh: 'ID',       type: 'string', required: true,  description: '票据唯一标识' },
          { id: 'tp-ut-date',   name: 'date',   nameZh: '乘车日期',  type: 'date',   required: true,  description: '乘车日期' },
          { id: 'tp-ut-city',   name: 'city',   nameZh: '城市',     type: 'string', required: true,  description: '乘车所在城市' },
          { id: 'tp-ut-mode',   name: 'mode',   nameZh: '交通方式',  type: 'enum',   required: true,  description: '地铁/公交' },
          { id: 'tp-ut-from',   name: 'from',   nameZh: '起始站',   type: 'string', required: false, description: '上车站/站名' },
          { id: 'tp-ut-to',     name: 'to',     nameZh: '到达站',   type: 'string', required: false, description: '下车站/站名' },
          { id: 'tp-ut-amount', name: 'amount', nameZh: '金额（元）', type: 'number', required: true,  description: '实际支付金额' },
        ],
      },
    },
    // ── D. 住宿 ──
    {
      id: 'tn-hotelstay', type: 'entity', position: { x: 1020, y: 60 },
      data: {
        name: 'HotelStay', label: '住宿记录', color: '#d4984a', entityType: 'activity' as const,
        description: '员工出差期间的酒店住宿记录，包含入住/退房信息及费用，须符合职级住宿标准。',
        properties: [
          { id: 'tp-hs-id',       name: 'id',             nameZh: 'ID',       type: 'string',  required: true,  description: '住宿记录唯一标识' },
          { id: 'tp-hs-hotel',    name: 'hotelName',      nameZh: '酒店名称',  type: 'string',  required: true,  description: '酒店全称' },
          { id: 'tp-hs-city',     name: 'city',           nameZh: '所在城市',  type: 'string',  required: true,  description: '酒店所在城市' },
          { id: 'tp-hs-star',     name: 'starRating',     nameZh: '星级',     type: 'number',  required: false, description: '酒店星级（1-5星）' },
          { id: 'tp-hs-checkin',  name: 'checkIn',        nameZh: '入住日期',  type: 'date',    required: true,  description: '入住日期' },
          { id: 'tp-hs-checkout', name: 'checkOut',       nameZh: '退房日期',  type: 'date',    required: true,  description: '退房日期' },
          { id: 'tp-hs-nights',   name: 'nights',         nameZh: '住宿天数',  type: 'number',  required: false, description: '实际住宿夜数' },
          { id: 'tp-hs-roomtype', name: 'roomType',       nameZh: '房型',     type: 'string',  required: false, description: '如标准大床/标准双床/豪华间' },
          { id: 'tp-hs-perprice', name: 'amountPerNight', nameZh: '每晚价格（元）', type: 'number', required: true, description: '每晚实际房费' },
          { id: 'tp-hs-total',    name: 'totalAmount',    nameZh: '总金额（元）', type: 'number', required: true,  description: '住宿总费用' },
          { id: 'tp-hs-within',   name: 'withinStandard', nameZh: '是否合规',  type: 'boolean', required: true,  description: '是否符合该员工职级住宿标准' },
        ],
      },
    },
    // ── E. 票据凭证 ──
    {
      id: 'tn-invoice', type: 'entity', position: { x: 1020, y: 300 },
      data: {
        name: 'Invoice', label: '发票', color: '#5b6ee1', entityType: 'abstract' as const,
        description: '税务局监制的增值税发票，是费用报销的法定凭证，分专用发票和普通发票（含电子）。',
        properties: [
          { id: 'tp-iv-id',       name: 'id',          nameZh: 'ID',       type: 'string', required: true,  description: '记录唯一标识' },
          { id: 'tp-iv-ivno',     name: 'invoiceNo',   nameZh: '发票号码',  type: 'string', required: true,  description: '发票右上角号码（8位）' },
          { id: 'tp-iv-ivcode',   name: 'invoiceCode', nameZh: '发票代码',  type: 'string', required: false, description: '纸质发票代码（12位）' },
          { id: 'tp-iv-type',     name: 'invoiceType', nameZh: '发票类型',  type: 'enum',   required: true,  description: '增值税专用发票/增值税普通发票/电子普通发票' },
          { id: 'tp-iv-seller',   name: 'sellerName',  nameZh: '销售方名称', type: 'string', required: true,  description: '开票方公司名称' },
          { id: 'tp-iv-sellerid', name: 'sellerTaxId', nameZh: '销售方税号', type: 'string', required: false, description: '销售方纳税人识别号' },
          { id: 'tp-iv-buyer',    name: 'buyerName',   nameZh: '购买方名称', type: 'string', required: true,  description: '报销公司名称' },
          { id: 'tp-iv-amount',   name: 'amount',      nameZh: '税前金额（元）', type: 'number', required: true, description: '不含税金额' },
          { id: 'tp-iv-taxrate',  name: 'taxRate',     nameZh: '税率',     type: 'number', required: false, description: '适用税率，如0.06/0.09/0.13' },
          { id: 'tp-iv-tax',      name: 'taxAmount',   nameZh: '税额（元）', type: 'number', required: false, description: '增值税额' },
          { id: 'tp-iv-date',     name: 'issueDate',   nameZh: '开票日期',  type: 'date',   required: true,  description: '发票开具日期' },
        ],
      },
    },
    {
      id: 'tn-airitinerary', type: 'entity', position: { x: 1020, y: 540 },
      data: {
        name: 'AirItinerary', label: '航空行程单', color: '#5b6ee1', entityType: 'abstract' as const,
        description: '航空电子客票的报销凭证，由航空公司或代理出具，税务局认可的合规差旅凭证（替代机票发票）。',
        properties: [
          { id: 'tp-ai-id',         name: 'id',            nameZh: 'ID',       type: 'string', required: true,  description: '行程单唯一标识' },
          { id: 'tp-ai-passenger',  name: 'passengerName', nameZh: '旅客姓名',  type: 'string', required: true,  description: '乘机旅客姓名' },
          { id: 'tp-ai-idtype',     name: 'idType',        nameZh: '证件类型',  type: 'enum',   required: false, description: '身份证/护照/其他' },
          { id: 'tp-ai-idno',       name: 'idNo',          nameZh: '证件号码',  type: 'string', required: false, description: '旅客证件号码' },
          { id: 'tp-ai-ticketno',   name: 'ticketNo',      nameZh: '票号',     type: 'string', required: true,  description: '航空电子客票号' },
          { id: 'tp-ai-flightno',   name: 'flightNo',      nameZh: '航班号',   type: 'string', required: true,  description: '如CA1234' },
          { id: 'tp-ai-issuedate',  name: 'issueDate',     nameZh: '填开日期',  type: 'date',   required: true,  description: '行程单填开日期' },
          { id: 'tp-ai-total',      name: 'total',         nameZh: '票价合计（元）', type: 'number', required: true, description: '含税价合计' },
          { id: 'tp-ai-elecno',     name: 'electronicNo',  nameZh: '电子客票验证码', type: 'string', required: false, description: '验证真伪的校验码' },
        ],
      },
    },
    {
      id: 'tn-hotelreceipt', type: 'entity', position: { x: 1020, y: 760 },
      data: {
        name: 'HotelReceipt', label: '住宿水单', color: '#5b6ee1', entityType: 'abstract' as const,
        description: '酒店结算清单（水单），列明入住时间、房型及每晚费用明细，配合酒店发票一同报销。',
        properties: [
          { id: 'tp-hr-id',       name: 'id',             nameZh: 'ID',       type: 'string', required: true,  description: '水单唯一标识' },
          { id: 'tp-hr-guest',    name: 'guestName',      nameZh: '住客姓名',  type: 'string', required: true,  description: '入住旅客姓名' },
          { id: 'tp-hr-checkin',  name: 'checkIn',        nameZh: '入住日期',  type: 'date',   required: true,  description: '入住日期' },
          { id: 'tp-hr-checkout', name: 'checkOut',       nameZh: '退房日期',  type: 'date',   required: true,  description: '退房日期' },
          { id: 'tp-hr-rooms',    name: 'roomCount',      nameZh: '房间数',   type: 'number', required: false, description: '入住房间数量' },
          { id: 'tp-hr-roomtype', name: 'roomType',       nameZh: '房型',     type: 'string', required: false, description: '标准间/大床房等' },
          { id: 'tp-hr-perprice', name: 'amountPerNight', nameZh: '每晚房价（元）', type: 'number', required: true, description: '每晚房费' },
          { id: 'tp-hr-total',    name: 'totalAmount',    nameZh: '总金额（元）', type: 'number', required: true, description: '住宿总费用' },
          { id: 'tp-hr-date',     name: 'issueDate',      nameZh: '开具日期',  type: 'date',   required: true,  description: '水单开具日期' },
        ],
      },
    },
    // ── F. 城市 ──
    {
      id: 'tn-city', type: 'entity', position: { x: 380, y: 840 },
      data: {
        name: 'City', label: '城市', color: '#6aa64a', entityType: 'spatial' as const,
        description: '差旅出发地或目的地城市，用于行程记录和差旅补贴标准的地区匹配。',
        properties: [
          { id: 'tp-cy-id',       name: 'id',                     nameZh: 'ID',       type: 'string',  required: true,  description: '城市唯一标识' },
          { id: 'tp-cy-name',     name: 'name',                   nameZh: '城市名称',  type: 'string',  required: true,  description: '城市中文名' },
          { id: 'tp-cy-province', name: 'province',               nameZh: '所属省份',  type: 'string',  required: false, description: '所属省/直辖市/自治区' },
          { id: 'tp-cy-country',  name: 'country',                nameZh: '国家',     type: 'string',  required: false, description: '默认：中国' },
          { id: 'tp-cy-popular',  name: 'isPopularBizDestination', nameZh: '热门商务城市', type: 'boolean', required: false, description: '是否为常见差旅目的地，如北上广深杭' },
        ],
      },
    },
  ] as EntityNode[],

  edges: [
    // ── 组织架构关系 ──
    {
      id: 'te-dept-company', type: 'relation',
      source: 'tn-department', target: 'tn-company',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'partOf', label: '归属', cardinality: 'N:1', description: '部门属于公司', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-emp-dept', type: 'relation',
      source: 'tn-employee', target: 'tn-department',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'belongsTo', label: '隶属', cardinality: 'N:1', description: '员工属于某个部门', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-emp-grade', type: 'relation',
      source: 'tn-employee', target: 'tn-jobgrade',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'holdsGrade', label: '持有职级', cardinality: 'N:1', description: '员工拥有特定职级，决定差旅标准', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    // ── 差旅申请关系 ──
    {
      id: 'te-emp-trip', type: 'relation',
      source: 'tn-employee', target: 'tn-businesstrip',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'applies', label: '发起出差', cardinality: '1:N', description: '员工发起出差申请', edgeStyle: 'bezier' as const, relationCategory: 'participatory' as const },
    },
    {
      id: 'te-trip-city', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-city',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'destinatesTo', label: '目的地', cardinality: 'N:1', description: '出差前往的目的城市', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    {
      id: 'te-emp-report', type: 'relation',
      source: 'tn-employee', target: 'tn-expensereport',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'submits', label: '提交报销', cardinality: '1:N', description: '员工提交报销单', edgeStyle: 'bezier' as const, relationCategory: 'participatory' as const },
    },
    {
      id: 'te-trip-report', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-expensereport',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'generates', label: '产生报销', cardinality: '1:1', description: '出差结束后产生报销单', edgeStyle: 'bezier' as const, relationCategory: 'temporal-causal' as const },
    },
    // ── 出差包含交通/住宿 ──
    {
      id: 'te-trip-flight', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-flightticket',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesFlight', label: '包含机票', cardinality: '1:N', description: '出差行程包含机票', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-train', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-trainticket',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesTrain', label: '包含火车票', cardinality: '1:N', description: '出差行程包含火车/高铁票', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-bus', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-busticket',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesBus', label: '包含长途车票', cardinality: '1:N', description: '出差行程包含长途车票', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-ship', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-shipticket',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesShip', label: '包含船票', cardinality: '1:N', description: '出差行程包含船票', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-taxi', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-taxireceipt',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesTaxi', label: '包含打车票', cardinality: '1:N', description: '出差期间包含出租/网约车费', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-transit', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-transitticket',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesTransit', label: '包含市内交通', cardinality: '1:N', description: '出差期间包含地铁/公交票', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    {
      id: 'te-trip-hotel', type: 'relation',
      source: 'tn-businesstrip', target: 'tn-hotelstay',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'includesHotel', label: '包含住宿', cardinality: '1:N', description: '出差期间包含住宿记录', edgeStyle: 'bezier' as const, relationCategory: 'structural' as const },
    },
    // ── 票据凭证关系 ──
    {
      id: 'te-flight-invoice', type: 'relation',
      source: 'tn-flightticket', target: 'tn-invoice',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'hasInvoice', label: '对应发票', cardinality: '1:1', description: '机票对应增值税发票（部分航司提供）', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    {
      id: 'te-flight-itinerary', type: 'relation',
      source: 'tn-flightticket', target: 'tn-airitinerary',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'hasItinerary', label: '对应行程单', cardinality: '1:1', description: '机票对应航空行程单（主要报销凭证）', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    {
      id: 'te-hotel-invoice', type: 'relation',
      source: 'tn-hotelstay', target: 'tn-invoice',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'hotelHasInvoice', label: '对应发票', cardinality: '1:1', description: '酒店住宿对应增值税发票', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    {
      id: 'te-hotel-receipt', type: 'relation',
      source: 'tn-hotelstay', target: 'tn-hotelreceipt',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'hotelHasReceipt', label: '对应水单', cardinality: '1:1', description: '酒店住宿对应结算水单（明细凭证）', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
    {
      id: 'te-train-invoice', type: 'relation',
      source: 'tn-trainticket', target: 'tn-invoice',
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { name: 'trainHasInvoice', label: '对应发票', cardinality: '1:1', description: '火车票/高铁票可申请开具报销发票', edgeStyle: 'bezier' as const, relationCategory: 'associative' as const },
    },
  ] as RelationEdge[],
}

/* ─── Store Type ────────────────────────────────────────────────────────────── */

export type SchemaStore = {
  // Multi-model
  models: OntologyModel[]
  activeModelId: string

  // Working copies of the active model's nodes/edges (kept in sync with models)
  nodes: EntityNode[]
  edges: RelationEdge[]

  selected: Selection
  contextMenu: ContextMenuState
  searchQuery: string
  canvasView: CanvasView
  sidebarOpen: boolean
  inspectorOpen: boolean
  showMiniMap: boolean
  globeNodeSize: number
  pendingPlacement: PendingPlacement
  aiChatMsgs: AiChatMsg[]
  aiServices: AiServiceConfig[]
  activeAiServiceId: string | null
  isAiLoading: boolean
  activeSkillId: SkillId
  pendingPatches: PatchItem[]
  odlPatches: OdlPatchItem[]
  docContext: string

  // Model management
  addModel: (name: string, description?: string) => void
  deleteModel: (id: string) => void
  renameModel: (id: string, name: string) => void
  duplicateModel: (id: string) => void
  switchModel: (id: string) => void

  setNodes: (nodes: EntityNode[] | ((n: EntityNode[]) => EntityNode[])) => void
  setEdges: (edges: RelationEdge[] | ((e: RelationEdge[]) => RelationEdge[])) => void
  setSelected: (sel: Selection) => void
  setContextMenu: (menu: ContextMenuState) => void
  setSearchQuery: (q: string) => void
  setCanvasView: (v: CanvasView) => void
  setSidebarOpen: (v: boolean) => void
  setInspectorOpen: (v: boolean) => void
  setShowMiniMap: (v: boolean) => void
  setGlobeNodeSize: (size: number) => void
  setPendingPlacement: (p: PendingPlacement) => void
  addRelationBetween: (sourceId: string, targetId: string, data: Partial<RelationData>) => void
  addAiService:       (cfg: Omit<AiServiceConfig, 'id'>) => void
  updateAiService:    (id: string, cfg: Partial<AiServiceConfig>) => void
  deleteAiService:    (id: string) => void
  setActiveAiService: (id: string | null) => void

  addEntity: (position?: { x: number; y: number }, seed?: Partial<EntityData>) => string
  addConnectedEntity: (sourceId: string) => void
  deleteSelected: () => void
  deleteEntity: (id: string) => void
  deleteRelation: (id: string) => void
  duplicateEntity: (id: string) => void
  updateEntity: (id: string, patch: Partial<EntityData>) => void
  addProperty: (entityId: string) => void
  updateProperty: (entityId: string, propertyId: string, patch: Partial<EntityProperty>) => void
  removeProperty: (entityId: string, propertyId: string) => void
  updateRelation: (id: string, patch: Partial<RelationData>) => void

  sendAiMessage: (content: string) => Promise<void>
  clearAiChat: () => void
  smartChatMsgs: AiChatMsg[]
  isSmartChatLoading: boolean
  sendSmartMessage: (content: string, useSkills?: boolean, reportMode?: boolean) => Promise<void>
  clearSmartChat: () => void
  exportSchema: () => void
  importSchemaFromData: (nodes: EntityNode[], edges: RelationEdge[]) => Promise<void>
  mergeSchemaFromData:  (nodes: EntityNode[], edges: RelationEdge[]) => Promise<void>
  saveOdl: (yaml: string) => Promise<void>
  rerouteRelation: (id: string, sourceId: string, targetId: string) => void
  setActiveSkill: (id: SkillId) => void
  applyPatch: (patchId: string) => void
  dismissPatch: (patchId: string) => void
  clearPatches: () => void
  applyOdlPatch: (id: string) => Promise<void>
  dismissOdlPatch: (id: string) => void
  clearOdlPatches: () => void
  setDocContext: (text: string) => void

  // ── Instance Data ──────────────────────────────────────────────────────────
  appMode: AppMode
  setAppMode: (mode: AppMode) => void
  factoryTab: FactoryTab
  setFactoryTab: (tab: FactoryTab) => void
  instanceViewTab: InstanceViewTab
  setInstanceViewTab: (tab: InstanceViewTab) => void
  instanceActiveEntity: string
  setInstanceActiveEntity: (id: string) => void
  instanceDatasets: Record<string, InstanceDataset[]>   // twinId → datasets
  addOrReplaceDataset: (dataset: InstanceDataset) => void
  deleteDataset: (datasetId: string) => void
  updateRecord: (datasetId: string, recordId: string, data: Record<string, import('./types').InstanceFieldValue>) => void
  deleteRecord: (datasetId: string, recordId: string) => void
  deleteRecords: (datasetId: string, recordIds: string[]) => void
  activeImport: ActiveImport | null
  setActiveImport: (imp: ActiveImport | null) => void
  updateColumnMapping: (csvHeader: string, mappedTo: string | null) => void
  // ── Business Twin ──────────────────────────────────────────────────────────
  bizTwins: BizTwin[]
  activeBizTwinId: string | null
  addBizTwin: (twin: BizTwin) => void
  deleteBizTwin: (twinId: string) => void
  updateBizTwin: (id: string, patch: Partial<BizTwin>) => void
  setActiveBizTwinId: (id: string | null) => void
  // ── API sync status ────────────────────────────────────────────────────────
  apiSyncStatus: 'idle' | 'syncing' | 'error'
  _hasHydrated: boolean
  setHasHydrated: (v: boolean) => void
  initFromApi: () => Promise<void>
  // ── Neo4j Graph Browse (via backend API) ──────────────────────────────────
  neo4jIsLoading:      boolean
  neo4jError:          string | null
  neo4jGraphData:      Neo4jGraphData | null
  queryNeo4jViaApi:          (cypher?: string, twinId?: string) => Promise<void>
  querySchemaOverview:       (twinId: string) => Promise<void>
  relinkInstances:           (twinId: string) => Promise<{ linked: number; created: number } | null>
  syncConstraintsAndIndexes: () => Promise<{ synced: number; errors: string[] }>
  // ── Synthetic Data Generation ──────────────────────────────────────────────
  isGenerating:    boolean
  genProgress:     GenProgressEvent[]
  generateSimData: (cfg: GenDataConfig) => Promise<void>
  isDeduping:      boolean
  dedupInstances:  (twinId: string) => Promise<{ removed: number; kept: number }>
  // ── Smart App: Instance Selection ─────────────────────────────────────────
  selectedInstanceId: string | null
  setSelectedInstance: (id: string | null) => void
}

/* ─── Store ─────────────────────────────────────────────────────────────────── */

export const useSchemaStore = create<SchemaStore>()(
  persist(
    (set, get) => ({
      models: [defaultModel, travelOntologyModel],
      activeModelId: defaultModel.id,
      nodes: initialNodes,
      edges: initialEdges,
      selected: { kind: 'workspace' },
      appMode: 'schema',
      factoryTab: 'llm',
      instanceViewTab: 'table',
      instanceActiveEntity: '',
      instanceDatasets: {},
      activeImport: null,
      bizTwins: [],
      activeBizTwinId: null,
      apiSyncStatus: 'idle',
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      neo4jIsLoading: false,
      neo4jError:     null,
      neo4jGraphData: null,
      isGenerating:   false,
      genProgress:    [],
      isDeduping:     false,
      selectedInstanceId: null,
      setSelectedInstance: (id) => set({ selectedInstanceId: id }),
      contextMenu: null,
      searchQuery: '',
      canvasView: 'detail',
      sidebarOpen: true,
      inspectorOpen: true,
      showMiniMap: true,
      globeNodeSize: 62,
      pendingPlacement: null,
      aiChatMsgs: [],
      smartChatMsgs: [],
      isSmartChatLoading: false,
      aiServices: [],
      activeAiServiceId: null,
      isAiLoading: false,
      activeSkillId: 'free-chat',
      pendingPatches: [],
      odlPatches: [],
      docContext: '',

      /* ── Model Management ───────────────────────────────────────────────── */

      addModel: (name, description = '') => {
        const id = makeId('model')
        const newModel: OntologyModel = {
          id, name, description, nodes: [], edges: [],
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          models: [...s.models, newModel],
          activeModelId: id,
          nodes: [],
          edges: [],
          selected: { kind: 'workspace' },
          contextMenu: null,
          searchQuery: '',
          pendingPlacement: null,
        }))
        void api.createModel({ id, name, description })
      },

      deleteModel: (id) => {
        set((s) => {
          if (s.models.length <= 1) return {}
          const remaining = s.models.filter((m) => m.id !== id)
          const newActiveId = s.activeModelId === id ? remaining[0].id : s.activeModelId
          const newActive = remaining.find((m) => m.id === newActiveId)!
          return {
            models: remaining,
            activeModelId: newActiveId,
            nodes: s.activeModelId === id ? newActive.nodes : s.nodes,
            edges: s.activeModelId === id ? newActive.edges : s.edges,
            selected: { kind: 'workspace' },
            contextMenu: null,
            pendingPlacement: null,
          }
        })
        void api.deleteModel(id)
      },

      renameModel: (id, name) => {
        set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, name } : m)) }))
        void api.updateModel(id, { name })
      },

      duplicateModel: (id) => {
        const newId = makeId('model')
        set((s) => {
          const source = s.models.find((m) => m.id === id)
          if (!source) return {}
          const srcNodes = s.activeModelId === id ? s.nodes : source.nodes
          const srcEdges = s.activeModelId === id ? s.edges : source.edges
          const copy: OntologyModel = {
            ...source,
            id: newId,
            name: `${source.name}（副本）`,
            nodes: srcNodes,
            edges: srcEdges,
            createdAt: new Date().toISOString(),
          }
          return {
            models: [...s.models, copy],
            activeModelId: newId,
            nodes: copy.nodes,
            edges: copy.edges,
            selected: { kind: 'workspace' },
            contextMenu: null,
            pendingPlacement: null,
          }
        })
      },

      switchModel: (id) => set((s) => {
        if (s.activeModelId === id) return {}
        const target = s.models.find((m) => m.id === id)
        if (!target) return {}
        // Save current working nodes/edges into the current active model before switching
        const updatedModels = patchActiveModel(s.models, s.activeModelId, {
          nodes: s.nodes,
          edges: s.edges,
        })
        return {
          models: updatedModels,
          activeModelId: id,
          nodes: target.nodes,
          edges: target.edges,
          selected: { kind: 'workspace' },
          contextMenu: null,
          searchQuery: '',
          pendingPlacement: null,
        }
      }),

      /* ── Node / Edge Setters (sync to models) ───────────────────────────── */

      setNodes: (nodes) => set((s) => {
        const newNodes = typeof nodes === 'function' ? nodes(s.nodes) : nodes
        return {
          nodes: newNodes,
          models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
        }
      }),

      setEdges: (edges) => set((s) => {
        const newEdges = typeof edges === 'function' ? edges(s.edges) : edges
        return {
          edges: newEdges,
          models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
        }
      }),

      setSelected: (selected) => set({ selected }),
      setContextMenu: (contextMenu) => set({ contextMenu }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setCanvasView: (canvasView) => set({ canvasView }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setShowMiniMap: (showMiniMap) => set({ showMiniMap }),
      setGlobeNodeSize: (globeNodeSize) => set({ globeNodeSize }),
      setPendingPlacement: (pendingPlacement) => set({ pendingPlacement }),

      addRelationBetween: (sourceId, targetId, data) => {
        const edgeId = makeId('rel')
        const activeModelId = get().activeModelId
        const relData = {
          name: data.name ?? 'relatedTo',
          cardinality: data.cardinality ?? '1:N' as const,
          description: data.description ?? '',
          edgeStyle: data.edgeStyle ?? 'bezier' as const,
          relationCategory: data.relationCategory,
        }
        set((s: SchemaStore) => {
          const newEdges: RelationEdge[] = [
            ...s.edges,
            { id: edgeId, type: 'relation' as const, source: sourceId, target: targetId,
              markerEnd: { type: MarkerType.ArrowClosed }, data: relData },
          ]
          return {
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
            selected: { kind: 'relation', id: edgeId },
          }
        })
        void api.createRelation(activeModelId, {
          id: edgeId, sourceId, targetId,
          name: relData.name, cardinality: relData.cardinality,
          description: relData.description, edgeStyle: relData.edgeStyle,
          relationCategory: relData.relationCategory,
        })
      },

      addAiService: (cfg) => {
        const svc: AiServiceConfig = { id: makeId('svc'), ...cfg }
        set((s) => ({
          aiServices: [...s.aiServices, svc],
          activeAiServiceId: s.activeAiServiceId ?? svc.id,
        }))
      },
      updateAiService: (id, cfg) => set((s) => ({
        aiServices: s.aiServices.map((svc) => svc.id === id ? { ...svc, ...cfg } : svc),
      })),
      deleteAiService: (id) => set((s) => {
        const remaining = s.aiServices.filter((svc) => svc.id !== id)
        return {
          aiServices: remaining,
          activeAiServiceId: s.activeAiServiceId === id
            ? (remaining[0]?.id ?? null)
            : s.activeAiServiceId,
        }
      }),
      setActiveAiService: (activeAiServiceId) => set({ activeAiServiceId }),

      /* ── Entity Actions ─────────────────────────────────────────────────── */

      addEntity: (position = { x: 240, y: 220 }, seed = {}) => {
        const id = makeId('entity')
        const count = get().nodes.length + 1
        const node: EntityNode = {
          id, type: 'entity', position,
          data: {
            name: seed.name ?? `Entity${count}`,
            label: seed.label ?? '新实体',
            description: seed.description ?? '描述该实体在业务语义中的含义。',
            color: seed.color ?? '#2f7d6d',
            entityType: seed.entityType,
            properties: seed.properties ?? [
              { id: makeId('prop'), name: 'id', nameZh: 'ID', type: 'string', required: true, description: '唯一标识。' },
            ],
          },
        }
        const activeModelId = get().activeModelId
        set((s) => {
          const newNodes = [...s.nodes, node]
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
            selected: { kind: 'entity', id },
          }
        })
        void api.createEntity(activeModelId, {
          id, name: node.data.name, label: node.data.label,
          description: node.data.description, color: node.data.color,
          entityType: node.data.entityType, properties: node.data.properties,
          posX: position.x, posY: position.y,
        })
        return id
      },

      addConnectedEntity: (sourceId) => {
        const source = get().nodes.find((n) => n.id === sourceId)
        const targetId = get().addEntity({
          x: (source?.position.x ?? 200) + 360,
          y: (source?.position.y ?? 160) + 40,
        })
        const edgeId = makeId('rel')
        const activeModelId = get().activeModelId
        set((s: SchemaStore) => {
          const newEdges: RelationEdge[] = [
            ...s.edges,
            {
              id: edgeId, type: 'relation' as const, source: sourceId, target: targetId,
              markerEnd: { type: MarkerType.ArrowClosed },
              data: { name: 'relatedTo', cardinality: '1:N' as const, description: '描述两个实体之间的业务关系。' },
            },
          ]
          return {
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
            selected: { kind: 'relation', id: edgeId },
            contextMenu: null,
          }
        })
        void api.createRelation(activeModelId, {
          id: edgeId, sourceId, targetId: targetId,
          name: 'relatedTo', cardinality: '1:N', description: '描述两个实体之间的业务关系。',
        })
      },

      deleteSelected: () => {
        const { selected } = get()
        if (selected.kind === 'entity') get().deleteEntity(selected.id)
        if (selected.kind === 'relation') get().deleteRelation(selected.id)
      },

      deleteEntity: (id) => {
        set((s) => {
          const newNodes = s.nodes.filter((n) => n.id !== id)
          const newEdges = s.edges.filter((e) => e.source !== id && e.target !== id)
          return {
            nodes: newNodes,
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes, edges: newEdges }),
            selected: s.selected.kind === 'entity' && s.selected.id === id ? { kind: 'workspace' } : s.selected,
            contextMenu: null,
          }
        })
        void api.deleteEntity(id)
      },

      deleteRelation: (id) => {
        set((s) => {
          const newEdges = s.edges.filter((e) => e.id !== id)
          return {
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
            selected: s.selected.kind === 'relation' && s.selected.id === id ? { kind: 'workspace' } : s.selected,
          }
        })
        void api.deleteRelation(id)
      },

      duplicateEntity: (id) => {
        const source = get().nodes.find((n) => n.id === id)
        if (!source) return
        const newId = makeId('entity')
        set((s) => {
          const newNodes = [
            ...s.nodes,
            {
              ...source, id: newId,
              position: { x: source.position.x + 48, y: source.position.y + 48 },
              data: {
                ...source.data, name: source.data.name + '_copy',
                properties: source.data.properties.map((p) => ({ ...p, id: makeId('prop') })),
              },
            },
          ]
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
            selected: { kind: 'entity', id: newId },
            contextMenu: null,
          }
        })
      },

      updateEntity: (id, patch) => {
        set((s) => {
          const newNodes = s.nodes.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
          }
        })
        void api.updateEntity(id, patch as Parameters<typeof api.updateEntity>[1])
      },

      addProperty: (entityId) => {
        set((s) => {
          const newNodes = s.nodes.map((n) =>
            n.id === entityId
              ? {
                  ...n, data: {
                    ...n.data,
                    properties: [
                      ...n.data.properties,
                      {
                        id: makeId('prop'),
                        name: `prop${n.data.properties.length + 1}`,
                        nameZh: '',
                        type: 'string' as const,
                        required: false,
                        description: '',
                      },
                    ],
                  },
                }
              : n,
          )
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
          }
        })
        const updated = get().nodes.find((n) => n.id === entityId)
        if (updated) void api.updateEntity(entityId, { properties: updated.data.properties })
      },

      updateProperty: (entityId, propertyId, patch) => {
        set((s) => {
          const newNodes = s.nodes.map((n) =>
            n.id === entityId
              ? { ...n, data: { ...n.data, properties: n.data.properties.map((p) => p.id === propertyId ? { ...p, ...patch } : p) } }
              : n,
          )
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
          }
        })
        const updated = get().nodes.find((n) => n.id === entityId)
        if (updated) void api.updateEntity(entityId, { properties: updated.data.properties })
      },

      removeProperty: (entityId, propertyId) => {
        set((s) => {
          const newNodes = s.nodes.map((n) =>
            n.id === entityId
              ? { ...n, data: { ...n.data, properties: n.data.properties.filter((p) => p.id !== propertyId) } }
              : n,
          )
          return {
            nodes: newNodes,
            models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes }),
          }
        })
        const updated = get().nodes.find((n) => n.id === entityId)
        if (updated) void api.updateEntity(entityId, { properties: updated.data.properties })
      },

      updateRelation: (id, patch) => {
        set((s) => {
          const newEdges = s.edges.map((e) =>
            e.id === id
              ? { ...e, data: { name: e.data?.name ?? 'relatedTo', cardinality: e.data?.cardinality ?? '1:N', description: e.data?.description ?? '', ...e.data, ...patch } }
              : e,
          )
          return {
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
          }
        })
        // translate midpoint object → flat midpointX/Y for the server
        const { midpoint, ...rest } = patch as typeof patch & { midpoint?: { x: number; y: number } | null }
        const apiPatch: Parameters<typeof api.updateRelation>[1] = rest as Parameters<typeof api.updateRelation>[1]
        if ('midpoint' in patch) {
          ;(apiPatch as Record<string, unknown>).midpointX = midpoint?.x ?? null
          ;(apiPatch as Record<string, unknown>).midpointY = midpoint?.y ?? null
        }
        void api.updateRelation(id, apiPatch)
      },

      rerouteRelation: (id, sourceId, targetId) => {
        set((s) => {
          const newEdges = s.edges.map((e) =>
            e.id === id ? { ...e, source: sourceId, target: targetId } : e,
          )
          return {
            edges: newEdges,
            models: patchActiveModel(s.models, s.activeModelId, { edges: newEdges }),
          }
        })
        void api.rerouteRelation(id, sourceId, targetId)
      },

      /* ── Instance Data ──────────────────────────────────────────────────── */

      setAppMode: (appMode) => set({ appMode }),
      setFactoryTab: (factoryTab) => set({ factoryTab }),
      setInstanceViewTab: (instanceViewTab) => set({ instanceViewTab }),
      setInstanceActiveEntity: (instanceActiveEntity) => set({ instanceActiveEntity }),

      addOrReplaceDataset: (dataset) => {
        // Update local state first (optimistic)
        set((s) => {
          const key = dataset.twinId
          const existing = s.instanceDatasets[key] ?? []
          const filtered = existing.filter(
            (d) => !(d.entityNodeId === dataset.entityNodeId && d.twinId === dataset.twinId),
          )
          return {
            instanceDatasets: {
              ...s.instanceDatasets,
              [key]: [...filtered, dataset],
            },
          }
        })
        // Sync to Neo4j: replace old instances, then create new batch
        void api.deleteDatasetInstances(dataset.twinId, dataset.entityNodeId)
          .then(() => api.createInstances({
            twinId:      dataset.twinId,
            entityDefId: dataset.entityNodeId,
            records:     dataset.records.map((r) => ({ id: r.id, data: r.data as Record<string, unknown> })),
            datasetId:   dataset.id,
            modelId:     dataset.modelId,
            sourceLabel: dataset.sourceLabel,
            importedAt:  dataset.importedAt,
          }))
          .catch((err: unknown) => {
            console.error('[addOrReplaceDataset] Neo4j write failed:', err)
          })
      },

      deleteDataset: (datasetId) => {
        // Find the dataset to get twinId + entityNodeId before removing from state
        let twinId = ''
        let entityDefId = ''
        const state = get()
        outer: for (const datasets of Object.values(state.instanceDatasets)) {
          for (const d of datasets) {
            if (d.id === datasetId) { twinId = d.twinId; entityDefId = d.entityNodeId; break outer }
          }
        }
        set((s) => {
          const updated: Record<string, InstanceDataset[]> = {}
          for (const [key, datasets] of Object.entries(s.instanceDatasets)) {
            updated[key] = datasets.filter((d) => d.id !== datasetId)
          }
          return { instanceDatasets: updated }
        })
        if (twinId && entityDefId) {
          void api.deleteDatasetInstances(twinId, entityDefId)
        }
      },

      updateRecord: (datasetId, recordId, data) => {
        set((s) => {
          const updated: Record<string, InstanceDataset[]> = {}
          for (const [key, datasets] of Object.entries(s.instanceDatasets)) {
            updated[key] = datasets.map((d) =>
              d.id !== datasetId ? d : {
                ...d,
                records: d.records.map((r) => r.id !== recordId ? r : { ...r, data }),
              },
            )
          }
          return { instanceDatasets: updated }
        })
        void api.updateInstance(recordId, data as Record<string, unknown>)
      },

      deleteRecord: (datasetId, recordId) => {
        set((s) => {
          const updated: Record<string, InstanceDataset[]> = {}
          for (const [key, datasets] of Object.entries(s.instanceDatasets)) {
            updated[key] = datasets.map((d) =>
              d.id !== datasetId ? d : { ...d, records: d.records.filter((r) => r.id !== recordId) },
            )
          }
          return { instanceDatasets: updated }
        })
        void api.deleteInstance(recordId)
      },

      deleteRecords: (datasetId, recordIds) => {
        if (recordIds.length === 0) return
        const idSet = new Set(recordIds)
        set((s) => {
          const updated: Record<string, InstanceDataset[]> = {}
          for (const [key, datasets] of Object.entries(s.instanceDatasets)) {
            updated[key] = datasets.map((d) =>
              d.id !== datasetId ? d : { ...d, records: d.records.filter((r) => !idSet.has(r.id)) },
            )
          }
          return { instanceDatasets: updated }
        })
        void api.deleteInstances(recordIds)
      },

      setActiveImport: (activeImport) => set({ activeImport }),

      /* ── Business Twin ──────────────────────────────────────────────────── */

      addBizTwin: (twin) => {
        set((s) => ({ bizTwins: [...s.bizTwins, twin] }))
        void api.createTwin({ id: twin.id, name: twin.name, description: twin.description, color: twin.color, modelIds: twin.modelIds })
      },

      deleteBizTwin: (twinId) => {
        set((s) => {
          const updated = { ...s.instanceDatasets }
          delete updated[twinId]
          return {
            bizTwins: s.bizTwins.filter((t) => t.id !== twinId),
            activeBizTwinId: s.activeBizTwinId === twinId
              ? (s.bizTwins.find((t) => t.id !== twinId)?.id ?? null)
              : s.activeBizTwinId,
            instanceDatasets: updated,
            instanceActiveEntity: s.activeBizTwinId === twinId ? '' : s.instanceActiveEntity,
          }
        })
        void api.deleteTwin(twinId)
      },

      updateBizTwin: (id, patch) => {
        set((s) => ({ bizTwins: s.bizTwins.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
        void api.updateTwin(id, patch as Parameters<typeof api.updateTwin>[1])
      },

      setActiveBizTwinId: (activeBizTwinId) => set({ activeBizTwinId, instanceActiveEntity: '' }),

      /* ── Neo4j ──────────────────────────────────────────────────────────── */

      queryNeo4jViaApi: async (cypher, twinId) => {
        set({ neo4jIsLoading: true, neo4jError: null })
        try {
          const body: Record<string, string> = {}
          if (cypher) {
            body.cypher = cypher
          } else if (twinId) {
            body.cypher = `MATCH (n:EntityInstance)-[:IN_TWIN]->(t:BizTwin { id: '${twinId}' }) OPTIONAL MATCH (n)-[r]->(m:EntityInstance) WHERE NOT type(r) IN ['IN_TWIN','INSTANCE_OF'] RETURN n, r, m LIMIT 2000`
          }
          const resp = await fetch('/api/graph/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!resp.ok) throw new Error(`图谱查询失败: ${resp.status}`)
          const data = await resp.json() as Neo4jGraphData
          set({ neo4jGraphData: data })
        } catch (e) {
          set({ neo4jError: e instanceof Error ? e.message : '查询失败' })
        } finally {
          set({ neo4jIsLoading: false })
        }
      },

      querySchemaOverview: async (twinId) => {
        set({ neo4jIsLoading: true, neo4jError: null })
        try {
          const resp = await fetch(`/api/graph/schema-overview?twinId=${encodeURIComponent(twinId)}`)
          if (!resp.ok) throw new Error(`本体图谱查询失败: ${resp.status}`)
          const data = await resp.json() as Neo4jGraphData
          set({ neo4jGraphData: data })
        } catch (e) {
          set({ neo4jError: e instanceof Error ? e.message : '查询失败' })
        } finally {
          set({ neo4jIsLoading: false })
        }
      },

      relinkInstances: async (twinId) => {
        set({ neo4jIsLoading: true, neo4jError: null })
        try {
          const resp = await fetch('/api/graph/relink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ twinId }),
          })
          if (!resp.ok) throw new Error(`建立关系失败: ${resp.status}`)
          const result = await resp.json() as { linked: number; created: number }
          return result
        } catch (e) {
          set({ neo4jError: e instanceof Error ? e.message : '建立关系失败' })
          return null
        } finally {
          set({ neo4jIsLoading: false })
        }
      },

      syncConstraintsAndIndexes: async () => {
        const { nodes } = get()
        const ddlStatements: string[] = []
        for (const node of nodes) {
          if (node.type !== 'entity') continue
          const label = (node.data as import('./types').EntityData).label
            || (node.data as import('./types').EntityData).name
          for (const prop of (node.data as import('./types').EntityData).properties) {
            if (prop.unique) {
              ddlStatements.push(
                `CREATE CONSTRAINT ${label}_${prop.name}_unique IF NOT EXISTS FOR (n:\`${label}\`) REQUIRE n.\`${prop.name}\` IS UNIQUE`,
              )
            }
            if (prop.indexed && !prop.unique) {
              ddlStatements.push(
                `CREATE INDEX ${label}_${prop.name}_index IF NOT EXISTS FOR (n:\`${label}\`) ON (n.\`${prop.name}\`)`,
              )
            }
          }
        }
        let synced = 0
        const errors: string[] = []
        for (const ddl of ddlStatements) {
          try {
            await api.runCypherWrite(ddl)
            synced++
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e))
          }
        }
        return { synced, errors }
      },

      generateSimData: async (cfg) => {
        const { aiServices, bizTwins } = get()
        const svc = aiServices.find((s) => s.id === cfg.aiServiceId)
        if (!svc) { alert('请先在设置中配置 AI 服务'); return }

        set({ isGenerating: true, genProgress: [] })

        const aiConfig = {
          provider: svc.provider as 'anthropic' | 'openai-compat',
          baseUrl:  svc.baseUrl,
          apiKey:   svc.apiKey,
          model:    svc.model,
        }

        try {
          const resp = await fetch('/api/ai/generate-data', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              twinId:    cfg.twinId,
              twinName:  bizTwins.find((t) => t.id === cfg.twinId)?.name,
              modelId:   cfg.modelId,
              config: {
                theme:              cfg.theme,
                entityCounts:       cfg.entityCounts,
                hierParentIds:      cfg.hierParentIds ?? {},
                locale:             cfg.locale ?? 'zh-CN',
                mode:               cfg.mode ?? 'overwrite',
                systemPrompt:       cfg.systemPrompt,
                extraInstructions:  cfg.extraInstructions,
              },
              aiConfig,
            }),
          })

          if (!resp.ok || !resp.body) {
            const errText = await resp.text().catch(() => '未知错误')
            set((s) => ({ genProgress: [...s.genProgress, { type: 'error' as const, message: errText }] }))
            return
          }

          const reader = resp.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split('\n\n')
            buffer = parts.pop() ?? ''
            for (const part of parts) {
              const line = part.trim()
              if (!line.startsWith('data: ')) continue
              const raw = line.slice(6)
              if (raw === '[DONE]') break
              try {
                const evt = JSON.parse(raw) as GenProgressEvent
                set((s) => ({ genProgress: [...s.genProgress, evt] }))
              } catch { /* ignore malformed lines */ }
            }
          }

          // Refresh instance data after generation
          await get().initFromApi()
        } catch (e) {
          set((s) => ({ genProgress: [...s.genProgress, { type: 'error' as const, message: String(e) }] }))
        } finally {
          set({ isGenerating: false })
        }
      },

      dedupInstances: async (twinId) => {
        set({ isDeduping: true })
        try {
          const result = await api.dedupInstances(twinId)
          await get().initFromApi()
          return result
        } finally {
          set({ isDeduping: false })
        }
      },

      updateColumnMapping: (csvHeader, mappedTo) => set((s) => {
        if (!s.activeImport) return {}
        return {
          activeImport: {
            ...s.activeImport,
            columnMappings: s.activeImport.columnMappings.map((m) =>
              m.csvHeader === csvHeader ? { ...m, mappedTo } : m,
            ),
          },
        }
      }),

      /* ── AI ─────────────────────────────────────────────────────────────── */

      sendAiMessage: async (content) => {
        const state = get()
        const aiConfig = state.aiServices.find((s) => s.id === state.activeAiServiceId)

        if (!aiConfig) {
          set((s) => ({
            aiChatMsgs: [...s.aiChatMsgs, {
              id: makeId('msg'), role: 'assistant' as const,
              content: '⚠️ 尚未选择大模型服务，请前往「模型工场」添加并配置服务。',
            }],
          }))
          return
        }

        const needsKey = aiConfig.provider === 'anthropic' || (aiConfig.provider === 'openai-compat' && !aiConfig.baseUrl)
        if (needsKey && !aiConfig.apiKey.trim()) {
          set((s) => ({
            aiChatMsgs: [...s.aiChatMsgs, {
              id: makeId('msg'), role: 'assistant' as const,
              content: '⚠️ 当前服务缺少 API Key，请在「模型工场」中编辑该服务配置。',
            }],
          }))
          return
        }

        const userMsg: AiChatMsg = { id: makeId('msg'), role: 'user', content }
        set((s) => ({ aiChatMsgs: [...s.aiChatMsgs, userMsg], isAiLoading: true }))

        const schemaCtx = buildSchemaContext(state.nodes, state.edges)
        const skill = SKILL_DEFINITIONS[state.activeSkillId ?? 'free-chat']
        const currentOdl = state.activeModelId
          ? state.models.find((m) => m.id === state.activeModelId)?.odl ?? ''
          : ''
        const systemPrompt = skill.buildSystemPrompt(JSON.stringify(schemaCtx, null, 2), currentOdl)
        const useTools = skill.anthropicTools.length > 0

        /* Append doc context if doc-extract skill and context is available */
        const effectiveContent =
          state.activeSkillId === 'doc-extract' && state.docContext.trim()
            ? `${content}\n\n---\n【业务文档内容】\n${state.docContext}`
            : content

        const effectiveUserMsg: AiChatMsg = { id: makeId('msg'), role: 'user', content: effectiveContent }
        const history = [...state.aiChatMsgs, effectiveUserMsg].map((m) => ({ role: m.role, content: m.content }))

        const assistantMsgId = makeId('msg')
        set((s) => ({
          aiChatMsgs: [...s.aiChatMsgs, { id: assistantMsgId, role: 'assistant' as const, content: '' }],
        }))

        /* ── Helper: parse suggest_odl_update into OdlPatch ── */
        function parseOdlToolCall(name: string, input: Record<string, unknown>): OdlPatch | null {
          if (name !== 'suggest_odl_update') return null
          return {
            description: String(input.description ?? ''),
            section: String(input.section ?? '') as OdlPatch['section'],
            content: String(input.content ?? ''),
          }
        }

        /* ── Helper: parse a single tool call into OntologyPatch ── */
        function parseToolCall(name: string, input: Record<string, unknown>): OntologyPatch | null {
          switch (name) {
            case 'suggest_add_entity':
              return {
                kind: 'add_entity',
                data: {
                  name: String(input.name ?? ''),
                  label: String(input.label ?? input.name ?? ''),
                  description: String(input.description ?? ''),
                  color: String(input.color ?? '#4f7bbd'),
                  entityType: (input.entityType as EntityData['entityType']) ?? 'abstract',
                  properties: (input.properties as EntityProperty[] | undefined) ?? [],
                },
              }
            case 'suggest_add_relation':
              return {
                kind: 'add_relation',
                sourceLabel: String(input.sourceLabel ?? ''),
                targetLabel: String(input.targetLabel ?? ''),
                data: {
                  name: String(input.name ?? ''),
                  cardinality: (input.cardinality as RelationData['cardinality']) ?? '1:N',
                  description: String(input.description ?? ''),
                },
              }
            case 'suggest_add_property':
              return {
                kind: 'add_property',
                entityName: String(input.entityName ?? ''),
                property: {
                  name: String(input.name ?? ''),
                  nameZh: input.nameZh ? String(input.nameZh) : undefined,
                  type: (input.type as EntityProperty['type']) ?? 'string',
                  required: Boolean(input.required ?? false),
                  description: String(input.description ?? ''),
                },
              }
            case 'suggest_cypher_note':
              return {
                kind: 'cypher_note',
                cypher: String(input.cypher ?? ''),
                description: String(input.description ?? ''),
              }
            default:
              return null
          }
        }

        try {
          /* ── Non-streaming path (skills with tools) ── */
          if (useTools) {
            let response: Response
            if (aiConfig.provider === 'anthropic') {
              response = await fetch('/api/anthropic/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': aiConfig.apiKey,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: aiConfig.model || 'claude-sonnet-4-6',
                  max_tokens: 4096,
                  system: systemPrompt,
                  tools: skill.anthropicTools,
                  messages: history,
                }),
              })
            } else {
              const base = aiConfig.baseUrl ? aiConfig.baseUrl.replace(/\/$/, '') : '/api/openai'
              const isLocal = base.startsWith('http://localhost') || base.startsWith('http://127.0.0.1')
              const headers: Record<string, string> = { 'Content-Type': 'application/json' }
              if (aiConfig.apiKey) headers['Authorization'] = `Bearer ${aiConfig.apiKey}`
              response = await fetch(`${base}/v1/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: aiConfig.model || 'gpt-4o',
                  max_tokens: 4096,
                  tools: skill.openAiTools,
                  messages: [{ role: 'system', content: systemPrompt }, ...history],
                  // Disable thinking mode for local models (Ollama qwen3/qwen3.5 etc.)
                  // to avoid reasoning tokens consuming the token budget before tool calls
                  ...(isLocal ? { think: false } : {}),
                }),
              })
            }

            if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
            const result = await response.json() as Record<string, unknown>

            let textContent = ''
            const newPatches: PatchItem[] = []
            const newOdlPatches: OdlPatchItem[] = []

            if (aiConfig.provider === 'anthropic') {
              for (const block of (result.content as Array<Record<string, unknown>>) ?? []) {
                if (block.type === 'text') textContent += String(block.text ?? '')
                else if (block.type === 'tool_use') {
                  const name = String(block.name)
                  const input = block.input as Record<string, unknown>
                  const odlP = parseOdlToolCall(name, input)
                  if (odlP) {
                    newOdlPatches.push({ id: makeId('patch'), patch: odlP, status: 'pending', msgId: assistantMsgId })
                  } else {
                    const p = parseToolCall(name, input)
                    if (p) newPatches.push({ id: makeId('patch'), patch: p, status: 'pending', msgId: assistantMsgId })
                  }
                }
              }
            } else {
              const msg = (result.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown> | undefined
              textContent = String(msg?.content ?? '')
              for (const tc of (msg?.tool_calls as Array<Record<string, unknown>>) ?? []) {
                try {
                  const fn = tc.function as Record<string, unknown>
                  const name = String(fn.name)
                  const args = JSON.parse(String(fn.arguments ?? '{}')) as Record<string, unknown>
                  const odlP = parseOdlToolCall(name, args)
                  if (odlP) {
                    newOdlPatches.push({ id: makeId('patch'), patch: odlP, status: 'pending', msgId: assistantMsgId })
                  } else {
                    const p = parseToolCall(name, args)
                    if (p) newPatches.push({ id: makeId('patch'), patch: p, status: 'pending', msgId: assistantMsgId })
                  }
                } catch { /* ignore malformed tool call */ }
              }
            }

            const totalSuggestions = newPatches.length + newOdlPatches.length
            const displayText = totalSuggestions > 0
              ? `已生成 ${totalSuggestions} 条建议，请查看下方建议面板。${textContent ? '\n\n' + textContent : ''}`
              : (textContent || '（模型未返回内容）')

            set((s) => ({
              aiChatMsgs: s.aiChatMsgs.map((m) =>
                m.id === assistantMsgId ? { ...m, content: displayText } : m
              ),
              pendingPatches: [...s.pendingPatches, ...newPatches],
              odlPatches: [...s.odlPatches, ...newOdlPatches],
            }))
            return
          }

          /* ── Streaming path (skills without tools) ── */
          let response: Response
          if (aiConfig.provider === 'anthropic') {
            response = await fetch('/api/anthropic/v1/messages', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': aiConfig.apiKey,
                'anthropic-version': '2023-06-01',
              },
              body: JSON.stringify({
                model: aiConfig.model || 'claude-sonnet-4-6',
                max_tokens: 2048,
                stream: true,
                system: systemPrompt,
                messages: history,
              }),
            })
          } else {
            const base = aiConfig.baseUrl ? aiConfig.baseUrl.replace(/\/$/, '') : '/api/openai'
            const isLocal = base.startsWith('http://localhost') || base.startsWith('http://127.0.0.1')
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (aiConfig.apiKey) headers['Authorization'] = `Bearer ${aiConfig.apiKey}`
            response = await fetch(`${base}/v1/chat/completions`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: aiConfig.model || 'gpt-4o',
                max_tokens: 2048,
                stream: true,
                messages: [{ role: 'system', content: systemPrompt }, ...history],
                ...(isLocal ? { think: false } : {}),
              }),
            })
          }

          if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)

          const reader = response.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (!data || data === '[DONE]') continue
              try {
                const event = JSON.parse(data)
                const chunk = aiConfig.provider === 'anthropic'
                  ? (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' ? event.delta.text : '')
                  : (event.choices?.[0]?.delta?.content ?? '')
                if (chunk) {
                  set((s) => ({
                    aiChatMsgs: s.aiChatMsgs.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m,
                    ),
                  }))
                }
              } catch { /* ignore malformed SSE */ }
            }
          }
        } catch (error) {
          set((s) => ({
            aiChatMsgs: s.aiChatMsgs.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: `❌ 请求失败：${error instanceof Error ? error.message : '未知错误'}\n\n请检查配置是否正确及网络连接。` }
                : m,
            ),
          }))
        } finally {
          set({ isAiLoading: false })
        }
      },

      clearAiChat: () => set({ aiChatMsgs: [], pendingPatches: [] }),

      clearSmartChat: () => set({ smartChatMsgs: [] }),

      sendSmartMessage: async (content, useSkills = true, reportMode = false) => {
        const state    = get()
        const aiConfig = state.aiServices.find((s) => s.id === state.activeAiServiceId)

        const addErrMsg = (text: string) =>
          set((s) => ({ smartChatMsgs: [...s.smartChatMsgs, { id: makeId('msg'), role: 'assistant' as const, content: text }] }))

        if (!aiConfig) {
          addErrMsg('⚠️ 尚未选择大模型服务，请在 AI 面板顶部的下拉菜单中选择已配置的服务。')
          return
        }
        const needsKey = aiConfig.provider === 'anthropic' || (aiConfig.provider === 'openai-compat' && !aiConfig.baseUrl)
        if (needsKey && !aiConfig.apiKey.trim()) {
          addErrMsg('⚠️ 当前服务缺少 API Key，请前往「模型工场 → 大模型服务」编辑该服务配置。')
          return
        }

        // Build history BEFORE adding current user message
        const history = state.smartChatMsgs.map((m) => ({ role: m.role, content: m.content }))

        const userMsg: AiChatMsg = { id: makeId('msg'), role: 'user', content }
        const assistantMsgId = makeId('msg')
        set((s) => ({
          smartChatMsgs: [
            ...s.smartChatMsgs,
            userMsg,
            { id: assistantMsgId, role: 'assistant' as const, content: '' },
          ],
          isSmartChatLoading: true,
        }))

        try {
          // Build schema context from the active twin's linked models (same as ontology design AI)
          const activeTwin = state.bizTwins.find((t) => t.id === state.activeBizTwinId)
          const twinNodes: import('./types').EntityNode[] = []
          const twinEdges: import('./types').RelationEdge[] = []
          const seenIds = new Set<string>()
          for (const mid of activeTwin?.modelIds ?? []) {
            const model = state.models.find((m) => m.id === mid)
            for (const n of model?.nodes ?? []) {
              if (n.type === 'entity' && !seenIds.has(n.id)) { seenIds.add(n.id); twinNodes.push(n) }
            }
            for (const e of model?.edges ?? []) {
              if (!seenIds.has(e.id)) { seenIds.add(e.id); twinEdges.push(e) }
            }
          }
          const schemaCtx = buildSchemaContext(twinNodes, twinEdges)

          // Collect ODL from all linked models (merged, separated by model name comment)
          const odlParts: string[] = []
          for (const mid of activeTwin?.modelIds ?? []) {
            const model = state.models.find((m) => m.id === mid)
            if (model?.odl?.trim()) {
              odlParts.push(`# --- 模型: ${model.name} ---\n${model.odl}`)
            }
          }
          const odlContext = odlParts.join('\n\n')

          const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: content,
              twinId:  state.activeBizTwinId ?? undefined,
              modelId: activeTwin?.modelIds?.[0] ?? undefined,
              schemaContext: JSON.stringify(schemaCtx, null, 2),
              odlContext: odlContext || undefined,
              aiConfig: {
                provider: aiConfig.provider,
                baseUrl:  aiConfig.baseUrl ?? '',
                model:    aiConfig.model,
                apiKey:   aiConfig.apiKey,
              },
              history,
              useSkills,
              reportMode,
            }),
          })

          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const reader  = response.body!.getReader()
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
                const chunk = JSON.parse(raw)   // backend sends JSON.stringify(string)
                if (typeof chunk === 'string' && chunk) {
                  set((s) => ({
                    smartChatMsgs: s.smartChatMsgs.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m,
                    ),
                  }))
                }
              } catch { /* skip malformed SSE line */ }
            }
          }
        } catch (error) {
          set((s) => ({
            smartChatMsgs: s.smartChatMsgs.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: `❌ 请求失败：${error instanceof Error ? error.message : '未知错误'}` }
                : m,
            ),
          }))
        } finally {
          set({ isSmartChatLoading: false })
        }
      },

      setActiveSkill: (id) => set({ activeSkillId: id, pendingPatches: [], odlPatches: [] }),
      setDocContext: (text) => set({ docContext: text }),
      clearPatches: () => set({ pendingPatches: [] }),

      applyOdlPatch: async (id) => {
        const item = get().odlPatches.find((p) => p.id === id)
        if (!item || item.status !== 'pending') return
        const currentOdl = get().models.find((m) => m.id === get().activeModelId)?.odl ?? ''
        const merged = mergeOdlSection(currentOdl, item.patch.section, item.patch.content)
        await get().saveOdl(merged)
        set((s) => ({
          odlPatches: s.odlPatches.map((p) => p.id === id ? { ...p, status: 'applied' } : p),
        }))
      },

      dismissOdlPatch: (id) =>
        set((s) => ({
          odlPatches: s.odlPatches.map((p) => p.id === id ? { ...p, status: 'dismissed' } : p),
        })),

      clearOdlPatches: () => set({ odlPatches: [] }),

      dismissPatch: (patchId) =>
        set((s) => ({
          pendingPatches: s.pendingPatches.map((p) =>
            p.id === patchId ? { ...p, status: 'dismissed' } : p
          ),
        })),

      applyPatch: (patchId) => {
        const state = get()
        const item = state.pendingPatches.find((p) => p.id === patchId)
        if (!item || item.status !== 'pending') return
        const { patch } = item

        if (patch.kind === 'add_entity') {
          const pos = { x: 160 + Math.random() * 500, y: 140 + Math.random() * 340 }
          const propsWithIds: EntityProperty[] = (patch.data.properties ?? []).map((p) => ({
            id: makeId('prop'),
            name: p.name ?? '',
            nameZh: p.nameZh,
            type: p.type ?? 'string',
            required: p.required ?? false,
            description: p.description ?? '',
          }))
          get().addEntity(pos, { ...patch.data, properties: propsWithIds })
        } else if (patch.kind === 'add_relation') {
          const src = state.nodes.find(
            (n) => n.data.label === patch.sourceLabel || n.data.name === patch.sourceLabel
          )
          const tgt = state.nodes.find(
            (n) => n.data.label === patch.targetLabel || n.data.name === patch.targetLabel
          )
          if (src && tgt) {
            get().addRelationBetween(src.id, tgt.id, patch.data)
          } else {
            alert(`无法找到实体「${patch.sourceLabel}」或「${patch.targetLabel}」，请先确保它们存在于画布中。`)
            return
          }
        } else if (patch.kind === 'add_property') {
          const node = state.nodes.find(
            (n) => n.data.name === patch.entityName || n.data.label === patch.entityName
          )
          if (node) {
            const newProp: EntityProperty = {
              id: makeId('prop'),
              name: patch.property.name,
              nameZh: patch.property.nameZh,
              type: patch.property.type,
              required: patch.property.required,
              description: patch.property.description,
            }
            get().updateEntity(node.id, { properties: [...node.data.properties, newProp] })
          } else {
            alert(`无法找到实体「${patch.entityName}」，请先确保它存在于画布中。`)
            return
          }
        }
        // cypher_note: no auto-apply

        set((s) => ({
          pendingPatches: s.pendingPatches.map((p) =>
            p.id === patchId ? { ...p, status: 'applied' } : p
          ),
        }))
      },

      /* ── Bootstrap from Neo4j API ──────────────────────────────────────── */

      initFromApi: async () => {
        set({ apiSyncStatus: 'syncing' })

        // Step 1: verify backend reachable
        try { await api.health() }
        catch { set({ apiSyncStatus: 'error' }); return }

        // Step 2: load models
        try {
          const modelDtos = await api.getModels()
          if (modelDtos.length === 0) {
            // First run — seed defaults then reload
            const { models } = get()
            for (const m of models) {
              await seedModelToApi(m).catch(() => {})
            }
            const seeded      = await api.getModels()
            const fullModels  = await Promise.all(seeded.map(loadFullModel))
            const active      = fullModels[0]
            set({
              models: fullModels,
              activeModelId: active?.id ?? get().activeModelId,
              nodes: active?.nodes ?? [],
              edges: active?.edges ?? [],
            })
          } else {
            const fullModels  = await Promise.all(modelDtos.map(loadFullModel))
            const current     = get()
            const activeModel = fullModels.find((m) => m.id === current.activeModelId) ?? fullModels[0]
            set({
              models: fullModels,
              activeModelId: activeModel?.id ?? current.activeModelId,
              nodes: activeModel?.nodes ?? [],
              edges: activeModel?.edges ?? [],
            })
          }
        } catch { /* models failed — keep in-memory state, continue */ }

        // Step 3: load twins
        let twinDtos: import('./lib/api').BizTwinDto[] = []
        try {
          twinDtos = await api.getTwins()
          if (twinDtos.length > 0) {
            set((s) => ({
              bizTwins: twinDtos.map(bizTwinDtoToLocal),
              activeBizTwinId: s.activeBizTwinId ?? twinDtos[0]?.id ?? null,
            }))
          }
        } catch { /* twins failed — keep in-memory state, continue */ }

        // Step 4: load instances per twin
        try {
          const instanceDatasets: Record<string, InstanceDataset[]> = {}
          for (const twin of twinDtos) {
            const rawInstances = await api.getInstances(twin.id).catch(() => [])
            if (!rawInstances.length) continue

            const byDataset = new Map<string, typeof rawInstances>()
            for (const inst of rawInstances) {
              const dsId  = String(inst._datasetId ?? `${twin.id}:${inst._entityDefId}`)
              const group = byDataset.get(dsId) ?? []
              group.push(inst)
              byDataset.set(dsId, group)
            }

            const datasets: InstanceDataset[] = []
            for (const [dsId, insts] of byDataset) {
              const first = insts[0]
              datasets.push({
                id:           dsId,
                twinId:       twin.id,
                modelId:      String(first._modelId ?? ''),
                entityNodeId: String(first._entityDefId ?? ''),
                importedAt:   String(first._importedAt ?? new Date().toISOString()),
                sourceLabel:  String(first._sourceLabel ?? ''),
                records:      insts.map((inst) => {
                  const data: Record<string, import('./types').InstanceFieldValue> = {}
                  for (const [k, v] of Object.entries(inst)) {
                    if (k.startsWith('_')) continue
                    data[k] = v as import('./types').InstanceFieldValue
                  }
                  return { id: String(inst._id ?? inst._datasetId), data, validationErrors: {} }
                }),
              })
            }
            if (datasets.length) instanceDatasets[twin.id] = datasets
          }
          if (Object.keys(instanceDatasets).length) set({ instanceDatasets })
        } catch { /* instances failed — keep in-memory state */ }

        set({ apiSyncStatus: 'idle' })
      },

      exportSchema: () => {
        const { nodes, edges } = get()
        const blob = new Blob([JSON.stringify(buildSchemaContext(nodes, edges), null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'schema.json'; a.click()
        URL.revokeObjectURL(url)
      },

      saveOdl: async (yaml) => {
        const { activeModelId, models } = get()
        await api.saveOdl(activeModelId, yaml)
        set((s) => ({
          models: s.models.map((m) => m.id === activeModelId ? { ...m, odl: yaml } : m),
        }))
      },

      importSchemaFromData: async (newNodes, newEdges) => {
        const { activeModelId, nodes: oldNodes, edges: oldEdges } = get()

        // Delete old entities and relations from backend (best-effort)
        for (const e of oldEdges) await api.deleteRelation(e.id).catch(() => {})
        for (const n of oldNodes) await api.deleteEntity(n.id).catch(() => {})

        // Create new entities
        for (const n of newNodes) {
          await api.createEntity(activeModelId, {
            id: n.id, name: n.data.name, label: n.data.label,
            description: n.data.description, color: n.data.color,
            entityType: n.data.entityType, properties: n.data.properties,
            posX: n.position.x, posY: n.position.y,
          }).catch(() => {})
        }
        // Create new relations
        for (const e of newEdges) {
          await api.createRelation(activeModelId, {
            id: e.id, sourceId: e.source, targetId: e.target,
            name: e.data?.name ?? 'relatedTo',
            label: e.data?.label,
            cardinality: e.data?.cardinality ?? '1:N',
            description: e.data?.description ?? '',
            relationCategory: e.data?.relationCategory,
          }).catch(() => {})
        }

        // Update local state
        set((s) => ({
          nodes: newNodes,
          edges: newEdges,
          models: patchActiveModel(s.models, s.activeModelId, { nodes: newNodes, edges: newEdges }),
          selected: { kind: 'workspace' },
        }))
      },

      mergeSchemaFromData: async (newNodes, newEdges) => {
        const { activeModelId } = get()
        for (const n of newNodes) {
          await api.createEntity(activeModelId, {
            id: n.id, name: n.data.name, label: n.data.label,
            description: n.data.description, color: n.data.color,
            entityType: n.data.entityType, properties: n.data.properties,
            posX: n.position.x, posY: n.position.y,
          }).catch(() => {})
        }
        for (const e of newEdges) {
          await api.createRelation(activeModelId, {
            id: e.id, sourceId: e.source, targetId: e.target,
            name: e.data?.name ?? 'relatedTo',
            label: e.data?.label,
            cardinality: e.data?.cardinality ?? '1:N',
            description: e.data?.description ?? '',
            relationCategory: e.data?.relationCategory,
          }).catch(() => {})
        }
        set((s) => {
          const merged = { nodes: [...s.nodes, ...newNodes], edges: [...s.edges, ...newEdges] }
          return {
            ...merged,
            models: patchActiveModel(s.models, s.activeModelId, merged),
          }
        })
      },
    }),
    {
      name: 'ontology-studio-v4',
      merge: (persisted: unknown, current: SchemaStore): SchemaStore => {
        const p = persisted as Partial<SchemaStore> & { aiConfig?: AiConfig }
        const merged = { ...current, ...p } as SchemaStore
        // Inject built-in sample models if missing (e.g. after a code update)
        for (const builtIn of [travelOntologyModel]) {
          if (!merged.models.some((m) => m.id === builtIn.id)) {
            merged.models = [...merged.models, builtIn]
          }
        }
        // Migrate legacy aiConfig → aiServices
        if (p.aiConfig && (!merged.aiServices || merged.aiServices.length === 0)) {
          const old = p.aiConfig
          if (old.apiKey || old.baseUrl) {
            const migrated: AiServiceConfig = {
              id: makeId('svc'),
              name: old.provider === 'anthropic' ? 'Anthropic Claude' : (old.baseUrl || 'OpenAI'),
              provider: old.provider as AiProvider,
              baseUrl: old.baseUrl,
              model: old.model,
              apiKey: old.apiKey,
            }
            merged.aiServices = [migrated]
            merged.activeAiServiceId = migrated.id
          }
        }
        // Migrate legacy instanceDatasets (keyed by modelId) → keyed by twinId
        if ((!merged.bizTwins || merged.bizTwins.length === 0) && merged.instanceDatasets) {
          const entries = Object.entries(merged.instanceDatasets)
          const hasLegacyData = entries.some(([, ds]) => ds.length > 0 && ds[0] && !('twinId' in ds[0]))
          if (hasLegacyData) {
            const newTwins: BizTwin[] = []
            const newDatasets: Record<string, InstanceDataset[]> = {}
            for (const [modelId, datasets] of entries) {
              if (datasets.length === 0) continue
              const twinId = makeId('twin')
              const modelName = merged.models.find((m) => m.id === modelId)?.name ?? '默认孪生'
              newTwins.push({
                id: twinId, name: modelName, description: '',
                modelIds: [modelId], color: '#3b82f6',
                createdAt: new Date().toISOString(),
              })
              newDatasets[twinId] = datasets.map((d) => ({ ...d, twinId }))
            }
            merged.bizTwins = newTwins
            merged.activeBizTwinId = newTwins[0]?.id ?? null
            merged.instanceDatasets = newDatasets
          }
        }
        return merged
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
      partialize: (s) => ({
        // UI preferences only — data is loaded from Neo4j via initFromApi
        aiServices: s.aiServices,
        activeAiServiceId: s.activeAiServiceId,
        canvasView: s.canvasView,
        sidebarOpen: s.sidebarOpen,
        inspectorOpen: s.inspectorOpen,
        showMiniMap: s.showMiniMap,
        globeNodeSize: s.globeNodeSize,
        appMode: s.appMode,
        factoryTab: s.factoryTab,
        activeModelId: s.activeModelId,
        activeBizTwinId: s.activeBizTwinId,
        activeSkillId: s.activeSkillId,
      }),
    },
  ),
)
