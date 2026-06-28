import { Router } from 'express'
import { runQuery, runWrite } from '../neo4j/driver'

export const instancesRouter = Router()

/** GET /api/instances?twinId=xxx[&entityDefId=yyy] */
instancesRouter.get('/', async (req, res) => {
  const { twinId, entityDefId } = req.query as Record<string, string>
  if (!twinId) return res.status(400).json({ error: 'twinId is required' })
  try {
    const cypher = entityDefId
      ? `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
         WHERE n._entityDefId = $entityDefId
         RETURN n { .* } AS instance`
      : `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
         RETURN n { .* } AS instance`
    const rows = await runQuery(cypher, { twinId, entityDefId: entityDefId ?? null })
    res.json(rows.map((r: any) => r.instance))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** POST /api/instances — create a batch of instances for one entity */
instancesRouter.post('/', async (req, res) => {
  const { twinId, entityDefId, entityLabel, records, datasetId, modelId, sourceLabel, importedAt } = req.body
  if (!twinId || !entityDefId || !Array.isArray(records)) {
    return res.status(400).json({ error: 'twinId, entityDefId and records are required' })
  }
  if (records.length === 0) {
    return res.status(201).json([])
  }
  try {
    const ts = importedAt ?? new Date().toISOString()

    // Build one property map per record, filtering out null/undefined values
    // (Neo4j does not support null as a property value in CREATE)
    const propsList = records.map((record: { id?: string; data?: Record<string, unknown> }) => {
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(record.data ?? {})) {
        if (v !== null && v !== undefined) props[k] = v
      }
      props._id          = record.id ?? `rec-${Math.random().toString(36).slice(2)}`
      props._twinId      = twinId
      props._entityDefId = entityDefId
      props._datasetId   = datasetId   ?? `${twinId}:${entityDefId}`
      props._modelId     = modelId     ?? ''
      props._sourceLabel = sourceLabel ?? ''
      props._importedAt  = ts
      return props
    })

    // Verify BizTwin exists first so we can return a useful error
    const twinCheck = await runQuery(
      `MATCH (t:BizTwin { id: $twinId }) RETURN t.id AS id`,
      { twinId },
    )
    if (!twinCheck.length) {
      return res.status(404).json({ error: `BizTwin '${twinId}' not found in Neo4j` })
    }

    // Batch insert via UNWIND — one round-trip regardless of record count.
    // OPTIONAL MATCH on EntityDef: instances are written even if EntityDef
    // hasn't been synced to Neo4j yet (the INSTANCE_OF edge is just skipped).
    // NOTE: Do NOT add entity-type labels (e.g. :Department) — Neo4j has
    // uniqueness constraints on those labels that would block cross-twin imports
    // of the same CSV data.
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
    `, { twinId, entityDefId, propsList })

    res.status(201).json({ created: records.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/**
 * DELETE /api/instances/dataset?twinId=xxx&entityDefId=yyy
 * Bulk-delete all instances of one entity within a twin (replaces the dataset).
 */
instancesRouter.delete('/dataset', async (req, res) => {
  const { twinId, entityDefId } = req.query as Record<string, string>
  if (!twinId || !entityDefId) return res.status(400).json({ error: 'twinId and entityDefId are required' })
  try {
    await runWrite(
      `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
       WHERE n._entityDefId = $entityDefId
       DETACH DELETE n`,
      { twinId, entityDefId },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/**
 * POST /api/instances/dedup
 * Remove duplicate instances (identical non-internal field values) within a twin.
 * Returns { removed, kept }.
 */
instancesRouter.post('/dedup', async (req, res) => {
  const { twinId } = req.body as { twinId?: string }
  if (!twinId) return res.status(400).json({ error: 'twinId is required' })

  try {
    const rows = await runQuery(
      `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId })
       RETURN n { .* } AS inst`,
      { twinId },
    )

    const fingerprint = (inst: Record<string, unknown>) =>
      JSON.stringify(
        Object.entries(inst)
          .filter(([k]) => !k.startsWith('_'))
          .sort(([a], [b]) => a.localeCompare(b)),
      )

    /* Group by entityDefId + business-field fingerprint; keep first, delete rest */
    const seen = new Map<string, string>()
    const toDelete: string[] = []

    for (const row of rows as any[]) {
      const inst = row.inst as Record<string, unknown>
      const key  = `${inst._entityDefId}::${fingerprint(inst)}`
      const id   = inst._id as string
      if (seen.has(key)) {
        toDelete.push(id)
      } else {
        seen.set(key, id)
      }
    }

    if (toDelete.length > 0) {
      await runWrite(
        `MATCH (n:EntityInstance) WHERE n._id IN $ids DETACH DELETE n`,
        { ids: toDelete },
      )
    }

    res.json({ removed: toDelete.length, kept: rows.length - toDelete.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/**
 * DELETE /api/instances/twin?twinId=xxx
 * Delete all instances belonging to a twin (used when deleting the twin itself).
 */
instancesRouter.delete('/twin', async (req, res) => {
  const { twinId } = req.query as Record<string, string>
  if (!twinId) return res.status(400).json({ error: 'twinId is required' })
  try {
    await runWrite(
      `MATCH (n:EntityInstance)-[:IN_TWIN]->(:BizTwin { id: $twinId }) DETACH DELETE n`,
      { twinId },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** DELETE /api/instances/batch — delete multiple instance records in one round-trip */
instancesRouter.delete('/batch', async (req, res) => {
  const { ids } = req.body as { ids?: string[] }
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' })
  try {
    await runWrite(
      `MATCH (n:EntityInstance) WHERE n._id IN $ids DETACH DELETE n`,
      { ids },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** DELETE /api/instances/:id — delete a single instance record */
instancesRouter.delete('/:id', async (req, res) => {
  try {
    await runWrite(
      `MATCH (n:EntityInstance { _id: $id }) DETACH DELETE n`,
      { id: req.params.id },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
