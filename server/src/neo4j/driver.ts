import neo4j, { Driver, Session } from 'neo4j-driver'

let _driver: Driver | null = null

export function getDriver(): Driver {
  if (!_driver) {
    const url      = process.env.NEO4J_URL      ?? 'bolt://localhost:7687'
    const username = process.env.NEO4J_USERNAME  ?? 'neo4j'
    const password = process.env.NEO4J_PASSWORD  ?? 'neo4j'

    _driver = neo4j.driver(url, neo4j.auth.basic(username, password), {
      logging: neo4j.logging.console('warn'),
    })
  }
  return _driver
}

export function getSession(database?: string): Session {
  return getDriver().session({ database: database ?? process.env.NEO4J_DATABASE ?? 'neo4j' })
}

export async function verifyConnectivity(): Promise<void> {
  await getDriver().verifyConnectivity()
}

export async function closeDriver(): Promise<void> {
  if (_driver) {
    await _driver.close()
    _driver = null
  }
}

/** Run a Cypher query and return records as plain objects. */
export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const session = getSession()
  try {
    const result = await session.run(cypher, params)
    return result.records.map((r) => r.toObject() as T)
  } finally {
    await session.close()
  }
}

/** Run a write transaction — same helper, explicit label for clarity. */
export const runWrite = runQuery
