const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de la base de datos PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://as_gastronomico_user:TGa2HrBfsiuU7VJBPPBpoUN9pagIR6pY@dpg-d2gmkh75r7bs73f7rrqg-a/as_gastronomico_db_62l0',
  ssl: {
    rejectUnauthorized: false
  }
});

// Crear tabla de ciudades si no existe
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS ciudades (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// Inicializar la base de datos
async function initializeDatabase() {
  try {
    await pool.query(createTableQuery);
    console.log('✅ Tabla ciudades creada/verificada correctamente');
  } catch (error) {
    console.error('❌ Error creando tabla:', error);
  }
}

// Endpoints para ciudades

// GET - Obtener todas las ciudades
app.get('/api/ciudades', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ciudades ORDER BY fecha_creacion DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo ciudades:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST - Crear nueva ciudad
app.post('/api/ciudades', async (req, res) => {
  try {
    const { nombre } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
    }

    const result = await pool.query(
      'INSERT INTO ciudades (nombre) VALUES ($1) RETURNING *',
      [nombre.trim()]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Error de duplicado
      res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
    } else {
      console.error('Error creando ciudad:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// PUT - Actualizar ciudad
app.put('/api/ciudades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
    }

    const result = await pool.query(
      'UPDATE ciudades SET nombre = $1 WHERE id = $2 RETURNING *',
      [nombre.trim(), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // Error de duplicado
      res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
    } else {
      console.error('Error actualizando ciudad:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// DELETE - Eliminar ciudad
app.delete('/api/ciudades/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM ciudades WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }
    
    res.json({ message: 'Ciudad eliminada correctamente' });
  } catch (error) {
    console.error('Error eliminando ciudad:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Buscar ciudades
app.get('/api/ciudades/buscar', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.json([]);
    }

    const result = await pool.query(
      'SELECT * FROM ciudades WHERE nombre ILIKE $1 ORDER BY nombre',
      [`%${q}%`]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error buscando ciudades:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'API funcionando correctamente' });
});

// Inicializar base de datos y arrancar servidor
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📊 API disponible en: http://localhost:${PORT}/api`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
  });
});
