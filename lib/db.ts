import mysql from 'mysql2/promise';

// Use a global singleton to survive Next.js HMR module reloads
const globalWithPool = globalThis as typeof globalThis & { _mysqlPool?: mysql.Pool };

export function getPool(): mysql.Pool {
  if (!globalWithPool._mysqlPool) {
    globalWithPool._mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 3,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return globalWithPool._mysqlPool;
}

export async function query<T = unknown>(
  sql: string,
  params?: (string | number | boolean | null | object)[]
): Promise<T[]> {
  const pool = getPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await pool.execute(sql, params as any);
  return rows as T[];
}

export async function queryOne<T = unknown>(
  sql: string,
  params?: (string | number | boolean | null | object)[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return (rows as T[])[0] ?? null;
}
