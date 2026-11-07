'use strict';
const http = require('node:http');
const { analyze, createVisionAnalyzeHandler } = require('./index');
const { createOpenAIVisionAdapter } = require('./src/vision-adapter');

const port = Number(process.env.PORT || 8080);
const visionAdapter = createOpenAIVisionAdapter();
const visionHandler = createVisionAnalyzeHandler({ analyze, visionAdapter, maxBytes: 8 * 1024 * 1024 });

const server = http.createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true, service: 'isolated-ai-10-core-vision-test',
      visionProvider: 'openai', model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      visionConfigured: Boolean(process.env.OPENAI_API_KEY)
    }));
  }
  return visionHandler(req, res);
});
server.listen(port, '0.0.0.0', () => process.stdout.write(`AI-10 Vision test server listening on ${port}\n`));
server.on('error', error => { process.stderr.write(`Server error: ${error.message}\n`); process.exitCode = 1; });
