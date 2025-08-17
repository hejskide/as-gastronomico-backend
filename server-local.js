const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de la base de datos SQLite local
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Crear tablas si no existen
const createTables = () => {
  return new Promise((resolve, reject) => {
    // Tabla de ciudades
    db.run(`
      CREATE TABLE IF NOT EXISTS ciudades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creando tabla ciudades:', err);
        reject(err);
        return;
      }
      console.log('✅ Tabla ciudades creada/verificada correctamente');
    });

    // Tabla de patrocinadores
    db.run(`
      CREATE TABLE IF NOT EXISTS patrocinadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        telefono TEXT,
        representante TEXT,
        logo_fondo_claro TEXT,
        logo_fondo_oscuro TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        console.error('Error creando tabla patrocinadores:', err);
        reject(err);
        return;
      }
      console.log('✅ Tabla patrocinadores creada/verificada correctamente');
    });

    // Tabla de relación patrocinadores-ciudades
    db.run(`
      CREATE TABLE IF NOT EXISTS patrocinadores_ciudades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patrocinador_id INTEGER,
        ciudad_id INTEGER,
        FOREIGN KEY (patrocinador_id) REFERENCES patrocinadores (id) ON DELETE CASCADE,
        FOREIGN KEY (ciudad_id) REFERENCES ciudades (id) ON DELETE CASCADE,
        UNIQUE(patrocinador_id, ciudad_id)
      )
    `, (err) => {
      if (err) {
        console.error('Error creando tabla patrocinadores_ciudades:', err);
        reject(err);
        return;
      }
      console.log('✅ Tabla patrocinadores_ciudades creada/verificada correctamente');
      resolve();
    });
  });
};

// Inicializar la base de datos
const initializeDatabase = async () => {
  try {
    await createTables();
    console.log('✅ Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
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
app.get('/api/ciudades', (req, res) => {
  db.all('SELECT * FROM ciudades ORDER BY fecha_creacion DESC', (err, rows) => {
    if (err) {
      console.error('Error obteniendo ciudades:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }
    res.json(rows);
  });
});

// POST - Crear nueva ciudad
app.post('/api/ciudades', (req, res) => {
  const { nombre } = req.body;

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
  }

  db.run('INSERT INTO ciudades (nombre) VALUES (?)', [nombre.trim()], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
      } else {
        console.error('Error creando ciudad:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
      return;
    }

    // Obtener la ciudad creada
    db.get('SELECT * FROM ciudades WHERE id = ?', [this.lastID], (err, row) => {
      if (err) {
        console.error('Error obteniendo ciudad creada:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
        return;
      }

      // Enviar actualización en tiempo real
      sendUpdateToAllClients('ciudad_agregada', row);

      res.status(201).json(row);
    });
  });
});

// PUT - Actualizar ciudad
app.put('/api/ciudades/:id', (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;

  if (!nombre || nombre.trim() === '') {
    return res.status(400).json({ error: 'El nombre de la ciudad es requerido' });
  }

  db.run('UPDATE ciudades SET nombre = ? WHERE id = ?', [nombre.trim(), id], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: 'Ya existe una ciudad con ese nombre' });
      } else {
        console.error('Error actualizando ciudad:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
      return;
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }

    // Obtener la ciudad actualizada
    db.get('SELECT * FROM ciudades WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error('Error obteniendo ciudad actualizada:', err);
        res.status(500).json({ error: 'Error interno del servidor' });
        return;
      }

      // Enviar actualización en tiempo real
      sendUpdateToAllClients('ciudad_actualizada', row);

      res.json(row);
    });
  });
});

// DELETE - Eliminar ciudad
app.delete('/api/ciudades/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM ciudades WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Error eliminando ciudad:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Ciudad no encontrada' });
    }

    // Enviar actualización en tiempo real
    sendUpdateToAllClients('ciudad_eliminada', { id: id, message: 'Ciudad eliminada' });

    res.json({ message: 'Ciudad eliminada correctamente' });
  });
});

