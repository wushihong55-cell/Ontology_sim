import { Router } from 'express'
import { runQuery, runWrite } from '../neo4j/driver'

export const ontologyRouter = Router()

/* ── Models ────────────────────────────────────────────────────────────────── */

ontologyRouter.get('/models', async (_req, res) => {
  try {
    const rows = await runQuery(`
      MATCH (m:OntologyModel)
      RETURN m { .* } AS model
      ORDER BY m.createdAt
    `)
    res.json(rows.map((r: any) => r.model))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.post('/models', async (req, res) => {
  const { id, name, description } = req.body
  try {
    const rows = await runWrite(`
      CREATE (m:OntologyModel { id: $id, name: $name, description: $description, createdAt: $createdAt })
      RETURN m { .* } AS model
    `, { id, name, description, createdAt: new Date().toISOString() })
    res.status(201).json((rows[0] as any).model)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.put('/models/:id', async (req, res) => {
  const { name, description } = req.body
  try {
    const rows = await runWrite(`
      MATCH (m:OntologyModel { id: $id })
      SET m.name = $name, m.description = $description
      RETURN m { .* } AS model
    `, { id: req.params.id, name, description })
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json((rows[0] as any).model)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.delete('/models/:id', async (req, res) => {
  try {
    await runWrite(`
      MATCH (m:OntologyModel { id: $id })
      OPTIONAL MATCH (n)-[:BELONGS_TO]->(m)
      DETACH DELETE n, m
    `, { id: req.params.id })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/* ── EntityDef (nodes) ─────────────────────────────────────────────────────── */

ontologyRouter.get('/models/:modelId/entities', async (req, res) => {
  try {
    const rows = await runQuery(`
      MATCH (e:EntityDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      RETURN e { .* } AS entity
    `, { modelId: req.params.modelId })
    res.json(rows.map((r: any) => ({
      ...r.entity,
      properties: JSON.parse(r.entity.properties ?? '[]'),
    })))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.post('/models/:modelId/entities', async (req, res) => {
  const { id, name, label, description, color, entityType, properties, posX, posY } = req.body
  try {
    const rows = await runWrite(`
      MATCH (m:OntologyModel { id: $modelId })
      CREATE (e:EntityDef {
        id: $id, name: $name, label: $label, description: $description,
        color: $color, entityType: $entityType,
        properties: $properties, posX: $posX, posY: $posY
      })-[:BELONGS_TO]->(m)
      RETURN e { .* } AS entity
    `, {
      modelId: req.params.modelId,
      id, name, label: label ?? name,
      description: description ?? '',
      color: color ?? '#4f7bbd',
      entityType: entityType ?? 'abstract',
      properties: JSON.stringify(properties ?? []),
      posX: posX ?? 0, posY: posY ?? 0,
    })
    const e = (rows[0] as any).entity
    res.status(201).json({ ...e, properties: JSON.parse(e.properties ?? '[]') })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.put('/entities/:id', async (req, res) => {
  const { name, label, description, color, entityType, properties, posX, posY } = req.body
  try {
    const patch: Record<string, unknown> = { id: req.params.id }
    const sets: string[] = []
    if (name        !== undefined) { sets.push('e.name = $name');               patch.name = name }
    if (label       !== undefined) { sets.push('e.label = $label');             patch.label = label }
    if (description !== undefined) { sets.push('e.description = $description'); patch.description = description }
    if (color       !== undefined) { sets.push('e.color = $color');             patch.color = color }
    if (entityType  !== undefined) { sets.push('e.entityType = $entityType');   patch.entityType = entityType }
    if (properties  !== undefined) { sets.push('e.properties = $properties');   patch.properties = JSON.stringify(properties) }
    if (posX        !== undefined) { sets.push('e.posX = $posX');               patch.posX = posX }
    if (posY        !== undefined) { sets.push('e.posY = $posY');               patch.posY = posY }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })

    const rows = await runWrite(
      `MATCH (e:EntityDef { id: $id }) SET ${sets.join(', ')} RETURN e { .* } AS entity`,
      patch,
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const ent = (rows[0] as any).entity
    res.json({ ...ent, properties: JSON.parse(ent.properties ?? '[]') })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.delete('/entities/:id', async (req, res) => {
  try {
    await runWrite(
      `MATCH (e:EntityDef { id: $id })
       OPTIONAL MATCH (r:RelDef)-[:FROM|TO]->(e)
       DETACH DELETE r, e`,
      { id: req.params.id },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/* ── RelDef (edges) ────────────────────────────────────────────────────────── */

ontologyRouter.get('/models/:modelId/relations', async (req, res) => {
  try {
    const rows = await runQuery(`
      MATCH (r:RelDef)-[:BELONGS_TO]->(:OntologyModel { id: $modelId })
      MATCH (r)-[:FROM]->(src:EntityDef)
      MATCH (r)-[:TO]->(tgt:EntityDef)
      RETURN r { .* } AS rel, src.id AS sourceId, tgt.id AS targetId
    `, { modelId: req.params.modelId })
    res.json(rows.map((r: any) => ({ ...r.rel, source: r.sourceId, target: r.targetId })))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.post('/models/:modelId/relations', async (req, res) => {
  const { id, name, label, cardinality, description, edgeStyle, relationCategory, relationType, sourceId, targetId } = req.body
  try {
    const rows = await runWrite(`
      MATCH (m:OntologyModel { id: $modelId })
      MATCH (src:EntityDef { id: $sourceId })
      MATCH (tgt:EntityDef { id: $targetId })
      CREATE (r:RelDef {
        id: $id, name: $name, label: $label,
        cardinality: $cardinality, description: $description,
        edgeStyle: $edgeStyle, relationCategory: $relationCategory,
        relationType: $relationType
      })
      CREATE (r)-[:BELONGS_TO]->(m)
      CREATE (r)-[:FROM]->(src)
      CREATE (r)-[:TO]->(tgt)
      RETURN r { .* } AS rel
    `, {
      modelId: req.params.modelId,
      id, name, label: label ?? name,
      cardinality: cardinality ?? '1:N',
      description: description ?? '',
      edgeStyle: edgeStyle ?? 'bezier',
      relationCategory: relationCategory ?? 'associative',
      relationType: relationType ?? null,
      sourceId, targetId,
    })
    res.status(201).json({ ...(rows[0] as any).rel, source: sourceId, target: targetId })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.put('/relations/:id', async (req, res) => {
  const { name, label, cardinality, description, edgeStyle, relationCategory, relationType, sourceKey, targetKey } = req.body
  try {
    const params: Record<string, unknown> = { id: req.params.id }
    const sets: string[] = []
    if (name             !== undefined) { sets.push('r.name = $name');                         params.name = name }
    if (label            !== undefined) { sets.push('r.label = $label');                       params.label = label }
    if (cardinality      !== undefined) { sets.push('r.cardinality = $cardinality');           params.cardinality = cardinality }
    if (description      !== undefined) { sets.push('r.description = $description');           params.description = description }
    if (edgeStyle        !== undefined) { sets.push('r.edgeStyle = $edgeStyle');               params.edgeStyle = edgeStyle }
    if (relationCategory !== undefined) { sets.push('r.relationCategory = $relationCategory'); params.relationCategory = relationCategory }
    if (relationType     !== undefined) { sets.push('r.relationType = $relationType');         params.relationType = relationType ?? null }
    if (sourceKey        !== undefined) { sets.push('r.sourceKey = $sourceKey');               params.sourceKey = sourceKey ?? null }
    if (targetKey        !== undefined) { sets.push('r.targetKey = $targetKey');               params.targetKey = targetKey ?? null }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' })

    const rows = await runWrite(
      `MATCH (r:RelDef { id: $id })
       SET ${sets.join(', ')}
       WITH r
       MATCH (r)-[:FROM]->(src:EntityDef)
       MATCH (r)-[:TO]->(tgt:EntityDef)
       RETURN r { .* } AS rel, src.id AS sourceId, tgt.id AS targetId`,
      params,
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const row = rows[0] as any
    res.json({ ...row.rel, source: row.sourceId, target: row.targetId })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.put('/relations/:id/reroute', async (req, res) => {
  const { sourceId, targetId } = req.body
  if (!sourceId || !targetId) return res.status(400).json({ error: 'sourceId and targetId required' })
  try {
    await runWrite(`
      MATCH (r:RelDef { id: $id })
      OPTIONAL MATCH (r)-[oldFrom:FROM]->()
      DELETE oldFrom
      WITH r
      OPTIONAL MATCH (r)-[oldTo:TO]->()
      DELETE oldTo
      WITH r
      MATCH (src:EntityDef { id: $sourceId })
      MATCH (tgt:EntityDef { id: $targetId })
      CREATE (r)-[:FROM]->(src)
      CREATE (r)-[:TO]->(tgt)
    `, { id: req.params.id, sourceId, targetId })
    res.json({ id: req.params.id, sourceId, targetId })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.delete('/relations/:id', async (req, res) => {
  try {
    await runWrite(`MATCH (r:RelDef { id: $id }) DETACH DELETE r`, { id: req.params.id })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/* ── ODL (Ontology Definition Layer) ──────────────────────────────────────── */

ontologyRouter.get('/models/:modelId/odl', async (req, res) => {
  try {
    const rows = await runQuery(
      `MATCH (m:OntologyModel { id: $modelId }) RETURN m.odl AS odl`,
      { modelId: req.params.modelId },
    )
    res.json({ odl: (rows[0] as any)?.odl ?? '' })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

ontologyRouter.put('/models/:modelId/odl', async (req, res) => {
  const { odl } = req.body
  try {
    await runWrite(
      `MATCH (m:OntologyModel { id: $modelId }) SET m.odl = $odl`,
      { modelId: req.params.modelId, odl: odl ?? '' },
    )
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
