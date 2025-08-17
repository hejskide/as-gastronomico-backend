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
const createCiudadesTableQuery = `
  CREATE TABLE IF NOT EXISTS ciudades (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// Crear tabla de patrocinadores si no existe
const createPatrocinadoresTableQuery = `
  CREATE TABLE IF NOT EXISTS patrocinadores (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    telefono VARCHAR(20),
    representante VARCHAR(200),
    logo_fondo_claro TEXT,
    logo_fondo_oscuro TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// Crear tabla de relación patrocinadores-ciudades
const createPatrocinadoresCiudadesTableQuery = `
  CREATE TABLE IF NOT EXISTS patrocinadores_ciudades (
    id SERIAL PRIMARY KEY,
    patrocinador_id INTEGER REFERENCES patrocinadores(id) ON DELETE CASCADE,
    ciudad_id INTEGER REFERENCES ciudades(id) ON DELETE CASCADE,
    UNIQUE(patrocinador_id, ciudad_id)
  );
`;

// Inicializar la base de datos
async function initializeDatabase() {
  try {
    await pool.query(createCiudadesTableQuery);
    console.log('✅ Tabla ciudades creada/verificada correctamente');
    
    await pool.query(createPatrocinadoresTableQuery);
    console.log('✅ Tabla patrocinadores creada/verificada correctamente');
    
    await pool.query(createPatrocinadoresCiudadesTableQuery);
    console.log('✅ Tabla patrocinadores_ciudades creada/verificada correctamente');
  } catch (error) {
    console.error('❌ Error creando tablas:', error);
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
    
    // Enviar actualización en tiempo real
    sendUpdateToAllClients('ciudad_agregada', result.rows[0]);
    
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
    
    // Enviar actualización en tiempo real
    sendUpdateToAllClients('ciudad_actualizada', result.rows[0]);
    
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
    
    // Enviar actualización en tiempo real
    sendUpdateToAllClients('ciudad_eliminada', { id: id, message: 'Ciudad eliminada' });
    
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

// Server-Sent Events para actualizaciones en tiempo real
let clients = [];

// Endpoint para SSE
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Enviar mensaje inicial
  res.write('data: {"type": "connected", "message": "Conectado al servidor"}\n\n');

  // Agregar cliente a la lista
  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };
  clients.push(newClient);

  // Remover cliente cuando se desconecte
  req.on('close', () => {
    clients = clients.filter(client => client.id !== clientId);
    console.log(`Cliente ${clientId} desconectado. Clientes activos: ${clients.length}`);
  });

  console.log(`Cliente ${clientId} conectado. Clientes activos: ${clients.length}`);
});

// Función para enviar actualizaciones a todos los clientes
function sendUpdateToAllClients(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  clients.forEach(client => {
    client.res.write(`data: ${message}\n\n`);
  });
  console.log(`Actualización enviada a ${clients.length} clientes: ${type}`);
}

// Endpoints para patrocinadores

