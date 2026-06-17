import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

const files = ['supabase/schema.sql', 'supabase/seed.sql']
const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  for (const file of files) {
    const sql = await readFile(file, 'utf8')
    console.log(`Applying ${file}`)
    await client.query(sql)
  }
  console.log('Supabase schema and seed applied.')
} finally {
  await client.end()
}
