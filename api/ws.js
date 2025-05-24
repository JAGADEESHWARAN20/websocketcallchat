const { WebSocketServer } = require('ws');

module.exports = (req, res) => {
     // Vercel handles WebSocket upgrades
     if (req.headers['upgrade'] === 'websocket') {
          const wss = new WebSocketServer({ noServer: true });

          const clients = new Map();

          wss.on('connection', (ws) => {
               console.log('Client connected');

               const clientId = Date.now().toString();
               clients.set(clientId, { ws, status: 'Offline' });

               ws.on('message', (message) => {
                    try {
                         const data = JSON.parse(message);

                         if (data.type === 'status') {
                              clients.get(clientId).status = data.status;
                              broadcastStatus(clientId, data.status);
                         } else if (data.type === 'call') {
                              broadcast({ type: 'call_incoming', target: data.target });
                         } else if (data.type === 'chat') {
                              broadcast({ type: 'chat_message', target: data.target, message: data.message });
                         } else if (data.type === 'transfer') {
                              broadcast({ type: 'transfer_request', target: data.target });
                         }

                         // Log SIP messages for debugging
                         if (typeof message === 'string' && message.startsWith('REGISTER sip:')) {
                              console.log('Received SIP message:', message);
                         }
                    } catch (error) {
                         console.error('Error processing message:', error);
                    }
               });

               ws.on('close', () => {
                    console.log('Client disconnected');
                    clients.delete(clientId);
                    broadcastStatus(clientId, 'Offline');
               });
          });

          // Handle WebSocket upgrade
          res.socket.server.on('upgrade', (request, socket, head) => {
               if (request.url === '/api/ws') {
                    wss.handleUpgrade(request, socket, head, (ws) => {
                         wss.emit('connection', ws, request);
                    });
               }
          });

          // End the HTTP response to prevent Vercel from timing out
          res.status(101).end();
     } else {
          res.status(400).json({ error: 'This endpoint is for WebSocket connections only' });
     }
};

function broadcast(clients, message) {
     clients.forEach((client, id) => {
          if (client.ws.readyState === 1) { // 1 = OPEN
               client.ws.send(JSON.stringify(message));
          }
     });
}

function broadcastStatus(clients, clientId, status) {
     broadcast(clients, { type: 'status_update', clientId, status });
}