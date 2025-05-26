const WebSocket = require('ws');

// Use the port assigned by Render (default 10000) or fall back to 8081 for local development
const PORT = process.env.PORT || 8081;

const wss = new WebSocket.Server({ port: PORT });

console.log(`WebSocket server running on port ${PORT}`);

const clients = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');

    const clientId = Date.now().toString();
    clients.set(clientId, { ws, status: 'Offline' });

    ws.on('message', (message) => {
        // Convert message to string if it's a Buffer
        const messageStr = message.toString();

        // Check if the message is a SIP message (e.g., starts with "REGISTER" or "MESSAGE")
        if (messageStr.startsWith('REGISTER') || messageStr.startsWith('MESSAGE')) {
            console.log('Received SIP message (ignoring):', messageStr);
            return;
        }

        try {
            const data = JSON.parse(messageStr);

            if (data.type === 'status_update') {
                clients.get(clientId).status = data.status;
                broadcastStatus(clientId, data.status);
            } else if (data.type === 'call') {
                broadcast({ type: 'call_incoming', target: data.target });
            } else if (data.type === 'chat') {
                broadcast({ type: 'chat_message', target: data.target, message: data.message });
            } else if (data.type === 'transfer') {
                broadcast({ type: 'transfer_request', target: data.target });
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

function broadcast(message) {
    clients.forEach((client, id) => {
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    });
}

function broadcastStatus(clientId, status) {
    broadcast({ type: 'status_update', clientId, status });
}