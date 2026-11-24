const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs'); // NUEVO: Librería para hashear contraseñas

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
    host: 'localhost', 
    user: 'root', 
    password: '', 
    database: 'live_shopping_db'
});

db.connect(err => {
    if (err) console.error('Error conectando a BD:', err);
    else console.log('Conectado exitosamente a MySQL');
});

// REGISTRO CON CONTRASEÑA SEGURA Y HASHING
app.post('/api/registro', (req, res) => {
    const { nombre, correo, password, rol } = req.body;

    // Validar: mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número y 1 símbolo
    const regexSegura = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!regexSegura.test(password)) {
        return res.status(400).json({ 
            success: false, 
            error: 'La contraseña debe tener mínimo 8 caracteres, incluir mayúsculas, minúsculas, números y símbolos (ej: Clave123!).' 
        });
    }

    db.query('SELECT id_usuario FROM usuarios WHERE correo = ?', [correo], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: 'Error en el servidor' });
        if (results.length > 0) {
            return res.status(400).json({ success: false, error: 'Este correo ya está registrado.' });
        }

        // Hashear la contraseña (10 rondas de salt)
        const passwordHasheada = bcrypt.hashSync(password, 10);

        db.query('INSERT INTO usuarios (nombre, correo, password, rol) VALUES (?, ?, ?, ?)', 
        [nombre, correo, passwordHasheada, rol || 'asistente'], (err) => {
            if (err) return res.status(500).json({ success: false, error: 'Error al registrar usuario' });
            res.json({ success: true, mensaje: 'Usuario registrado exitosamente. Ya puedes iniciar sesión.' });
        });
    });
});

// LOGIN CON COMPARACIÓN DE HASH Y BLOQUEO TRAS 3 INTENTOS
app.post('/api/login', (req, res) => {
    const { correo, password } = req.body;

    db.query('SELECT * FROM usuarios WHERE correo = ?', [correo], (err, results) => {
        if (err) return res.status(500).json({ success: false, error: 'Error en el servidor' });
        if (results.length === 0) {
            return res.status(401).json({ success: false, error: 'Correo no registrado.' });
        }

        const usuario = results[0];

        if (usuario.bloqueado === 1) {
            return res.status(403).json({ 
                success: false, 
                error: '🔒 Cuenta bloqueada por superar los 3 intentos fallidos.' 
            });
        }

        // Comparar la clave ingresada contra el hash guardado en la BD
        const claveValida = bcrypt.compareSync(password, usuario.password);

        if (claveValida) {
            db.query('UPDATE usuarios SET intentos_fallidos = 0 WHERE id_usuario = ?', [usuario.id_usuario], () => {
                res.json({ 
                    success: true, 
                    usuario: { id_usuario: usuario.id_usuario, nombre: usuario.nombre, rol: usuario.rol } 
                });
            });
        } else {
            const nuevosIntentos = usuario.intentos_fallidos + 1;
            const bloquear = nuevosIntentos >= 3 ? 1 : 0;

            db.query('UPDATE usuarios SET intentos_fallidos = ?, bloqueado = ? WHERE id_usuario = ?', 
            [nuevosIntentos, bloquear, usuario.id_usuario], () => {
                if (bloquear === 1) {
                    return res.status(403).json({ 
                        success: false, 
                        error: '🔒 Contraseña incorrecta. Has alcanzado 3 intentos fallidos y tu cuenta ha sido BLOQUEADA.' 
                    });
                } else {
                    return res.status(401).json({ 
                        success: false, 
                        error: `Contraseña incorrecta. Intento ${nuevosIntentos} de 3.` 
                    });
                }
            });
        }
    });
});

// --- RUTAS DEL CRUD (Sin cambios) ---
app.post('/api/asignar', (req, res) => {
    const { prenda, precio, cliente_alias, sesion } = req.body;
    db.query('INSERT IGNORE INTO clientes (nombre_usuario_red) VALUES (?)', [cliente_alias], () => {
        db.query('SELECT id_cliente FROM clientes WHERE nombre_usuario_red = ?', [cliente_alias], (err, cliResults) => {
            const idCliente = cliResults[0].id_cliente;
            db.query('SELECT id_pedido FROM pedidos WHERE id_cliente = ? AND sesion = ? LIMIT 1', [idCliente, sesion], (err, pedResults) => {
                if (pedResults.length > 0) {
                    const idPedido = pedResults[0].id_pedido;
                    db.query('UPDATE pedidos SET total_pagado = total_pagado + ? WHERE id_pedido = ?', [precio, idPedido], () => {
                        db.query('INSERT INTO detalle_pedido (id_pedido, codigo_sku, precio_unitario) VALUES (?, ?, ?)', [idPedido, prenda, precio], () => res.json({ mensaje: 'Agregada' }));
                    });
                } else {
                    db.query('INSERT INTO pedidos (id_cliente, total_pagado, sesion) VALUES (?, ?, ?)', [idCliente, precio, sesion], (err, result) => {
                        db.query('INSERT INTO detalle_pedido (id_pedido, codigo_sku, precio_unitario) VALUES (?, ?, ?)', [result.insertId, prenda, precio], () => res.json({ mensaje: 'Agregada' }));
                    });
                }
            });
        });
    });
});

app.get('/api/cuaderno', (req, res) => {
    const query = `
        SELECT ped.id_pedido, c.nombre_usuario_red as alias, ped.total_pagado, ped.estado_pago, dp.id_detalle, dp.codigo_sku as prenda, dp.precio_unitario as precio
        FROM pedidos ped
        JOIN clientes c ON ped.id_cliente = c.id_cliente
        JOIN detalle_pedido dp ON ped.id_pedido = dp.id_pedido
        WHERE ped.sesion = ?
        ORDER BY ped.id_pedido DESC
    `;
    db.query(query, [req.query.sesion], (err, results) => {
        if(err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/ganancias', (req, res) => {
    const query = `
        SELECT sesion, DATE_FORMAT(MAX(fecha), '%d-%m-%Y') as fecha, SUM(total_pagado) as recaudado, COUNT(id_pedido) as clientes
        FROM pedidos
        GROUP BY sesion
        ORDER BY MAX(fecha) DESC
    `;
    db.query(query, (err, results) => {
        if(err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/pedido/:id/estado', (req, res) => {
    db.query('UPDATE pedidos SET estado_pago = ? WHERE id_pedido = ?', [req.body.estado, req.params.id], (err) => res.json({ success: true }));
});

app.delete('/api/carrito/:id_detalle', (req, res) => {
    db.query('SELECT id_pedido, precio_unitario FROM detalle_pedido WHERE id_detalle = ?', [req.params.id_detalle], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({error: 'No encontrado'});
        const { id_pedido, precio_unitario } = results[0];
        db.query('DELETE FROM detalle_pedido WHERE id_detalle = ?', [req.params.id_detalle], () => {
            db.query('UPDATE pedidos SET total_pagado = total_pagado - ? WHERE id_pedido = ?', [precio_unitario, id_pedido], () => res.json({ success: true }));
        });
    });
});

app.delete('/api/sesion', (req, res) => {
    const sesion = req.query.sesion;
    const queryDetalles = `DELETE dp FROM detalle_pedido dp JOIN pedidos ped ON dp.id_pedido = ped.id_pedido WHERE ped.sesion = ?`;
    db.query(queryDetalles, [sesion], (err) => {
        if (err) return res.status(500).json(err);
        db.query('DELETE FROM pedidos WHERE sesion = ?', [sesion], (err) => {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));