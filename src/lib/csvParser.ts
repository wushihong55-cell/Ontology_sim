import type { EntityNode, EntityProperty, ColumnMapping } from '../types'

export type FolderFieldMapping = {
  jsonPath: string
  entityNodeId: string | null
  propertyName: string | null
}

export type ParseResult = {
  headers: string[]
  rows: Array<Record<string, string>>
  error: string | null
}

// Recursively flatten a nested JSON object to scalar key-value pairs.
// Arrays of objects are expanded using [*] notation (first element used as sample value).
// Primitive arrays and empty arrays are skipped.
export function flattenJsonDocument(
  obj: unknown,
  prefix = '',
  result: Record<string, string> = {},
): Record<string, string> {
  if (obj == null || Array.isArray(obj) || typeof obj !== 'object') {
    if (prefix) result[prefix] = obj != null ? String(obj) : ''
    return result
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(value)) {
      // Expand arrays of objects with [*] notation; use first element as sample
      const objItems = (value as unknown[]).filter(
        (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
      )
      if (objItems.length > 0) {
        flattenJsonDocument(objItems[0], `${path}[*]`, result)
      }
    } else if (value !== null && typeof value === 'object') {
      flattenJsonDocument(value, path, result)
    } else {
      result[path] = value != null ? String(value) : ''
    }
  }
  return result
}

// Extract all rows from an array-of-objects field in a JSON document.
// arrayPath: e.g. "input.行程明细[*]" — the [*] suffix marks the array.
// Returns one flat Record per array element (keys are the element's own field names).
export function extractArrayRows(obj: unknown, arrayPath: string): Record<string, string>[] {
  const pathToArray = arrayPath.replace(/\[\*\]$/, '')
  const parts = pathToArray ? pathToArray.split('.') : []
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return []
    current = (current as Record<string, unknown>)[part]
  }
  if (!Array.isArray(current)) return []
  return (current as unknown[])
    .filter((x) => x !== null && typeof x === 'object' && !Array.isArray(x))
    .map((item) => {
      const row: Record<string, string> = {}
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (v !== null && typeof v === 'object') continue
        row[k] = v != null ? String(v) : ''
      }
      return row
    })
}

// Smart-map JSON field paths to entity properties.
// Priority 1: exact match on name or nameZh (case-insensitive).
// Priority 2: substring contains match on name or nameZh.
export function smartMapFields(
  jsonKeys: string[],
  properties: EntityProperty[],
): ColumnMapping[] {
  return jsonKeys.map((key) => {
    const leaf = key.split('.').pop()!
    const leafLower = leaf.toLowerCase()

    const exact = properties.find(
      (p) => p.name.toLowerCase() === leafLower || (p.nameZh ?? '').toLowerCase() === leafLower,
    )
    if (exact) return { csvHeader: key, mappedTo: exact.name }

    const contains = properties.find((p) => {
      const n = p.name.toLowerCase()
      const zh = (p.nameZh ?? '').toLowerCase()
      return n.includes(leafLower) || leafLower.includes(n)
        || (zh && (zh.includes(leafLower) || leafLower.includes(zh)))
    })
    return { csvHeader: key, mappedTo: contains?.name ?? null }
  })
}

// Multi-entity smart mapping: each JSON field is matched against ALL entity properties.
// Returns FolderFieldMapping[] where each field has an (entityNodeId, propertyName) pair.
export function smartMapFieldsMultiEntity(
  jsonKeys: string[],
  entityNodes: EntityNode[],
): FolderFieldMapping[] {
  return jsonKeys.map((key) => {
    const leaf = key.split('.').pop()!.toLowerCase()
    // P1: exact match across all entities
    for (const node of entityNodes) {
      const m = node.data.properties.find(
        (p) => p.name.toLowerCase() === leaf || (p.nameZh ?? '').toLowerCase() === leaf,
      )
      if (m) return { jsonPath: key, entityNodeId: node.id, propertyName: m.name }
    }
    // P2: contains match across all entities
    for (const node of entityNodes) {
      const m = node.data.properties.find((p) => {
        const n = p.name.toLowerCase(), zh = (p.nameZh ?? '').toLowerCase()
        return n.includes(leaf) || leaf.includes(n)
          || (zh && (zh.includes(leaf) || leaf.includes(zh)))
      })
      if (m) return { jsonPath: key, entityNodeId: node.id, propertyName: m.name }
    }
    return { jsonPath: key, entityNodeId: null, propertyName: null }
  })
}

export function parseCSV(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [], error: '文件为空' }

  const parseRow = (line: string): string[] => {
    const fields: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    fields.push(cur.trim())
    return fields
  }

  const headers = parseRow(lines[0])
  if (headers.length === 0) return { headers: [], rows: [], error: '无法解析表头' }

  const rows: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = values[idx] ?? '' })
    rows.push(row)
  }

  return { headers, rows, error: null }
}

export function parseJSON(text: string): ParseResult {
  try {
    const parsed = JSON.parse(text)
    let arr: unknown[]
    if (Array.isArray(parsed)) {
      arr = parsed
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).data)) {
      arr = (parsed as Record<string, unknown[]>).data
    } else {
      return { headers: [], rows: [], error: 'JSON 格式不支持：需要数组或含 data 字段的对象' }
    }
    if (arr.length === 0) return { headers: [], rows: [], error: 'JSON 数组为空' }

    const headers = Object.keys(arr[0] as object)
    const rows = arr.map((item) => {
      const row: Record<string, string> = {}
      headers.forEach((h) => {
        const v = (item as Record<string, unknown>)[h]
        row[h] = v == null ? '' : String(v)
      })
      return row
    })
    return { headers, rows, error: null }
  } catch {
    return { headers: [], rows: [], error: '无效的 JSON 格式' }
  }
}
