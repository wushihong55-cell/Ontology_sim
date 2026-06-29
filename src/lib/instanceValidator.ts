import type { EntityProperty, PropertyType, ColumnMapping, InstanceRecord, InstanceFieldValue } from '../types'
import { makeId } from '../store'

export function coerceValue(raw: string, type: PropertyType): InstanceFieldValue {
  const trimmed = raw.trim()
  if (trimmed === '') {
    // String and enum types can hold empty string; numeric/boolean/date types → null
    return (type === 'string' || type === 'enum') ? '' : null
  }
  switch (type) {
    case 'number': {
      const n = parseFloat(trimmed)
      return isNaN(n) ? null : n
    }
    case 'boolean':
      return trimmed.toLowerCase() === 'true' || trimmed === '1'
    case 'date': {
      const ts = Date.parse(trimmed)
      return isNaN(ts) ? null : new Date(ts).toISOString()
    }
    default:
      return trimmed
  }
}

export function validateRecord(
  data: Record<string, InstanceFieldValue>,
  properties: EntityProperty[],
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const prop of properties) {
    const val = data[prop.name]
    if (prop.required && (val === null || val === undefined || val === '')) {
      errors[prop.name] = `${prop.nameZh || prop.name} 为必填字段`
      continue
    }
    if (val !== null && val !== undefined && val !== '') {
      if (prop.type === 'number' && typeof val !== 'number') {
        errors[prop.name] = `必须是有效数字`
      } else if (prop.type === 'date' && typeof val !== 'string') {
        errors[prop.name] = `必须是有效日期（如 2024-01-15）`
      }
      // Constraint validation
      if (!errors[prop.name] && prop.constraints) {
        const c = prop.constraints
        if (prop.type === 'enum' && c.enumValues?.length) {
          if (!c.enumValues.includes(String(val))) {
            errors[prop.name] = `"${val}" 不在枚举值范围内（${c.enumValues.join('、')}）`
          }
        } else if (prop.type === 'number' && typeof val === 'number') {
          if (c.min !== undefined && val < c.min) errors[prop.name] = `不能小于 ${c.min}`
          else if (c.max !== undefined && val > c.max) errors[prop.name] = `不能大于 ${c.max}`
        } else if (prop.type === 'string' && typeof val === 'string') {
          if (c.minLength !== undefined && val.length < c.minLength) errors[prop.name] = `长度不能少于 ${c.minLength}`
          else if (c.maxLength !== undefined && val.length > c.maxLength) errors[prop.name] = `长度不能超过 ${c.maxLength}`
          else if (c.pattern) {
            try { if (!new RegExp(c.pattern).test(val)) errors[prop.name] = `格式不符合规则 ${c.pattern}` }
            catch { /* 正则语法错误跳过 */ }
          }
        } else if (prop.type === 'date' && typeof val === 'string') {
          if (c.minDate && val < c.minDate) errors[prop.name] = `日期不能早于 ${c.minDate}`
          else if (c.maxDate && val > c.maxDate) errors[prop.name] = `日期不能晚于 ${c.maxDate}`
        }
      }
    }
  }
  return errors
}

export function buildInstanceRecords(
  rows: Array<Record<string, string>>,
  mappings: ColumnMapping[],
  properties: EntityProperty[],
): InstanceRecord[] {
  return rows.map((row) => {
    const data: Record<string, InstanceFieldValue> = {}
    for (const mapping of mappings) {
      if (!mapping.mappedTo) continue
      const prop = properties.find((p) => p.name === mapping.mappedTo)
      if (!prop) continue
      data[prop.name] = coerceValue(row[mapping.csvHeader] ?? '', prop.type)
    }
    const validationErrors = validateRecord(data, properties)
    return { id: makeId('row'), data, validationErrors }
  })
}
