import { Router } from 'express'
import { runQuery, runWrite } from '../neo4j/driver'

export const skillsRouter = Router()

/** GET /bundle — export all non-builtin skills as a portable JSON bundle */
skillsRouter.get('/bundle', async (req, res) => {
  const { category } = req.query as { category?: string }
  const where = category
    ? 'WHERE s.category = $category AND NOT coalesce(s.isBuiltIn, false)'
    : 'WHERE NOT coalesce(s.isBuiltIn, false)'
  try {
    const rows = await runQuery(
      `MATCH (s:Skill) ${where} RETURN s { .* } AS skill ORDER BY s.category, s.name`,
      { category: category ?? null },
    )
    const skills = rows.map((r: any) => {
      const { isBuiltIn: _ib, createdAt: _ca, updatedAt: _ua, ...rest } = r.skill
      return { ...rest, toolInputSchema: rest.toolInputSchema ? JSON.parse(rest.toolInputSchema) : null }
    })
    const bundle = {
      version:     '1.0',
      exportedAt:  new Date().toISOString(),
      source:      'Ontology Studio',
      skillCount:  skills.length,
      skills,
    }
    res.setHeader('Content-Disposition', `attachment; filename="skills-bundle-${Date.now()}.json"`)
    res.json(bundle)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** POST /bundle — import (upsert) a bundle of skills */
skillsRouter.post('/bundle', async (req, res) => {
  const { skills } = req.body as { skills: any[] }
  if (!Array.isArray(skills) || skills.length === 0)
    return res.status(400).json({ error: 'skills array required' })

  const now = new Date().toISOString()
  let imported = 0, updated = 0, skipped = 0
  const errors: string[] = []

  for (const s of skills) {
    if (s.isBuiltIn) { skipped++; continue }
    const id = s.id ?? `skill-${Math.random().toString(36).slice(2)}`
    const schema = s.toolInputSchema ? JSON.stringify(s.toolInputSchema) : ''
    try {
      const existing = await runQuery(`MATCH (s:Skill { id: $id }) RETURN s.id AS id`, { id })
      if (existing.length > 0) {
        await runWrite(`
          MATCH (s:Skill { id: $id })
          SET s.name = $name, s.description = $description, s.category = $category,
              s.skillType = $skillType, s.systemPrompt = $systemPrompt,
              s.cypherRead = $cypherRead, s.cypherWrite = $cypherWrite,
              s.outputSchema = $outputSchema, s.toolName = $toolName,
              s.toolDescription = $toolDescription, s.toolInputSchema = $toolInputSchema,
              s.cypherExecution = $cypherExecution, s.enabled = $enabled,
              s.isBuiltIn = false, s.version = $version, s.updatedAt = $updatedAt
        `, {
          id,
          name: s.name ?? '', description: s.description ?? '',
          category: s.category ?? 'graph-query', skillType: s.skillType ?? 'tool',
          systemPrompt: s.systemPrompt ?? '', cypherRead: s.cypherRead ?? '',
          cypherWrite: s.cypherWrite ?? '', outputSchema: s.outputSchema ?? '',
          toolName: s.toolName ?? '', toolDescription: s.toolDescription ?? '',
          toolInputSchema: schema, cypherExecution: s.cypherExecution ?? '',
          enabled: s.enabled ?? true, version: s.version ?? '1.0.0', updatedAt: now,
        })
        updated++
      } else {
        await runWrite(`
          CREATE (s:Skill {
            id: $id, name: $name, description: $description, category: $category,
            skillType: $skillType, systemPrompt: $systemPrompt,
            cypherRead: $cypherRead, cypherWrite: $cypherWrite, outputSchema: $outputSchema,
            toolName: $toolName, toolDescription: $toolDescription,
            toolInputSchema: $toolInputSchema, cypherExecution: $cypherExecution,
            enabled: $enabled, isBuiltIn: false, version: $version,
            createdAt: $createdAt, updatedAt: $updatedAt
          })
        `, {
          id,
          name: s.name ?? '', description: s.description ?? '',
          category: s.category ?? 'graph-query', skillType: s.skillType ?? 'tool',
          systemPrompt: s.systemPrompt ?? '', cypherRead: s.cypherRead ?? '',
          cypherWrite: s.cypherWrite ?? '', outputSchema: s.outputSchema ?? '',
          toolName: s.toolName ?? '', toolDescription: s.toolDescription ?? '',
          toolInputSchema: schema, cypherExecution: s.cypherExecution ?? '',
          enabled: s.enabled ?? true, version: s.version ?? '1.0.0',
          createdAt: now, updatedAt: now,
        })
        imported++
      }
    } catch (e) {
      errors.push(`${s.name ?? id}: ${String(e)}`)
    }
  }
  res.json({ imported, updated, skipped, errors, total: skills.length })
})

skillsRouter.get('/', async (req, res) => {
  const { category, skillType, enabled } = req.query as Record<string, string>
  try {
    const filters: string[] = []
    if (category)  filters.push('s.category = $category')
    if (skillType) filters.push('s.skillType = $skillType')
    if (enabled !== undefined) filters.push(`s.enabled = ${enabled === 'true'}`)
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const rows = await runQuery(`
      MATCH (s:Skill) ${where}
      RETURN s { .* } AS skill
      ORDER BY s.category, s.name
    `, { category: category ?? null, skillType: skillType ?? null })
    res.json(rows.map((r: any) => ({
      ...r.skill,
      toolInputSchema: r.skill.toolInputSchema ? JSON.parse(r.skill.toolInputSchema) : null,
    })))
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

skillsRouter.get('/:id', async (req, res) => {
  try {
    const rows = await runQuery(
      `MATCH (s:Skill { id: $id }) RETURN s { .* } AS skill`,
      { id: req.params.id },
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = (rows[0] as any).skill
    res.json({ ...s, toolInputSchema: s.toolInputSchema ? JSON.parse(s.toolInputSchema) : null })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

skillsRouter.post('/', async (req, res) => {
  const body = req.body
  const id = body.id ?? `skill-${Math.random().toString(36).slice(2)}`
  const now = new Date().toISOString()
  try {
    const rows = await runWrite(`
      CREATE (s:Skill {
        id: $id, name: $name, description: $description,
        category: $category, skillType: $skillType,
        systemPrompt: $systemPrompt,
        cypherRead: $cypherRead, cypherWrite: $cypherWrite,
        outputSchema: $outputSchema,
        toolName: $toolName, toolDescription: $toolDescription,
        toolInputSchema: $toolInputSchema,
        cypherExecution: $cypherExecution,
        enabled: $enabled, isBuiltIn: $isBuiltIn,
        version: $version, createdAt: $createdAt, updatedAt: $updatedAt
      })
      RETURN s { .* } AS skill
    `, {
      id,
      name:             body.name ?? '',
      description:      body.description ?? '',
      category:         body.category ?? 'graph-query',
      skillType:        body.skillType ?? 'tool',
      systemPrompt:     body.systemPrompt ?? '',
      cypherRead:       body.cypherRead ?? '',
      cypherWrite:      body.cypherWrite ?? '',
      outputSchema:     body.outputSchema ?? '',
      toolName:         body.toolName ?? '',
      toolDescription:  body.toolDescription ?? '',
      toolInputSchema:  body.toolInputSchema ? JSON.stringify(body.toolInputSchema) : '',
      cypherExecution:  body.cypherExecution ?? '',
      enabled:          body.enabled ?? true,
      isBuiltIn:        body.isBuiltIn ?? false,
      version:          body.version ?? '1.0.0',
      createdAt:        now,
      updatedAt:        now,
    })
    const s = (rows[0] as any).skill
    res.status(201).json({ ...s, toolInputSchema: s.toolInputSchema ? JSON.parse(s.toolInputSchema) : null })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

skillsRouter.put('/:id', async (req, res) => {
  const body = req.body
  try {
    const rows = await runWrite(`
      MATCH (s:Skill { id: $id })
      SET s.name            = coalesce($name, s.name),
          s.description     = coalesce($description, s.description),
          s.category        = coalesce($category, s.category),
          s.skillType       = coalesce($skillType, s.skillType),
          s.systemPrompt    = coalesce($systemPrompt, s.systemPrompt),
          s.cypherRead      = coalesce($cypherRead, s.cypherRead),
          s.cypherWrite     = coalesce($cypherWrite, s.cypherWrite),
          s.outputSchema    = coalesce($outputSchema, s.outputSchema),
          s.toolName        = coalesce($toolName, s.toolName),
          s.toolDescription = coalesce($toolDescription, s.toolDescription),
          s.toolInputSchema = coalesce($toolInputSchema, s.toolInputSchema),
          s.cypherExecution = coalesce($cypherExecution, s.cypherExecution),
          s.enabled         = coalesce($enabled, s.enabled),
          s.updatedAt       = $updatedAt
      RETURN s { .* } AS skill
    `, {
      id: req.params.id,
      name:             body.name ?? null,
      description:      body.description ?? null,
      category:         body.category ?? null,
      skillType:        body.skillType ?? null,
      systemPrompt:     body.systemPrompt ?? null,
      cypherRead:       body.cypherRead ?? null,
      cypherWrite:      body.cypherWrite ?? null,
      outputSchema:     body.outputSchema ?? null,
      toolName:         body.toolName ?? null,
      toolDescription:  body.toolDescription ?? null,
      toolInputSchema:  body.toolInputSchema ? JSON.stringify(body.toolInputSchema) : null,
      cypherExecution:  body.cypherExecution ?? null,
      enabled:          body.enabled ?? null,
      updatedAt:        new Date().toISOString(),
    })
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = (rows[0] as any).skill
    res.json({ ...s, toolInputSchema: s.toolInputSchema ? JSON.parse(s.toolInputSchema) : null })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

skillsRouter.delete('/:id', async (req, res) => {
  try {
    // Block deletion of built-in skills
    const rows = await runQuery(`MATCH (s:Skill { id: $id }) RETURN s.isBuiltIn AS isBuiltIn`, { id: req.params.id })
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if ((rows[0] as any).isBuiltIn) return res.status(403).json({ error: '内置 Skill 不可删除，可禁用' })
    await runWrite(`MATCH (s:Skill { id: $id }) DELETE s`, { id: req.params.id })
    res.status(204).send()
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

/** Export a skill as JSON */
skillsRouter.get('/:id/export', async (req, res) => {
  try {
    const rows = await runQuery(`MATCH (s:Skill { id: $id }) RETURN s { .* } AS skill`, { id: req.params.id })
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const s = (rows[0] as any).skill
    const exported = { ...s, toolInputSchema: s.toolInputSchema ? JSON.parse(s.toolInputSchema) : null }
    res.setHeader('Content-Disposition', `attachment; filename="${s.name ?? s.id}.skill.json"`)
    res.json(exported)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})
