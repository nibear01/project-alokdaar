import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { pool } from './config/db.js';
import { errorHandler, notFound } from './middleware/error.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', service: process.env.APP_NAME || 'Alokdaar' });
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: err.message });
  }
});

app.get('/api', (_req, res) => {
  res.json({
    name: process.env.APP_NAME || 'Alokdaar',
    docs: 'See docs/ARCHITECTURE.md',
    endpoints: ['/api/health'],
  });
});

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
});
