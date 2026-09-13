import { AppwriteException } from "node-appwrite"

// Optimistic staged-write fixture: revisions captured on FIRST WRITE, not read.
// Commit checks all touched rows before publishing any of them.
export function admissionStore() {
  const rows = new Map(), versions = new Map(), transactions = new Map()
  let sequence = 0
  const key = (p) => `${p.tableId}/${p.rowId}`
  const missing = () => { throw new AppwriteException("Missing", 404, "row_not_found") }
  const conflict = () => { throw new AppwriteException("Conflict", 409, "transaction_conflict") }
  const read = (p) => structuredClone((p.transactionId && transactions.get(p.transactionId).writes.get(key(p))) || rows.get(key(p)) || missing())
  const write = (p, data) => {
    const id = key(p)
    const row = { $id: p.rowId, $updatedAt: new Date().toISOString(), ...structuredClone(data) }
    if (p.transactionId) {
      const tx = transactions.get(p.transactionId)
      if (!tx.versions.has(id)) tx.versions.set(id, versions.get(id) || 0)
      tx.writes.set(id, row)
    } else {
      rows.set(id, row)
      versions.set(id, (versions.get(id) || 0) + 1)
    }
    return structuredClone(row)
  }
  const tablesDB = {
    createTransaction: async () => {
      const $id = String(++sequence)
      transactions.set($id, { status: "pending", writes: new Map(), versions: new Map() })
      return { $id }
    },
    getTransaction: async ({ transactionId }) => ({ status: transactions.get(transactionId).status }),
    updateTransaction: async ({ transactionId, commit }) => {
      const tx = transactions.get(transactionId)
      if (commit) {
        for (const [id, version] of tx.versions) if ((versions.get(id) || 0) !== version) {
          tx.status = "failed"
          conflict()
        }
        for (const [id, row] of tx.writes) {
          rows.set(id, row)
          versions.set(id, (versions.get(id) || 0) + 1)
        }
        tx.status = "committed"
      } else tx.status = "rolled_back"
    },
    getRow: async (p) => read(p),
    createRow: async (p) => {
      if (rows.has(key(p))) conflict()
      return write(p, { ...p.data, $permissions: p.permissions })
    },
    updateRow: async (p) => write(p, { ...read(p), ...p.data }),
    incrementRowColumn: async (p) => {
      const row = read(p)
      return write(p, { ...row, [p.column]: row[p.column] + p.value })
    },
    decrementRowColumn: async (p) => {
      const row = read(p)
      if (row[p.column] - p.value < p.min) throw new Error("underflow")
      return write(p, { ...row, [p.column]: row[p.column] - p.value })
    },
    listRows: async (p) => {
      const source = new Map(rows)
      if (p.transactionId) {
        for (const [id, row] of transactions.get(p.transactionId).writes)
          source.set(id, row)
      }
      let result = [...source.entries()]
        .filter(([id]) => id.startsWith(`${p.tableId}/`))
        .map(([, row]) => structuredClone(row))
      for (const encoded of p.queries || []) {
        const query = JSON.parse(encoded)
        if (query.method === "equal")
          result = result.filter((row) => query.values.includes(row[query.attribute]))
        if (query.method === "lessThanEqual")
          result = result.filter((row) => row[query.attribute] <= query.values[0])
        if (query.method === "limit") result = result.slice(0, query.values[0])
      }
      return { rows: result, total: result.length }
    },
  }
  return { tablesDB, rows, counters: () => [...rows.values()].filter((row) => row.window && row.window !== "lease"), leases: () => [...rows.values()].filter((row) => row.window === "lease") }
}
