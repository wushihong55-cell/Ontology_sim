import { Router } from 'express'
import { runQuery, runWrite } from '../neo4j/driver'

export const twinsRouter = Router()

twinsRouter.get('/', async (_req, res) => {
  try {
    const rows = await runQuery(`
      MATCH (t:BizTwin)
      OPTIONAL MATCH (t)-[:USES_MODEL]->(m:OntologyModel)
      WITH t, collect(m.id) AS modelIds
      RETURN t { .* } AS twin, modelIds
      ORDER BY t.createdAt
    `)
    res.json(rows.map((r: any) => ({ ...r.twin, modelIds: r.modelIds })))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

twinsRouter.post('/', async (req, res) => {
  const { id, name, description, color, modelIds } = req.body
  const mids: string[] = Array.isArray(modelIds) ? modelIds : []
  const createdAt = new Date().toISOString()
  try {
    await runWrite(
      `CREATE (t:BizTwin { id: $id, name: $name, description: $description,
                            color: $color, createdAt: $createdAt })`,
      { id, name, description: description ?? '', color: color ?? '#3b82f6', createdAt },
    )
    if (mids.length) {
      await runWrite(
        `MATCH (t:BizTwin { id: $id })
         UNWIND $mids AS mid
         MATCH (m:OntologyModel { id: mid })
         CREATE (t)-[:USES_MODEL]->(m)`,
        { id, mids },
      )
    }
    const rows = await runQuery(
      `MATCH (t:BizTwin { id: $id })
       OPTIONAL MATCH (t)-[:USES_MODEL]->(m:OntologyModel)
       WITH t, collect(m.id) AS modelIds
       RETURN t { .* } AS twin, modelIds`,
      { id },
    )
    const row = rows[0] as any
    res.status(201).json({ ...row.twin, modelIds: row.modelIds })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

twinsRouter.put('/:id', async (req, res) => {
  const { name, description, color, modelIds } = req.body
  try {
    // Update basic fields
    await runWrite(`
      MATCH (t:BizTwin { id: $id })
      SET t.name = coalesce($name, t.name),
          t.description = coalesce($description, t.description),
          t.color = coalesce($color, t.color)
    `, { id: req.params.id, name: name ?? null, description: description ?? null, color: color ?? null })

    // Re-link models if provided
    if (Array.isArray(modelIds)) {
      await runWrite(`
        MATCH (t:BizTwin { id: $id })-[r:USES_MODEL]->()
        DELETE r
      `, { id: req.params.id })
      if (modelIds.length) {
        await runWrite(`
          MATCH (t:BizTwin { id: $id })
          UNWIND $modelIds AS mid
          MATCH (m:OntologyModel { id: mid })
          CREATE (t)-[:USES_MODEL]->(m)
        `, { id: req.params.id, modelIds })
      }
    }

    const rows = await runQuery(`
      MATCH (t:BizTwin { id: $id })
      OPTIONAL MATCH (t)-[:USES_MODEL]->(m:OntologyModel)
      RETURN t { .* } AS twin, collect(m.id) AS modelIds
    `, { id: req.params.id })
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const row = rows[0] as any
    res.json({ ...row.twin, modelIds: row.modelIds })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

twinsRouter.delete('/:id', async (req, res) => {
  try {
    await runWrite(`
      MATCH (t:BizTwin { id: $id })
      OPTIONAL MATCH (n:EntityInstance)-[:IN_TWIN]->(t)
      DETACH DELETE n, t
    `, { id: req.params.id })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
