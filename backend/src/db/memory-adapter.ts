import { DatabaseAdapter, QueryResult } from './db.js';

export class MemoryAdapter implements DatabaseAdapter {
  private tables: Map<string, Map<string, any>> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    const tableNames = [
      'users',
      'db_engines',
      'edge_providers',
      'sites',
      'databases',
      'db_users',
      'proxy_hosts',
      'certificates',
      'cron_jobs',
      'cron_runs',
      'backup_destinations',
      'backups',
      'backup_runs',
      'import_jobs',
      'jobs',
      'audit_logs',
      'vhost_templates',
      'sessions',
      'login_attempts',
      'firewall_rules',
      'site_security_rules'
    ];
    this.tables.clear();
    for (const t of tableNames) {
      this.tables.set(t, new Map());
    }
  }

  public getTable<T = any>(name: string): Map<string, T> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    if (/^(INSERT|UPDATE|DELETE)/i.test(cleanSql)) {
      const rowCount = await this.execute(sql, params);
      return { rows: [], rowCount };
    }

    const selectMatch = cleanSql.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);

    if (selectMatch) {
      const [, fieldsStr, tableName, whereClause, orderClause, limitStr] = selectMatch;
      const table = this.getTable(tableName.toLowerCase());
      let rows = Array.from(table.values());

      if (whereClause) {
        rows = rows.filter((row) => this.evaluateWhere(row, whereClause, params));
      }

      if (fieldsStr.toLowerCase().includes('count(')) {
        return {
          rows: [{ count: rows.length }] as any,
          rowCount: 1
        };
      }

      if (orderClause) {
        rows = this.evaluateOrderBy(rows, orderClause);
      }

      if (limitStr) {
        rows = rows.slice(0, parseInt(limitStr, 10));
      }

      return {
        rows: rows as T[],
        rowCount: rows.length
      };
    }

    // Default mock response for unhandled complex SQL
    return { rows: [], rowCount: 0 };
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const cleanSql = sql.replace(/\s+/g, ' ').trim();

    // INSERT INTO <table> (...) VALUES (...)
    const insertMatch = cleanSql.match(/INSERT\s+INTO\s+(\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/i);
    if (insertMatch) {
      const [, tableName, colsStr, valsStr] = insertMatch;
      const table = this.getTable(tableName.toLowerCase());
      const cols = colsStr.split(',').map((c) => c.trim().toLowerCase());
      const vals = valsStr.split(',').map((v) => v.trim());
      const record: Record<string, any> = {};

      for (let i = 0; i < cols.length; i++) {
        const valToken = vals[i];
        if (!valToken) continue;

        const paramMatch = valToken.match(/^\$(\d+)$/);
        if (paramMatch) {
          record[cols[i]] = params[parseInt(paramMatch[1], 10) - 1];
        } else if (valToken.startsWith("'") && valToken.endsWith("'")) {
          record[cols[i]] = valToken.substring(1, valToken.length - 1);
        } else if (valToken.toLowerCase() === 'true') {
          record[cols[i]] = true;
        } else if (valToken.toLowerCase() === 'false') {
          record[cols[i]] = false;
        } else if (valToken.toLowerCase() === 'null') {
          record[cols[i]] = null;
        } else if (!isNaN(Number(valToken))) {
          record[cols[i]] = Number(valToken);
        } else {
          record[cols[i]] = valToken;
        }
      }

      const id = record.id || Math.random().toString(36).substring(2);
      table.set(id, record);
      return 1;
    }

    // UPDATE <table> SET ... WHERE ...
    const updateMatch = cleanSql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?$/i);
    if (updateMatch) {
      const [, tableName, setClause, whereClause] = updateMatch;
      const table = this.getTable(tableName.toLowerCase());
      let count = 0;

      for (const [id, row] of table.entries()) {
        if (!whereClause || this.evaluateWhere(row, whereClause, params)) {
          this.applySet(row, setClause, params);
          table.set(id, row);
          count++;
        }
      }
      return count;
    }

    // DELETE FROM <table> WHERE ...
    const deleteMatch = cleanSql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?$/i);
    if (deleteMatch) {
      const [, tableName, whereClause] = deleteMatch;
      const table = this.getTable(tableName.toLowerCase());
      let count = 0;

      for (const [id, row] of Array.from(table.entries())) {
        if (!whereClause || this.evaluateWhere(row, whereClause, params)) {
          table.delete(id);
          count++;
        }
      }
      return count;
    }

    return 0;
  }

  private evaluateWhere(row: Record<string, any>, whereClause: string, params: unknown[]): boolean {
    // Check if there are top-level AND groups
    // Regex matches conditions or parentheses
    const normalized = whereClause.trim();

    // Check for OR groups inside parentheses, e.g. (identifier = $1 OR ip_address = $2)
    const parenOrMatch = normalized.match(/\(([^)]+)\)/);
    if (parenOrMatch) {
      const innerOr = parenOrMatch[1];
      const orParts = innerOr.split(/\s+OR\s+/i);
      const orMatched = orParts.some((part) => this.evalSimpleCond(row, part, params));
      if (!orMatched) return false;

      // Evaluate rest after removing the paren group
      const rest = normalized.replace(parenOrMatch[0], '').replace(/^\s*AND\s+/i, '').replace(/\s+AND\s*$/i, '').trim();
      if (!rest) return true;
      return this.evaluateWhere(row, rest, params);
    }

    const conditions = normalized.split(/\s+AND\s+/i);
    for (const cond of conditions) {
      if (!this.evalSimpleCond(row, cond, params)) {
        return false;
      }
    }
    return true;
  }

  private evalSimpleCond(row: Record<string, any>, cond: string, params: unknown[]): boolean {
    const trimmed = cond.trim();

    const getRowVal = (colName: string) => {
      const lower = colName.toLowerCase();
      if (row[lower] !== undefined) return row[lower];
      const camel = lower.replace(/_([a-z0-9])/g, (_, g) => g.toUpperCase());
      return row[camel];
    };

    // col >= $param
    const gteMatch = trimmed.match(/(\w+)\s*>=\s*\$(\d+)/i);
    if (gteMatch) {
      const [, col, paramIdx] = gteMatch;
      const val = params[parseInt(paramIdx, 10) - 1];
      const rowVal = getRowVal(col);
      return rowVal >= (val as any);
    }

    // col = false / true
    const boolMatch = trimmed.match(/(\w+)\s*=\s*(false|true)/i);
    if (boolMatch) {
      const [, col, boolStr] = boolMatch;
      const expected = boolStr.toLowerCase() === 'true';
      return Boolean(getRowVal(col)) === expected;
    }

    // col = $param
    const eqMatch = trimmed.match(/(\w+)\s*=\s*\$(\d+)/i);
    if (eqMatch) {
      const [, col, paramIdx] = eqMatch;
      const val = params[parseInt(paramIdx, 10) - 1];
      return getRowVal(col) === val;
    }

    // col IS NULL
    const isNullMatch = trimmed.match(/(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) {
      const [, col] = isNullMatch;
      const rowVal = getRowVal(col);
      return rowVal === null || rowVal === undefined;
    }

    // col IS NOT NULL
    const isNotNullMatch = trimmed.match(/(\w+)\s+IS\s+NOT\s+NULL/i);
    if (isNotNullMatch) {
      const [, col] = isNotNullMatch;
      const rowVal = getRowVal(col);
      return rowVal !== null && rowVal !== undefined;
    }

    return true;
  }

  private applySet(row: Record<string, any>, setClause: string, params: unknown[]): void {
    const assignments = setClause.split(',');
    for (const assign of assignments) {
      const trimmed = assign.trim();
      // col = col + 1
      const incMatch = trimmed.match(/(\w+)\s*=\s*\w+\s*\+\s*(\d+)/i);
      if (incMatch) {
        const [, col, incVal] = incMatch;
        row[col.toLowerCase()] = (row[col.toLowerCase()] || 0) + parseInt(incVal, 10);
        continue;
      }

      // col = 'literal'
      const strLiteralMatch = trimmed.match(/(\w+)\s*=\s*'([^']*)'/);
      if (strLiteralMatch) {
        const [, col, val] = strLiteralMatch;
        row[col.toLowerCase()] = val;
        continue;
      }

      // col = true/false
      const boolLiteralMatch = trimmed.match(/(\w+)\s*=\s*(TRUE|FALSE)/i);
      if (boolLiteralMatch) {
        const [, col, val] = boolLiteralMatch;
        row[col.toLowerCase()] = val.toUpperCase() === 'TRUE';
        continue;
      }

      // col = NULL
      const nullLiteralMatch = trimmed.match(/(\w+)\s*=\s*NULL/i);
      if (nullLiteralMatch) {
        const [, col] = nullLiteralMatch;
        row[col.toLowerCase()] = null;
        continue;
      }

      // col = number
      const numLiteralMatch = trimmed.match(/(\w+)\s*=\s*(\d+)(?!\$)/);
      if (numLiteralMatch) {
        const [, col, val] = numLiteralMatch;
        row[col.toLowerCase()] = parseInt(val, 10);
        continue;
      }

      // col = $param
      const eqMatch = trimmed.match(/(\w+)\s*=\s*\$(\d+)/);
      if (eqMatch) {
        const [, col, paramIdx] = eqMatch;
        row[col.toLowerCase()] = params[parseInt(paramIdx, 10) - 1];
        continue;
      }
    }
  }

  private evaluateOrderBy(rows: any[], orderClause: string): any[] {
    const [col, dir] = orderClause.trim().split(/\s+/);
    const isDesc = dir && dir.toUpperCase() === 'DESC';
    return rows.sort((a, b) => {
      const valA = a[col.toLowerCase()];
      const valB = b[col.toLowerCase()];
      if (valA < valB) return isDesc ? 1 : -1;
      if (valA > valB) return isDesc ? -1 : 1;
      return 0;
    });
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async migrate(): Promise<void> {
    // Memory adapter is pre-initialized
  }

  async close(): Promise<void> {
    this.reset();
  }
}
