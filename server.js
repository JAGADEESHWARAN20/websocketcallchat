// server.js
const WebSocket = require('ws');
const ari = require('ari-client');

const PORT = process.env.PORT || 8083;
const ARI_URL = process.env.ARI_URL || 'http://172.19.40.102:8082';
const ARI_USER = process.env.ARI_USER || 'asterisk';
const ARI_PASSWORD = process.env.ARI_PASSWORD || 'asterisk';

const wss = new WebSocket.Server({ host: '0.0.0.0', port: PORT }, () => {
    console.log(`WebSocket server running on port ${PORT}`);
});

wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
    }
});

const clients = new Map();
let ariClient;

async function connectARI() {
    try {
        ariClient = await ari.connect(ARI_URL, ARI_USER, ARI_PASSWORD);
        console.log('Connected to Asterisk ARI');
        ariClient.on('StasisStart', (event, channel) => {
            console.log('StasisStart:', event);
        });
        ariClient.start('chat-call-app');
    } catch (error) {
        console.error('Error connecting to ARI:', error);
        setTimeout(connectARI, 5000);
    }
}

connectARI();

async function getAsteriskUsers() {
    if (!ariClient) return [];
    try {
        const endpoints = await ariClient.endpoints.list();
        return endpoints.map((endpoint) => ({
            id: endpoint.resource,
            status: endpoint.state === 'online' ? 'Online' : 'Offline',
        }));
    } catch (error) {
        console.error('Error fetching Asterisk users:', error);
        return [];
    }
}

function broadcast(message) {
    clients.forEach((client, id) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
            } catch (error) {
                console.error(`Error broadcasting to client ${id}:`, error);
            }
        }
    });
}

function broadcastStatus(clientId, status) {
    broadcast({ type: 'status_update', clientId, status });
}

async function broadcastUsers() {
    const users = await getAsteriskUsers();
    broadcast({ type: 'users_update', users });
}

wss.on('connection', (ws, req) => {
    const clientId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    clients.set(clientId, { ws, status: 'Offline' });
    console.log(`Client ${clientId} connected from ${req.socket.remoteAddress}`);

    // Send initial user list
    broadcastUsers();

    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        }
    }, 30000);

    ws.on('pong', () => {
        console.log(`Client ${clientId} responded to ping`);
    });

    ws.on('message', async (message) => {
        const messageStr = message.toString();
        if (messageStr.startsWith('REGISTER') || messageStr.startsWith('MESSAGE')) {
            return;
        }

        try {
            const data = JSON.parse(messageStr);
            if (!data.type) {
                ws.send(JSON.stringify({ error: 'Invalid message: Missing type' }));
                return;
            }

            switch (data.type) {
                case 'status_update':
                    if (typeof data.status !== 'string') {
                        ws.send(JSON.stringify({ error: 'Invalid status_update' }));
                        return;
                    }
                    clients.get(clientId).status = data.status;
                    broadcastStatus(clientId, data.status);
                    broadcastUsers();
                    break;
                case 'chat_message':
                    if (!data.target || !data.message || !data.sender) {
                        ws.send(JSON.stringify({ error: 'Invalid chat message' }));
                        return;
                    }
                    broadcast({ type: 'chat_message', target: data.target, message: data.message, sender: data.sender });
                    break;
                case 'call_incoming':
                    broadcast({ type: 'call_incoming', target: data.target, caller: data.caller });
                    break;
                case 'transfer':
                    if (!data.target) {
                        ws.send(JSON.stringify({ error: 'Invalid transfer' }));
                        return;
                    }
                    broadcast({ type: 'transfer_request', target: data.target });
                    break;
                default:
                    ws.send(JSON.stringify({ error: `Unknown message type: ${data.type}` }));
            }
        } catch (error) {
            console.error('Error processing message:', error.message);
            ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
    });

    ws.on('error', (error) => {
        console.error(`WebSocket client error for ${clientId}:`, error);
    });

    ws.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        clearInterval(pingInterval);
        clients.delete(clientId);
        broadcastStatus(clientId, 'Offline');
        broadcastUsers();
    });

    ws.send(JSON.stringify({ type: 'welcome', clientId }));
});

// Periodically update user list
setInterval(broadcastUsers, 10000);