// GET - Buscar ciudades
app.get('/api/ciudades/buscar', (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  db.all('SELECT * FROM ciudades WHERE nombre LIKE ? ORDER BY nombre', [`%${q}%`], (err, rows) => {
    if (err) {
      console.error('Error buscando ciudades:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }
    res.json(rows);
  });
});

// Endpoints para patrocinadores

// GET - Obtener todos los patrocinadores con sus ciudades
app.get('/api/patrocinadores', (req, res) => {
  const query = `
    SELECT 
      p.*,
      GROUP_CONCAT(c.nombre) as ciudades_nombres,
      GROUP_CONCAT(c.id) as ciudades_ids
    FROM patrocinadores p
    LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
    LEFT JOIN ciudades c ON pc.ciudad_id = c.id
    GROUP BY p.id
    ORDER BY p.fecha_creacion DESC
  `;

  db.all(query, (err, rows) => {
    if (err) {
      console.error('Error obteniendo patrocinadores:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    // Procesar los resultados para manejar patrocinadores sin ciudades
    const patrocinadores = rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
      ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',').map(id => id.toString()) : []
    }));

    res.json(patrocinadores);
  });
});

// POST - Crear nuevo patrocinador
app.post('/api/patrocinadores', (req, res) => {
  const { nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro, ciudades_ids } = req.body;

  if (!nombre || !email) {
    return res.status(400).json({ error: 'El nombre y email son requeridos' });
  }

  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'El formato del email no es válido' });
  }

  db.run(
    'INSERT INTO patrocinadores (nombre, email, telefono, representante, logo_fondo_claro, logo_fondo_oscuro) VALUES (?, ?, ?, ?, ?, ?)',
    [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
        } else {
          console.error('Error creando patrocinador:', err);
          res.status(500).json({ error: 'Error interno del servidor' });
        }
        return;
      }

      const patrocinadorId = this.lastID;

      // Asociar ciudades si se proporcionan
      if (ciudades_ids && ciudades_ids.length > 0) {
        const insertPromises = ciudades_ids.map(ciudadId => {
          return new Promise((resolve, reject) => {
            db.run('INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES (?, ?)', [patrocinadorId, ciudadId], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        });

        Promise.all(insertPromises).then(() => {
          // Obtener el patrocinador con sus ciudades
          const finalQuery = `
            SELECT 
              p.*,
              GROUP_CONCAT(c.nombre) as ciudades_nombres,
              GROUP_CONCAT(c.id) as ciudades_ids
            FROM patrocinadores p
            LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
            LEFT JOIN ciudades c ON pc.ciudad_id = c.id
            WHERE p.id = ?
            GROUP BY p.id
          `;

          db.get(finalQuery, [patrocinadorId], (err, row) => {
            if (err) {
              console.error('Error obteniendo patrocinador final:', err);
              res.status(500).json({ error: 'Error interno del servidor' });
              return;
            }

            const patrocinadorFinal = {
              ...row,
              ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
              ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',').map(id => id.toString()) : []
            };

            res.status(201).json(patrocinadorFinal);
          });
        }).catch(err => {
          console.error('Error asociando ciudades:', err);
          res.status(500).json({ error: 'Error interno del servidor' });
        });
      } else {
        // Obtener el patrocinador sin ciudades
        db.get('SELECT * FROM patrocinadores WHERE id = ?', [patrocinadorId], (err, row) => {
          if (err) {
            console.error('Error obteniendo patrocinador:', err);
            res.status(500).json({ error: 'Error interno del servidor' });
            return;
          }

          const patrocinadorFinal = {
            ...row,
            ciudades_nombres: [],
            ciudades_ids: []
          };

          res.status(201).json(patrocinadorFinal);
        });
      }
    }
  );
});