// GET - Obtener todos los patrocinadores con sus ciudades
app.get('/api/patrocinadores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        ARRAY_AGG(c.nombre) as ciudades_nombres,
        ARRAY_AGG(c.id) as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      GROUP BY p.id
      ORDER BY p.fecha_creacion DESC
    `);
    
    // Procesar los resultados para manejar patrocinadores sin ciudades
    const patrocinadores = result.rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres[0] === null ? [] : row.ciudades_nombres,
      ciudades_ids: row.ciudades_ids[0] === null ? [] : row.ciudades_ids
    }));
    
    res.json(patrocinadores);
  } catch (error) {
    console.error('Error obteniendo patrocinadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST - Crear nuevo patrocinador
app.post('/api/patrocinadores', async (req, res) => {
  try {
    const { nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro, ciudades_ids } = req.body;
    
    if (!nombre || !email) {
      return res.status(400).json({ error: 'El nombre y email son requeridos' });
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'El formato del email no es válido' });
    }

    // Insertar patrocinador
    const patrocinadorResult = await pool.query(
      `INSERT INTO patrocinadores (nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null]
    );
    
    const patrocinador = patrocinadorResult.rows[0];
    
    // Asociar ciudades si se proporcionan
    if (ciudades_ids && ciudades_ids.length > 0) {
      for (const ciudad_id of ciudades_ids) {
        await pool.query(
          'INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES ($1, $2)',
          [patrocinador.id, ciudad_id]
        );
      }
    }
    
    // Obtener el patrocinador con sus ciudades
    const finalResult = await pool.query(`
      SELECT 
        p.*,
        ARRAY_AGG(c.nombre) as ciudades_nombres,
        ARRAY_AGG(c.id) as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [patrocinador.id]);
    
    const patrocinadorFinal = {
      ...finalResult.rows[0],
      ciudades_nombres: finalResult.rows[0].ciudades_nombres[0] === null ? [] : finalResult.rows[0].ciudades_nombres,
      ciudades_ids: finalResult.rows[0].ciudades_ids[0] === null ? [] : finalResult.rows[0].ciudades_ids
    };
    
    res.status(201).json(patrocinadorFinal);
  } catch (error) {
    if (error.code === '23505') { // Error de duplicado
      res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
    } else {
      console.error('Error creando patrocinador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// PUT - Actualizar patrocinador
app.put('/api/patrocinadores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro, ciudades_ids } = req.body;
    
    if (!nombre || !email) {
      return res.status(400).json({ error: 'El nombre y email son requeridos' });
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'El formato del email no es válido' });
    }

    // Actualizar patrocinador
    const result = await pool.query(
      `UPDATE patrocinadores 
       SET nombre = $1, email = $2, telefono = $3, representante = $4, logo_fondo_claro = $5, logo_fondo_oscuro = $6 
       WHERE id = $7 RETURNING *`,
      [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patrocinador no encontrado' });
    }
    
    // Actualizar ciudades asociadas
    await pool.query('DELETE FROM patrocinadores_ciudades WHERE patrocinador_id = $1', [id]);
    
    if (ciudades_ids && ciudades_ids.length > 0) {
      for (const ciudad_id of ciudades_ids) {
        await pool.query(
          'INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES ($1, $2)',
          [id, ciudad_id]
        );
      }
    }
    
    // Obtener el patrocinador actualizado con sus ciudades
    const finalResult = await pool.query(`
      SELECT 
        p.*,
        ARRAY_AGG(c.nombre) as ciudades_nombres,
        ARRAY_AGG(c.id) as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);
    
    const patrocinadorFinal = {
      ...finalResult.rows[0],
      ciudades_nombres: finalResult.rows[0].ciudades_nombres[0] === null ? [] : finalResult.rows[0].ciudades_nombres,
      ciudades_ids: finalResult.rows[0].ciudades_ids[0] === null ? [] : finalResult.rows[0].ciudades_ids
    };
    
    res.json(patrocinadorFinal);
  } catch (error) {
    if (error.code === '23505') { // Error de duplicado
      res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
    } else {
      console.error('Error actualizando patrocinador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// DELETE - Eliminar patrocinador
app.delete('/api/patrocinadores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'DELETE FROM patrocinadores WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patrocinador no encontrado' });
    }
    
    res.json({ message: 'Patrocinador eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando patrocinador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Buscar patrocinadores
app.get('/api/patrocinadores/buscar', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.json([]);
    }

    const result = await pool.query(`
      SELECT 
        p.*,
        ARRAY_AGG(c.nombre) as ciudades_nombres,
        ARRAY_AGG(c.id) as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.nombre ILIKE $1 OR p.email ILIKE $1 OR p.representante ILIKE $1
      GROUP BY p.id
      ORDER BY p.nombre
    `, [`%${q}%`]);
    
    const patrocinadores = result.rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres[0] === null ? [] : row.ciudades_nombres,
      ciudades_ids: row.ciudades_ids[0] === null ? [] : row.ciudades_ids
    }));
    
    res.json(patrocinadores);
  } catch (error) {
    console.error('Error buscando patrocinadores:', error);
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
    console.log(`📡 SSE disponible en: http://localhost:${PORT}/api/events`);
  });
});
