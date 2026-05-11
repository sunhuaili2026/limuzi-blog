const http = require('http');
const https = require('https');

const API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-your-deepseek-api-key';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const server = http.createServer((req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
    }
    
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            
            // 简单的密码验证
            if (data.password !== 'limuzi2025') {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
            
            // 转发到 DeepSeek API
            const postData = JSON.stringify({
                model: data.model || 'deepseek-chat',
                messages: data.messages,
                temperature: data.temperature || 0.7
            });
            
            const options = {
                hostname: 'api.deepseek.com',
                port: 443,
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            
            const proxyReq = https.request(options, (proxyRes) => {
                let proxyBody = '';
                proxyRes.on('data', chunk => {
                    proxyBody += chunk.toString();
                });
                proxyRes.on('end', () => {
                    res.writeHead(proxyRes.statusCode, { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(proxyBody);
                });
            });
            
            proxyReq.on('error', (e) => {
                console.error('Proxy error:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'DeepSeek API error', message: e.message }));
            });
            
            proxyReq.write(postData);
            proxyReq.end();
            
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request', message: error.message }));
        }
    });
});

const PORT = process.env.API_PORT || 3000;
server.listen(PORT, () => {
    console.log(`DeepSeek API Proxy running on port ${PORT}`);
});
