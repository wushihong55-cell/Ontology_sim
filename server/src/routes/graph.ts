import { Router } from 'express'
import { runQuery, runWrite, getSession } from '../neo4j/driver'

export const graphRouter = Router()

/** POST /api/graph/query — execute a read-only Cypher query */
graphRouter.post('/query', async (req, res) => {
  const { cypher, params } = req.body
  if (!cypher) return res.status(400).json({ error: 'cypher is required' })
  try {
    const rows = await runQuery(cypher, params ?? {})
    res.json({ rows })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** POST /api/graph/write — execute a write Cypher query */
graphRouter.post('/write', async (req, res) => {
  const { cypher, params } = req.body
  if (!cypher) return res.status(400).json({ error: 'cypher is required' })
  try {
    const rows = await runWrite(cypher, params ?? {})
    res.json({ rows })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** POST /api/graph/browse — query graph for visual display (nodes + relationships) */
graphRouter.post('/browse', async (req, res) => {
  const { cypher, params } = req.body
  const q = cypher ?? 'MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 200'
  try {
    const session = getSession()
    try {
      const result = await session.run(q, params ?? {})
      const nodesMap = new Map<string, unknown>()
      const relsMap  = new Map<string, unknown>()
      for (const record of result.records) {
        for (const key of record.keys as string[]) {
          const val = record.get(key) as any
          if (!val || typeof val !== 'object') continue
          if (Array.isArray(val.labels)) {
            nodesMap.set(val.elementId, {
              elementId:  val.elementId,
              labels:     val.labels,
              properties: val.properties,
            })
          } else if (val.type && val.startNodeElementId) {
            relsMap.set(val.elementId, {
              elementId:           val.elementId,
              type:                val.type,
              startNodeElementId:  val.startNodeElementId,
              endNodeElementId:    val.endNodeElementId,
              properties:          val.properties,
            })
          }
        }
      }
      res.json({ nodes: [...nodesMap.values()], relationships: [...relsMap.values()] })
    } finally {
      await session.close()
    }
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/**
 * GET /api/graph/schema-overview?twinId=xxx
 * Returns EntityDef nodes (with instance counts) + RelDef edges as a graph.
 * Used for the "本体结构" view in SmartAppGraph.
 */
graphRouter.get('/schema-overview', async (req, res) => {
  const { twinId } = req.query as { twinId?: string }
  if (!twinId) return res.status(400).json({ error: 'twinId is required' })
  try {
    // Fetch EntityDef nodes with their instance counts
    const entityRows = await runQuery(`
      MATCH (e:EntityDef)-[:BELONGS_TO]->(m:OntologyModel)<-[:USES_MODEL]-(t:BizTwin { id: $twinId })
      OPTIONAL MATCH (n:EntityInstance { _entityDefId: e.id })-[:IN_TWIN]->(t)
      WITH e, count(n) AS instanceCount
      RETURN e { .* } AS props, instanceCount, elementId(e) AS eid
    `, { twinId })

    // Fetch RelDef edges between EntityDef nodes
    const relRows = await runQuery(`
      MATCH (rd:RelDef)-[:BELONGS_TO]->(m:OntologyModel)<-[:USES_MODEL]-(t:BizTwin { id: $twinId })
      MATCH (rd)-[:FROM]->(src:EntityDef)
      MATCH (rd)-[:TO]->(tgt:EntityDef)
      RETURN elementId(rd) AS eid, rd.name AS relName,
             rd.cardinality AS cardinality, rd.relationCategory AS relationCategory,
             elementId(src) AS srcId, elementId(tgt) AS tgtId
    `, { twinId })

    const nodes = entityRows.map((r: any) => ({
      elementId:  r.eid,
      labels:     ['EntityDef'],
      properties: {
        ...r.props,
        instanceCount: typeof r.instanceCount === 'object'
          ? (r.instanceCount.low ?? 0)
          : (r.instanceCount ?? 0),
      },
    }))

    const relationships = relRows.map((r: any) => ({
      elementId:          r.eid,
      type:               r.relName,
      startNodeElementId: r.srcId,
      endNodeElementId:   r.tgtId,
      properties: {
        cardinality:      r.cardinality      ?? null,
        relationCategory: r.relationCategory ?? null,
      },
    }))

    res.json({ nodes, relationships })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/**
 * POST /api/instances/relink
 * Creates Neo4j relationships between EntityInstance nodes based on
 * RelDef sourceKey / targetKey foreign-key configuration.
 * Existing edges of matching types are deleted first (idempotent).
 */
graphRouter.post('/relink', async (req, res) => {
  const { twinId } = req.body as { twinId: string }
  if (!twinId) return res.status(400).json({ error: 'twinId is required' })

  try {
    // Load RelDefs that have sourceKey + targetKey configured
    const relDefs = await runQuery(`
      MATCH (rd:RelDef)-[:BELONGS_TO]->(m:OntologyModel)<-[:USES_MODEL]-(t:BizTwin { id: $twinId })
      WHERE rd.sourceKey IS NOT NULL AND rd.targetKey IS NOT NULL
        AND rd.sourceKey <> '' AND rd.targetKey <> ''
      MATCH (rd)-[:FROM]->(src:EntityDef)
      MATCH (rd)-[:TO]->(tgt:EntityDef)
      RETURN rd.name AS relName, rd.sourceKey AS sourceKey, rd.targetKey AS targetKey,
             src.id AS srcDefId, tgt.id AS tgtDefId
    `, { twinId })

    let created = 0

    for (const rd of relDefs as any[]) {
      const relType = (rd.relName as string).replace(/\s+/g, '_').toUpperCase()

      // Delete old edges of this type between instances in this twin
      await runWrite(`
        MATCH (a:EntityInstance { _entityDefId: $srcDefId })-[:IN_TWIN]->(:BizTwin { id: $twinId })
        MATCH (a)-[r:\`${relType}\`]->()
        DELETE r
      `, { twinId, srcDefId: rd.srcDefId })

      // Create new edges where sourceKey value matches targetKey value
      const result = await runWrite(`
        MATCH (a:EntityInstance { _entityDefId: $srcDefId })-[:IN_TWIN]->(t:BizTwin { id: $twinId })
        MATCH (b:EntityInstance { _entityDefId: $tgtDefId })-[:IN_TWIN]->(t)
        WHERE a[$sourceKey] IS NOT NULL AND a[$sourceKey] = b[$targetKey]
        CREATE (a)-[:\`${relType}\` { _relDefBased: true }]->(b)
        RETURN count(*) AS cnt
      `, { twinId, srcDefId: rd.srcDefId, tgtDefId: rd.tgtDefId, sourceKey: rd.sourceKey, targetKey: rd.targetKey })

      const cnt = (result[0] as any)?.cnt
      created += typeof cnt === 'object' ? (cnt.low ?? 0) : (cnt ?? 0)
    }

    res.json({ linked: relDefs.length, created })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
