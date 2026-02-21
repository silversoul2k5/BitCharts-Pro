'use strict';

const { createRequestUrl, handleAiAnalyze, sendJson } = require('../../server');

module.exports = async function analyzeHandler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const requestUrl = createRequestUrl(req);
  await handleAiAnalyze(req, requestUrl, res);
};