// PUT - Actualizar patrocinador
app.put('/api/patrocinadores/:id', (req, res) => {
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

  db.run(
    'UPDATE patrocinadores SET nombre = ?, email = ?, telefono = ?, representante = ?, logo_fondo_claro = ?, logo_fondo_oscuro = ? WHERE id = ?',
    [nombre.trim(), email.trim(), telefono?.trim() || null, representante?.trim() || null, logo_fondo_claro || null, logo_fondo_oscuro || null, id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          res.status(400).json({ error: 'Ya existe un patrocinador con ese email' });
        } else {
          console.error('Error actualizando patrocinador:', err);
          res.status(500).json({ error: 'Error interno del servidor' });
        }
        return;
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Patrocinador no encontrado' });
      }

      // Actualizar ciudades asociadas
      db.run('DELETE FROM patrocinadores_ciudades WHERE patrocinador_id = ?', [id], (err) => {
        if (err) {
          console.error('Error eliminando ciudades asociadas:', err);
          res.status(500).json({ error: 'Error interno del servidor' });
          return;
        }

        if (ciudades_ids && ciudades_ids.length > 0) {
          const insertPromises = ciudades_ids.map(ciudadId => {
            return new Promise((resolve, reject) => {
              db.run('INSERT INTO patrocinadores_ciudades (patrocinador_id, ciudad_id) VALUES (?, ?)', [id, ciudadId], (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          });

          Promise.all(insertPromises).then(() => {
            // Obtener el patrocinador actualizado con sus ciudades
            const finalQuery = `
              SELECT 
                p.*,
                GROUP_CONCAT(c.nombre) as ciudades_nombres,
                GROUP_CONCAT(c.id) as ciudades_ids
              FROM patrocinadores p
              LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
              LEFT JOIN ciudades c ON pc.ciudad_id = c.id
              WHERE p.id = ?
              GROUP BY p.id
            `;

            db.get(finalQuery, [id], (err, row) => {
              if (err) {
                console.error('Error obteniendo patrocinador actualizado:', err);
                res.status(500).json({ error: 'Error interno del servidor' });
                return;
              }

              const patrocinadorFinal = {
                ...row,
                ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
                ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',').map(id => id.toString()) : []
              };

              res.json(patrocinadorFinal);
            });
          }).catch(err => {
            console.error('Error asociando ciudades:', err);
            res.status(500).json({ error: 'Error interno del servidor' });
          });
        } else {
          // Obtener el patrocinador sin ciudades
          db.get('SELECT * FROM patrocinadores WHERE id = ?', [id], (err, row) => {
            if (err) {
              console.error('Error obteniendo patrocinador:', err);
              res.status(500).json({ error: 'Error interno del servidor' });
              return;
            }

            const patrocinadorFinal = {
              ...row,
              ciudades_nombres: [],
              ciudades_ids: []
            };

            res.json(patrocinadorFinal);
          });
        }
      });
    }
  );
});

// DELETE - Eliminar patrocinador
app.delete('/api/patrocinadores/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM patrocinadores WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Error eliminando patrocinador:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Patrocinador no encontrado' });
    }

    // Enviar actualización en tiempo real
    sendUpdateToAllClients('patrocinador_eliminado', { id: id, message: 'Patrocinador eliminado' });

    res.json({ message: 'Patrocinador eliminado correctamente' });
  });
});

// GET - Buscar patrocinadores
app.get('/api/patrocinadores/buscar', (req, res) => {
  const { q } = req.query;

  if (!q) {
    return res.json([]);
  }

  const query = `
    SELECT 
      p.*,
      GROUP_CONCAT(c.nombre) as ciudades_nombres,
      GROUP_CONCAT(c.id) as ciudades_ids
    FROM patrocinadores p
    LEFT JOIN patrocinadores_ciudades pc ON p.id = pc.patrocinador_id
    LEFT JOIN ciudades c ON pc.ciudad_id = c.id
    WHERE p.nombre LIKE ? OR p.email LIKE ? OR p.representante LIKE ?
    GROUP BY p.id
    ORDER BY p.nombre
  `;

  db.all(query, [`%${q}%`, `%${q}%`, `%${q}%`], (err, rows) => {
    if (err) {
      console.error('Error buscando patrocinadores:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    const patrocinadores = rows.map(row => ({
      ...row,
      ciudades_nombres: row.ciudades_nombres ? row.ciudades_nombres.split(',') : [],
      ciudades_ids: row.ciudades_ids ? row.ciudades_ids.split(',').map(id => id.toString()) : []
    }));

    res.json(patrocinadores);
  });
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
    console.log(`💾 Base de datos SQLite: ${dbPath}`);
  });
});
