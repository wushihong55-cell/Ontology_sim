import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { verifyConnectivity, closeDriver, runQuery, runWrite } from './neo4j/driver'
import { ontologyRouter }  from './routes/ontology'
import { twinsRouter }     from './routes/twins'
import { instancesRouter } from './routes/instances'
import { skillsRouter }    from './routes/skills'
import { graphRouter }     from './routes/graph'
import { aiRouter }        from './routes/ai'
import { BUILT_IN_SKILLS } from './ai/builtInSkills'

const app  = express()
const PORT = Number(process.env.PORT ?? 4000)

app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '10mb' }))

/* ── Routes ─────────────────────────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

app.use('/api/ontology',  ontologyRouter)
app.use('/api/twins',     twinsRouter)
app.use('/api/instances', instancesRouter)
app.use('/api/skills',    skillsRouter)
app.use('/api/graph',     graphRouter)
app.use('/api/ai',        aiRouter)

/* ── Seed built-in skills ───────────────────────────────────────────────────── */
async function seedSkills(): Promise<void> {
  for (const skill of BUILT_IN_SKILLS) {
    const existing = await runQuery(
      `MATCH (s:Skill { id: $id }) RETURN s.id AS id`,
      { id: skill.id },
    )
    if (!existing.length) {
      await runWrite(`
        CREATE (:Skill {
          id: $id, name: $name, description: $description,
          category: $category, skillType: $skillType,
          systemPrompt: $systemPrompt,
          cypherRead: $cypherRead, cypherWrite: $cypherWrite,
          outputSchema: $outputSchema,
          toolName: $toolName, toolDescription: $toolDescription,
          toolInputSchema: $toolInputSchema,
          cypherExecution: $cypherExecution,
          enabled: $enabled, isBuiltIn: true,
          version: $version, createdAt: $createdAt, updatedAt: $updatedAt
        })
      `, {
        ...skill,
        toolInputSchema: JSON.stringify(skill.toolInputSchema ?? {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      console.log(`  ✓ Seeded skill: ${skill.name}`)
    }
  }
}

/* ── Bootstrap ──────────────────────────────────────────────────────────────── */
async function bootstrap(): Promise<void> {
  console.log('🔌 Connecting to Neo4j…')
  await verifyConnectivity()
  console.log('✅ Neo4j connected')

  console.log('🌱 Seeding built-in skills…')
  await seedSkills()

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  })
}

bootstrap().catch((err) => {
  console.error('❌ Bootstrap failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => { await closeDriver(); process.exit(0) })
process.on('SIGINT',  async () => { await closeDriver(); process.exit(0) })
