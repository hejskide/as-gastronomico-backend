const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://as-gastronomico-app.onrender.com',
    'http://localhost:19006',
    'http://localhost:3000',
    'http://localhost:8081'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());

// Configuración de PostgreSQL para Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Verificar conexión a la base de datos
pool.on('connect', () => {
  console.log('✅ Conectado a PostgreSQL');
});

pool.on('error', (err) => {
  console.error('❌ Error de conexión a PostgreSQL:', err);
});

// Crear tablas si no existen
const createTables = async () => {
  const client = await pool.connect();
  try {
    // Tabla de ciudades
    await client.query(`
      CREATE TABLE IF NOT EXISTS ciudades (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL UNIQUE,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla ciudades creada/verificada correctamente');

    // Tabla de patrocinadores
    await client.query(`
      CREATE TABLE IF NOT EXISTS patrocinadores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        telefono VARCHAR(50),
        representante VARCHAR(255),
        logo_fondo_claro TEXT,
        logo_fondo_oscuro TEXT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla patrocinadores creada/verificada correctamente');

    // Tabla de relación patrocinadores-ciudades
    await client.query(`
      CREATE TABLE IF NOT EXISTS patrocinadores_ciudades (
        id SERIAL PRIMARY KEY,
        patrocinador_id INTEGER REFERENCES patrocinadores(id) ON DELETE CASCADE,
        ciudad_id INTEGER REFERENCES ciudades(id) ON DELETE CASCADE,
        UNIQUE(patrocinador_id, ciudad_id)
      )
    `);
    console.log('✅ Tabla patrocinadores_ciudades creada/verificada correctamente');

    // Tabla de restaurantes
    await client.query(`
      CREATE TABLE IF NOT EXISTS restaurantes (
        id SERIAL PRIMARY KEY,
        nombre_oficial VARCHAR(255) NOT NULL,
        nombre_mostrar VARCHAR(255) NOT NULL,
        breve_resena TEXT,
        representante VARCHAR(255),
        numero_mesas INTEGER,
        ciudad_id INTEGER REFERENCES ciudades(id) ON DELETE SET NULL,
        email VARCHAR(255),
        telefono VARCHAR(50),
        instagram VARCHAR(255),
        logo TEXT,
        sede_ubicacion_corta TEXT,
        sede_horario TEXT,
        sedes TEXT,
        propuestas TEXT,
        ediciones TEXT,
        premios_obtenidos TEXT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla restaurantes creada/verificada correctamente');

  } catch (error) {
    console.error('❌ Error creando tablas:', error);
    throw error;
  } finally {
    client.release();
  }
};

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
  const { nombre } = req.body;

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO ciudades (nombre) VALUES ($1) RETURNING *',
      [nombre.trim()]
    );

    const nuevaCiudad = result.rows[0];
    sendUpdateToAllClients('ciudad_agregada', nuevaCiudad);
    res.status(201).json(nuevaCiudad);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
    } else {
      console.error('Error creando ciudad:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// PUT - Actualizar ciudad
app.put('/api/ciudades/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
  }

  try {
    const result = await pool.query(
      'UPDATE ciudades SET nombre = $1 WHERE id = $2 RETURNING *',
      [nombre.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }

    const ciudadActualizada = result.rows[0];
    sendUpdateToAllClients('ciudad_actualizada', ciudadActualizada);
    res.json(ciudadActualizada);
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
    } else {
      console.error('Error actualizando ciudad:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
});

// DELETE - Eliminar ciudad
app.delete('/api/ciudades/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM ciudades WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }

    sendUpdateToAllClients('ciudad_eliminada', { id: id, message: 'Ciudad eliminada' });
    res.json({ message: 'Ciudad eliminada correctamente' });
  } catch (error) {
    console.error('Error eliminando ciudad:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Buscar ciudades
app.get('/api/ciudades/buscar', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  try {
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

// Endpoints para patrocinadores

// GET - Obtener todos los patrocinadores con sus ciudades
app.get('/api/patrocinadores', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        STRING_AGG(c.nombre, ',') as ciudades_nombres,
        STRING_AGG(c.id::text, ',') as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      GROUP BY p.id
      ORDER BY p.fecha_creacion DESC
    `);

    const patrocinadores = result.rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
      ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',') : []
    }));

    res.json(patrocinadores);
  } catch (error) {
    console.error('Error obteniendo patrocinadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST - Crear nuevo patrocinador
app.post('/api/patrocinadores', async (req, res) => {
  const { nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro, ciudades_ids } = req.body;

  if (!nombre || !email) {
    return res.status(400).json({ error: 'El nombre y email son requeridos' });
  }

  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'El formato del email no es válido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear patrocinador
    const patrocinadorResult = await client.query(
      'INSERT INTO patrocinadores (nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null]
    );

    const patrocinadorId = patrocinadorResult.rows[0].id;

    // Asociar ciudades si se proporcionan
    if (ciudades_ids && ciudades_ids.length > 0) {
      for (const ciudadId of ciudades_ids) {
        await client.query(
          'INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES ($1, $2)',
          [patrocinadorId, ciudadId]
        );
      }
    }

    await client.query('COMMIT');

    // Obtener el patrocinador con sus ciudades
    const finalResult = await client.query(`
      SELECT 
        p.*,
        STRING_AGG(c.nombre, ',') as ciudades_nombres,
        STRING_AGG(c.id::text, ',') as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [patrocinadorId]);

    const patrocinadorFinal = {
      ...finalResult.rows[0],
      ciudades_nombres: finalResult.rows[0].ciudades_nombres ? finalResult.rows[0].ciudades_nombres.split(',') : [],
      ciudades_ids: finalResult.rows[0].ciudades_ids ? finalResult.rows[0].ciudades_ids.split(',') : []
    };

    res.status(201).json(patrocinadorFinal);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
    } else {
      console.error('Error creando patrocinador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  } finally {
    client.release();
  }
});

// PUT - Actualizar patrocinador
app.put('/api/patrocinadores/:id', async (req, res) => {
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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Actualizar patrocinador
    const updateResult = await client.query(
      'UPDATE patrocinadores SET nombre = $1, email = $2, telefono = $3, representante = $4, logo_fondo_claro = $5, logo_fondo_oscuro = $6 WHERE id = $7 RETURNING *',
      [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null, id]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Patrocinador no encontrado' });
    }

    // Actualizar ciudades asociadas
    await client.query('DELETE FROM patrocinadores_ciudades WHERE patrocinador_id = $1', [id]);

    if (ciudades_ids && ciudades_ids.length > 0) {
      for (const ciudadId of ciudades_ids) {
        await client.query(
          'INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES ($1, $2)',
          [id, ciudadId]
        );
      }
    }

    await client.query('COMMIT');

    // Obtener el patrocinador actualizado con sus ciudades
    const finalResult = await client.query(`
      SELECT 
        p.*,
        STRING_AGG(c.nombre, ',') as ciudades_nombres,
        STRING_AGG(c.id::text, ',') as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);

    const patrocinadorFinal = {
      ...finalResult.rows[0],
      ciudades_nombres: finalResult.rows[0].ciudades_nombres ? finalResult.rows[0].ciudades_nombres.split(',') : [],
      ciudades_ids: finalResult.rows[0].ciudades_ids ? finalResult.rows[0].ciudades_ids.split(',') : []
    };

    res.json(patrocinadorFinal);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
    } else {
      console.error('Error actualizando patrocinador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  } finally {
    client.release();
  }
});

// DELETE - Eliminar patrocinador
app.delete('/api/patrocinadores/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM patrocinadores WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Patrocinador no encontrado' });
    }

    sendUpdateToAllClients('patrocinador_eliminado', { id: id, message: 'Patrocinador eliminado' });
    res.json({ message: 'Patrocinador eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando patrocinador:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Buscar patrocinadores
app.get('/api/patrocinadores/buscar', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  try {
    const result = await pool.query(`
      SELECT 
        p.*,
        STRING_AGG(c.nombre, ',') as ciudades_nombres,
        STRING_AGG(c.id::text, ',') as ciudades_ids
      FROM patrocinadores p
      LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
      LEFT JOIN ciudades c ON pc.ciudad_id = c.id
      WHERE p.nombre ILIKE $1 OR p.email ILIKE $1 OR p.representante ILIKE $1
      GROUP BY p.id
      ORDER BY p.nombre
    `, [`%${q}%`]);

    const patrocinadores = result.rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
      ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',') : []
    }));

    res.json(patrocinadores);
  } catch (error) {
    console.error('Error buscando patrocinadores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ========================================
// ENDPOINTS PARA RESTAURANTES
// ========================================

// GET - Obtener todos los restaurantes con información de ciudad
app.get('/api/restaurantes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.*,
        c.nombre as ciudad_nombre
      FROM restaurantes r
      LEFT JOIN ciudades c ON r.ciudad_id = c.id
      ORDER BY r.fecha_creacion DESC
    `);

    // Debug logs for troubleshooting
    if (result.rows.length > 0) {
      console.log('Sedes del primer restaurante:', result.rows[0]?.sedes);
      console.log('Tipo de sedes del primer restaurante:', typeof result.rows[0]?.sedes);
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo restaurantes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Obtener restaurante por ID
app.get('/api/restaurantes/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        r.*,
        c.nombre as ciudad_nombre
      FROM restaurantes r
      LEFT JOIN ciudades c ON r.ciudad_id = c.id
      WHERE r.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo restaurante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST - Crear nuevo restaurante
app.post('/api/restaurantes', async (req, res) => {
  console.log('📝 Datos recibidos en POST /api/restaurantes:');
  console.log('Body completo:', req.body);
  
  const {
    nombre_oficial,
    nombre_mostrar,
    breve_resena,
    representante,
    numero_mesas,
    ciudad_id,
    email,
    telefono,
    instagram,
    logo,
    sede_ubicacion_corta,
    sede_horario,
    sedes,
    propuestas,
    ediciones,
    premios_obtenidos
  } = req.body;

  if (!nombre_oficial || !nombre_mostrar) {
    return res.status(400).json({ error: 'El nombre oficial y nombre para mostrar son requeridos' });
  }

  console.log('📦 Sedes recibidas:', sedes);
  console.log('📦 Tipo de sedes:', typeof sedes);
  
  const sedesString = JSON.stringify(sedes || []);
  console.log('📦 Sedes stringificadas para guardar:', sedesString);

  try {
    const result = await pool.query(`
      INSERT INTO restaurantes (
        nombre_oficial, nombre_mostrar, breve_resena, representante, numero_mesas,
        ciudad_id, email, telefono, instagram, logo, sede_ubicacion_corta,
        sede_horario, sedes, propuestas, ediciones, premios_obtenidos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      nombre_oficial.trim(),
      nombre_mostrar.trim(),
      breve_resena?.trim() || null,
      representante?.trim() || null,
      numero_mesas || null,
      ciudad_id || null,
      email?.trim() || null,
      telefono?.trim() || null,
      instagram?.trim() || null,
      logo?.trim() || null,
      sede_ubicacion_corta?.trim() || null,
      sede_horario?.trim() || null,
      sedesString,
      propuestas?.trim() || null,
      ediciones?.trim() || null,
      premios_obtenidos?.trim() || null
    ]);

    const nuevoRestaurante = result.rows[0];

    // Obtener el restaurante con información de ciudad
    const ciudadResult = await pool.query(`
      SELECT 
        r.*,
        c.nombre as ciudad_nombre
      FROM restaurantes r
      LEFT JOIN ciudades c ON r.ciudad_id = c.id
      WHERE r.id = $1
    `, [nuevoRestaurante.id]);

    const restauranteConCiudad = ciudadResult.rows[0];

    // Enviar actualización en tiempo real
    sendUpdateToAllClients('restaurante_agregado', restauranteConCiudad);

    res.status(201).json(restauranteConCiudad);
  } catch (error) {
    console.error('Error creando restaurante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT - Actualizar restaurante
app.put('/api/restaurantes/:id', async (req, res) => {
  const { id } = req.params;
  const {
    nombre_oficial,
    nombre_mostrar,
    breve_resena,
    representante,
    numero_mesas,
    ciudad_id,
    email,
    telefono,
    instagram,
    logo,
    sede_ubicacion_corta,
    sede_horario,
    sedes,
    propuestas,
    ediciones,
    premios_obtenidos
  } = req.body;

  if (!nombre_oficial || !nombre_mostrar) {
    return res.status(400).json({ error: 'El nombre oficial y nombre para mostrar son requeridos' });
  }

  try {
    const result = await pool.query(`
      UPDATE restaurantes SET
        nombre_oficial = $1, nombre_mostrar = $2, breve_resena = $3, representante = $4,
        numero_mesas = $5, ciudad_id = $6, email = $7, telefono = $8, instagram = $9,
        logo = $10, sede_ubicacion_corta = $11, sede_horario = $12, sedes = $13, propuestas = $14,
        ediciones = $15, premios_obtenidos = $16
      WHERE id = $17
      RETURNING *
    `, [
      nombre_oficial.trim(),
      nombre_mostrar.trim(),
      breve_resena?.trim() || null,
      representante?.trim() || null,
      numero_mesas || null,
      ciudad_id || null,
      email?.trim() || null,
      telefono?.trim() || null,
      instagram?.trim() || null,
      logo?.trim() || null,
      sede_ubicacion_corta?.trim() || null,
      sede_horario?.trim() || null,
      JSON.stringify(sedes || []),
      propuestas?.trim() || null,
      ediciones?.trim() || null,
      premios_obtenidos?.trim() || null,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }

    // Obtener el restaurante actualizado con información de ciudad
    const ciudadResult = await pool.query(`
      SELECT 
        r.*,
        c.nombre as ciudad_nombre
      FROM restaurantes r
      LEFT JOIN ciudades c ON r.ciudad_id = c.id
      WHERE r.id = $1
    `, [id]);

    const restauranteActualizado = ciudadResult.rows[0];

    // Enviar actualización en tiempo real
    sendUpdateToAllClients('restaurante_actualizado', restauranteActualizado);

    res.json(restauranteActualizado);
  } catch (error) {
    console.error('Error actualizando restaurante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE - Eliminar restaurante
app.delete('/api/restaurantes/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM restaurantes WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }

    // Enviar actualización en tiempo real
    sendUpdateToAllClients('restaurante_eliminado', { id: id, message: 'Restaurante eliminado' });

    res.json({ message: 'Restaurante eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando restaurante:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET - Buscar restaurantes
app.get('/api/restaurantes/buscar', async (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  try {
    const result = await pool.query(`
      SELECT 
        r.*,
        c.nombre as ciudad_nombre
      FROM restaurantes r
      LEFT JOIN ciudades c ON r.ciudad_id = c.id
      WHERE r.nombre_oficial ILIKE $1 OR r.nombre_mostrar ILIKE $1 OR r.representante ILIKE $1 OR r.email ILIKE $1
      ORDER BY r.nombre_oficial
    `, [`%${q}%`]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error buscando restaurantes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'API funcionando correctamente con restaurantes - Versión 1.0.2' });
});

// Endpoint de prueba para verificar que el servidor está funcionando
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'As Gastronómico API funcionando correctamente',
    endpoints: {
      health: '/api/health',
      ciudades: '/api/ciudades',
      patrocinadores: '/api/patrocinadores',
      restaurantes: '/api/restaurantes'
    }
  });
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error global:', err);
  res.status(500).json({ 
    error: 'Error interno del servidor',
    message: err.message 
  });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.originalUrl 
  });
});

// Inicializar base de datos y arrancar servidor
const initializeDatabase = async () => {
  try {
    console.log('🔧 Iniciando inicialización de base de datos...');
    console.log('🔧 DATABASE_URL configurada:', process.env.DATABASE_URL ? 'Sí' : 'No');
    console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
    console.log('🔧 Versión del servidor: 1.0.2 - Restaurantes implementados');
    
    await createTables();
    console.log('✅ Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
    console.error('❌ Detalles del error:', error.message);
    console.error('❌ Stack trace:', error.stack);
  }
};

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log('🎉 ========================================');
    console.log('🎉 SERVIDOR INICIADO EXITOSAMENTE');
    console.log('🎉 ========================================');
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`📊 API disponible en: http://localhost:${PORT}/api`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📡 SSE disponible en: http://localhost:${PORT}/api/events`);
    console.log(`💾 Base de datos PostgreSQL: ${process.env.DATABASE_URL ? 'Configurada' : 'No configurada'}`);
    console.log(`🌍 URLs de producción:`);
    console.log(`   - Backend: https://as-gastronomico-backend.onrender.com`);
    console.log(`   - Frontend: https://as-gastronomico-app.onrender.com`);
    console.log('🎉 ========================================');
  });
}).catch((error) => {
  console.error('❌ Error fatal iniciando el servidor:', error);
  process.exit(1);
});
