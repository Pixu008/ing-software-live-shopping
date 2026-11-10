const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
    host: 'localhost', user: 'root', password: '', database: 'live_shopping_db'
});

db.connect(err => {
    if (err) console.error('Error conectando a BD:', err);
    else console.log('Conectado exitosamente a MySQL');
});

app.post('/api/login', (req, res) => {
    const { correo, password } = req.body;
    db.query('SELECT id_usuario, nombre, rol FROM usuarios WHERE correo = ? AND password = ?', [correo, password], (err, results) => {
        if (err || results.length === 0) return res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
        res.json({ success: true, usuario: results[0] });
    });
});

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

//BORRAR UN LIVE COMPLETO (Y sus prendas)
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

app.listen(3000, () => console.log(`Servidor en http://localhost:3000`));